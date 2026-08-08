import type { SupabaseClient } from '@supabase/supabase-js';
import type {
	EstadoPedido,
	Pedido,
	Reporte,
	ReporteDomiciliario,
	ReportePedidoFila,
	ReporteResumen,
	ReporteSerie
} from '$lib/types';

/** Estados que cuentan como pedido «en proceso» (tiene un repartidor activo). */
export const EN_CURSO: EstadoPedido[] = ['asignado', 'aceptado', 'recogido', 'en_camino'];

const TODOS_ESTADOS: EstadoPedido[] = [
	'pendiente',
	'asignado',
	'aceptado',
	'recogido',
	'en_camino',
	'entregado',
	'cancelado'
];

/** Bogotá usa UTC-5 todo el año (sin horario de verano). */
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

const MAX_PEDIDOS = 10000;
const PAGE = 1000;
const LOTE_IDS = 500;

// ---------------------------------------------------------------- Helpers puros

/** Convierte un ISO (UTC) a la fecha 'YYYY-MM-DD' en hora de Bogotá. */
export function fechaBogota(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return new Date(d.getTime() - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD HH:mm' en hora de Bogotá, sin depender de la zona del servidor. */
export function fechaHoraBogota(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	const b = new Date(d.getTime() - BOGOTA_OFFSET_MS);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${b.getUTCFullYear()}-${p(b.getUTCMonth() + 1)}-${p(b.getUTCDate())} ${p(b.getUTCHours())}:${p(b.getUTCMinutes())}`;
}

export function esFechaValida(s: string | null | undefined): s is string {
	if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	// Rechaza fechas imposibles como 2026-13-40.
	const d = new Date(`${s}T12:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export interface RangoUTC {
	desde: string | null;
	hasta: string | null;
	desdeUTC: string | null;
	/** Límite EXCLUSIVO (hasta + 1 día) para usar con .lt('created_at', ...). */
	hastaExclUTC: string | null;
}

/**
 * Valida fechas 'YYYY-MM-DD' en hora de Bogotá y las convierte a límites
 * UTC para filtrar created_at. Devuelve null si son inválidas o si
 * desde > hasta. Con ambos null el rango es «todo el historial».
 */
export function validarRango(desde: string | null, hasta: string | null): RangoUTC | null {
	if (desde && !esFechaValida(desde)) return null;
	if (hasta && !esFechaValida(hasta)) return null;
	if (desde && hasta && desde > hasta) return null;

	const desdeUTC = desde ? `${desde}T05:00:00.000Z` : null; // 00:00 hora de Bogotá
	let hastaExclUTC: string | null = null;
	if (hasta) {
		const d = new Date(`${hasta}T05:00:00.000Z`);
		d.setUTCDate(d.getUTCDate() + 1);
		hastaExclUTC = d.toISOString();
	}
	return { desde, hasta, desdeUTC, hastaExclUTC };
}

/** Agrupa pedidos por día (fecha de Bogotá), ordenado ascendente. */
export function agruparPorDia(pedidos: Pedido[]): ReporteSerie[] {
	const mapa = new Map<string, ReporteSerie>();
	for (const p of pedidos) {
		const fecha = fechaBogota(p.created_at);
		if (!fecha) continue;
		const s = mapa.get(fecha) ?? { fecha, total: 0, entregados: 0, cancelados: 0, ingresos: 0 };
		s.total++;
		if (p.estado === 'entregado') {
			s.entregados++;
			// Ingresos con el total (incluye recargos si los hubo).
			s.ingresos += p.total ?? p.tarifa_base;
		} else if (p.estado === 'cancelado') {
			s.cancelados++;
		}
		mapa.set(fecha, s);
	}
	return [...mapa.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Agrupa pedidos por domiciliario (los sin asignar van a «Sin asignar»). */
export function agruparPorDomiciliario(
	pedidos: Pedido[],
	domiciliarios: { id: string; nombre: string }[]
): ReporteDomiciliario[] {
	const nombres = new Map(domiciliarios.map((d) => [d.id, d.nombre]));
	const mapa = new Map<string, ReporteDomiciliario>();
	const clave = (id: string | null) => id ?? '__sin_asignar__';

	for (const p of pedidos) {
		const k = clave(p.domiciliario_id);
		const fila = mapa.get(k) ?? {
			id: p.domiciliario_id,
			nombre: p.domiciliario_id ? (nombres.get(p.domiciliario_id) ?? 'Domiciliario') : 'Sin asignar',
			total: 0,
			entregados: 0,
			cancelados: 0,
			ingresos: 0
		};
		fila.total++;
		if (p.estado === 'entregado') {
			fila.entregados++;
			fila.ingresos += p.total ?? p.tarifa_base;
		} else if (p.estado === 'cancelado') {
			fila.cancelados++;
		}
		mapa.set(k, fila);
	}

	return [...mapa.values()].sort((a, b) => b.total - a.total);
}

function escaparCsv(v: unknown): string {
	const s = v == null ? '' : String(v);
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serializa los pedidos a CSV (con BOM para Excel si se antepone \uFEFF). */
export function pedidosACsv(pedidos: ReportePedidoFila[]): string {
	const cabecera = [
		'numero',
		'fecha (Bogotá)',
		'estado',
		'tarifa',
		'total',
		'origen',
		'destino',
		'domiciliario',
		'observaciones'
	];
	const filas = pedidos.map((p) => [
		p.numero,
		fechaHoraBogota(p.created_at),
		p.estado,
		p.tarifa_base,
		p.total ?? p.tarifa_base,
		`${p.barrio_origen_nombre ?? ''}${p.direccion_origen ? ` · ${p.direccion_origen}` : ''}`,
		`${p.barrio_destino_nombre ?? ''}${p.direccion_destino ? ` · ${p.direccion_destino}` : ''}`,
		p.domiciliario_nombre ?? '',
		p.observaciones ?? ''
	]);
	return [cabecera, ...filas].map((fila) => fila.map(escaparCsv).join(',')).join('\r\n');
}

// ------------------------------------------------------------- Consultas a BD

/** Trae todos los pedidos del rango (paginado), ordenado por fecha ascendente. */
async function obtenerPedidos(
	db: SupabaseClient,
	desdeUTC: string | null,
	hastaExclUTC: string | null
): Promise<Pedido[]> {
	const filas: Pedido[] = [];
	for (let offset = 0; offset < MAX_PEDIDOS; offset += PAGE) {
		let q = db.from('pedidos').select('*').order('created_at', { ascending: true }).range(offset, offset + PAGE - 1);
		if (desdeUTC) q = q.gte('created_at', desdeUTC);
		if (hastaExclUTC) q = q.lt('created_at', hastaExclUTC);
		const { data, error } = await q;
		if (error) throw new Error(error.message);
		const lote = (data ?? []) as Pedido[];
		filas.push(...lote);
		if (lote.length < PAGE) break;
	}
	return filas;
}

/** Resuelve id → nombre consultando por lotes (los .in() se limitan a ~1000). */
async function resolverNombres(
	db: SupabaseClient,
	tabla: 'barrios' | 'domiciliarios',
	ids: string[]
): Promise<Map<string, string>> {
	const mapa = new Map<string, string>();
	for (let i = 0; i < ids.length; i += LOTE_IDS) {
		const lote = ids.slice(i, i + LOTE_IDS);
		const { data, error } = await db.from(tabla).select('id, nombre').in('id', lote);
		if (error) throw new Error(error.message);
		for (const f of data ?? []) mapa.set(f.id, f.nombre);
	}
	return mapa;
}

/** Ids de domiciliarios con al menos un pedido EN CURSO ahora mismo. */
async function obtenerOcupados(db: SupabaseClient): Promise<Set<string>> {
	const ocupados = new Set<string>();
	for (let offset = 0; offset < MAX_PEDIDOS; offset += PAGE) {
		const { data, error } = await db
			.from('pedidos')
			.select('domiciliario_id')
			.in('estado', EN_CURSO)
			.not('domiciliario_id', 'is', null)
			.range(offset, offset + PAGE - 1);
		if (error) throw new Error(error.message);
		const lote = (data ?? []) as { domiciliario_id: string | null }[];
		for (const f of lote) if (f.domiciliario_id) ocupados.add(f.domiciliario_id);
		if (lote.length < PAGE) break;
	}
	return ocupados;
}

// ---------------------------------------------------------------- API pública

export interface PedidosEnRango {
	rango: { desde: string | null; hasta: string | null };
	pedidos: ReportePedidoFila[];
}

/**
 * Pedidos del rango con nombres de barrios y domiciliarios resueltos.
 * Usa el cliente autenticado (admin) para pedidos/domiciliarios y el
 * anónimo solo para barrios (lectura pública).
 */
export async function obtenerPedidosReporte(
	db: SupabaseClient,
	anon: SupabaseClient,
	desde: string | null,
	hasta: string | null
): Promise<PedidosEnRango> {
	const rango = validarRango(desde, hasta);
	if (!rango) throw new Error('Rango de fechas inválido.');
	const pedidos = await obtenerPedidos(db, rango.desdeUTC, rango.hastaExclUTC);

	const idsBarrios = [...new Set(pedidos.flatMap((p) => [p.barrio_origen_id, p.barrio_destino_id]))];
	const nombresBarrios = idsBarrios.length > 0 ? await resolverNombres(anon, 'barrios', idsBarrios) : new Map<string, string>();

	const idsDom = [...new Set(pedidos.map((p) => p.domiciliario_id).filter(Boolean))] as string[];
	const nombresDom = idsDom.length > 0 ? await resolverNombres(db, 'domiciliarios', idsDom) : new Map<string, string>();

	const filas: ReportePedidoFila[] = pedidos.map((p) => ({
		...p,
		barrio_origen_nombre: nombresBarrios.get(p.barrio_origen_id) ?? null,
		barrio_destino_nombre: nombresBarrios.get(p.barrio_destino_id) ?? null,
		domiciliario_nombre: p.domiciliario_id ? (nombresDom.get(p.domiciliario_id) ?? null) : null
	}));

	return { rango: { desde: rango.desde, hasta: rango.hasta }, pedidos: filas };
}

/** Reporte completo: resumen, series diarias, por domiciliario y pedidos. */
export async function obtenerReporte(
	db: SupabaseClient,
	anon: SupabaseClient,
	desde: string | null,
	hasta: string | null
): Promise<Reporte> {
	const { rango, pedidos } = await obtenerPedidosReporte(db, anon, desde, hasta);

	const por_estado = Object.fromEntries(TODOS_ESTADOS.map((e) => [e, 0])) as Record<EstadoPedido, number>;
	let en_proceso = 0;
	let entregados = 0;
	let cancelados = 0;
	let ingresos = 0;
	for (const p of pedidos) {
		por_estado[p.estado]++;
		if (EN_CURSO.includes(p.estado)) en_proceso++;
		if (p.estado === 'entregado') {
			entregados++;
			ingresos += p.total ?? p.tarifa_base;
		} else if (p.estado === 'cancelado') {
			cancelados++;
		}
	}

	const { data: doms, error: errDom } = await db.from('domiciliarios').select('id, nombre, activo, bloqueado');
	if (errDom) throw new Error(errDom.message);
	const domiciliarios = (doms ?? []) as { id: string; nombre: string; activo: boolean; bloqueado: boolean }[];
	// Los bloqueados por falta de pago no cuentan como disponibles.
	const activos = domiciliarios.filter((d) => d.activo && !d.bloqueado);

	const ocupados = await obtenerOcupados(db);
	const ocupadosActivos = activos.filter((d) => ocupados.has(d.id)).length;

	const resumen: ReporteResumen = {
		total: pedidos.length,
		por_estado,
		en_proceso,
		entregados,
		cancelados,
		ingresos,
		ticket_promedio: entregados > 0 ? Math.round(ingresos / entregados) : 0,
		domiciliarios_activos: activos.length,
		domiciliarios_ocupados: ocupadosActivos,
		domiciliarios_disponibles: activos.length - ocupadosActivos
	};

	return {
		rango,
		resumen,
		series: agruparPorDia(pedidos),
		por_domiciliario: agruparPorDomiciliario(pedidos, domiciliarios),
		pedidos
	};
}
