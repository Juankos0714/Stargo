import type { SupabaseClient } from '@supabase/supabase-js';
import { calcularDeuda, comisionDiaria, fechaBogota, nivelDiario, totalesDiarios } from '$lib/logic/comisiones';
import type { ComisionNivel, PagoDomiciliario, ResumenDia } from '$lib/types';

/**
 * Cuentas de comisiones (Fase 10 + 11 + 13).
 *
 * Desde la Fase 13 la comisión es DIARIA y ACUMULADA: el domiciliario debe
 * a la app, por cada día trabajado, la suma de los valores de los niveles
 * que cruza el total de TODAS sus entregas de ese día (no una comisión por
 * pedido). La deuda = Σ comisiones diarias − Σ abonos registrados, y se
 * recalcula siempre contra la escalera vigente.
 */

export interface CuentaResumen {
	total_comision: number;
	total_pagos: number;
	deuda: number;
	/** Últimos abonos (descendente). */
	pagos: PagoDomiciliario[];
}

/** Resumen de cuenta con el desglose del día de hoy (panel del domiciliario). */
export type CuentaResumenConHoy = CuentaResumen & { hoy: ResumenDia };

const MAX_PAGOS = 10;

/** Entrega mínima para agrupar por día (solo lo que necesita totalesDiarios). */
interface Entrega {
	domiciliario_id: string | null;
	total: number | null;
	tarifa_base: number;
	recargo_total: number;
	updated_at: string;
}

/** Suma de comisiones diarias de un domiciliario y el resumen de HOY. */
function comisionPorDias(
	niveles: ComisionNivel[],
	totales: Map<string, number> | undefined,
	hoyBogota: string
): { total: number; hoy: ResumenDia } {
	let total = 0;
	let hoy: ResumenDia = { fecha: hoyBogota, total: 0, nivel: null, comision: 0 };
	for (const [fecha, totalDia] of totales ?? []) {
		const comision = comisionDiaria(niveles, totalDia);
		total += comision;
		if (fecha === hoyBogota) {
			hoy = { fecha, total: totalDia, nivel: nivelDiario(niveles, totalDia)?.nivel ?? null, comision };
		}
	}
	return { total, hoy };
}

/**
 * Cuenta de un solo domiciliario (su panel). Devuelve los niveles vigentes
 * de comisión (para que sepa cuánto pagará por día), su bloqueo, el
 * resumen de deuda y el resumen del día de hoy (entregas de hoy → nivel y
 * comisión del día).
 */
export async function obtenerCuentaDomiciliario(
	db: SupabaseClient,
	domiciliarioId: string
): Promise<{ niveles: ComisionNivel[]; bloqueado: boolean; resumen: CuentaResumen; hoy: ResumenDia }> {
	const { data: fila } = await db
		.from('domiciliarios')
		.select('bloqueado')
		.eq('id', domiciliarioId)
		.maybeSingle();

	const { data: niveles } = await db.from('comision_niveles').select('*').order('nivel');

	const resumenes = await obtenerResumenes(db, [domiciliarioId], (niveles ?? []) as ComisionNivel[]);
	const resumen = resumenes.get(domiciliarioId) ?? cuentaVaciaConHoy();
	return {
		niveles: (niveles ?? []) as ComisionNivel[],
		bloqueado: fila?.bloqueado === true,
		resumen,
		hoy: resumen.hoy
	};
}

/**
 * Resumen de deuda para un conjunto de domiciliarios (panel admin y panel
 * del domiciliario). Consultas por lotes: pedidos entregados (agrupados por
 * día para la comisión diaria) + abonos. Devuelve también el resumen de hoy
 * de cada uno (el panel del domi lo muestra; el admin lo ignora).
 */
export async function obtenerResumenes(
	db: SupabaseClient,
	ids: string[],
	niveles?: ComisionNivel[]
): Promise<Map<string, CuentaResumenConHoy>> {
	const mapa = new Map<string, CuentaResumenConHoy>();
	const unicos = [...new Set(ids)].filter(Boolean);
	if (unicos.length === 0) return mapa;
	const hoyBogota = fechaBogota(new Date().toISOString());
	for (const id of unicos) mapa.set(id, { ...cuentaVacia(), hoy: { fecha: hoyBogota, total: 0, nivel: null, comision: 0 } });

	// 1) Comisiones DIARIAS: se agrupan los pedidos entregados por día
	//    (hora de Bogotá) y se suma la comisión de cada día.
	//    PostgREST limita cada respuesta a ~1000 filas: se pagina igual que
	//    en reportes.ts para que la deuda no se calcule sobre datos parciales.
	const escalera = (niveles ?? ((await db.from('comision_niveles').select('*').order('nivel')).data ?? [])) as ComisionNivel[];
	const entregados = await obtenerEntregados(db, unicos);
	const porDia = totalesDiarios(entregados);
	for (const [domId, dias] of porDia) {
		const r = mapa.get(domId);
		if (!r) continue;
		const { total, hoy } = comisionPorDias(escalera, dias, hoyBogota);
		r.total_comision = total;
		r.hoy = hoy;
	}

	// 2) Abonos (paginado: con muchos abonos la suma total no debe truncarse).
	const rPagos = await obtenerPagos(db, unicos);

	for (const pago of rPagos) {
		const r = mapa.get(pago.domiciliario_id);
		if (!r) continue;
		r.total_pagos += pago.valor;
		if (r.pagos.length < MAX_PAGOS) r.pagos.push(pago);
	}

	for (const r of mapa.values()) r.deuda = calcularDeuda(r.total_comision, r.total_pagos);
	return mapa;
}

const MAX_ENTREGADOS = 10000;
const PAGE = 1000;

/** Pedidos entregados de los domiciliarios, paginado (PostgREST ~1000 filas). */
async function obtenerEntregados(db: SupabaseClient, ids: string[]): Promise<Entrega[]> {
	const filas: Entrega[] = [];
	for (let offset = 0; offset < MAX_ENTREGADOS; offset += PAGE) {
		const { data, error } = await db
			.from('pedidos')
			.select('domiciliario_id, total, tarifa_base, recargo_total, updated_at')
			.eq('estado', 'entregado')
			.in('domiciliario_id', ids)
			.range(offset, offset + PAGE - 1);
		if (error) throw new Error(error.message);
		const lote = (data ?? []) as Entrega[];
		filas.push(...lote);
		if (lote.length < PAGE) break;
	}
	return filas;
}

/** Abonos de los domiciliarios, paginado (la suma total no debe truncarse). */
async function obtenerPagos(db: SupabaseClient, ids: string[]): Promise<PagoDomiciliario[]> {
	const filas: PagoDomiciliario[] = [];
	for (let offset = 0; offset < MAX_ENTREGADOS; offset += PAGE) {
		const { data, error } = await db
			.from('pagos_domiciliarios')
			.select('*')
			.in('domiciliario_id', ids)
			.order('created_at', { ascending: false })
			.range(offset, offset + PAGE - 1);
		if (error) throw new Error(error.message);
		const lote = (data ?? []) as PagoDomiciliario[];
		filas.push(...lote);
		if (lote.length < PAGE) break;
	}
	return filas;
}

function cuentaVacia(): CuentaResumen {
	return { total_comision: 0, total_pagos: 0, deuda: 0, pagos: [] };
}

function cuentaVaciaConHoy(): CuentaResumenConHoy {
	return {
		...cuentaVacia(),
		hoy: { fecha: fechaBogota(new Date().toISOString()), total: 0, nivel: null, comision: 0 }
	};
}
