import type { SupabaseClient } from '@supabase/supabase-js';
import {
	comisionDiaria,
	fechaBogota,
	mismasEscaleras,
	nivelDiario,
	nivelesParaFecha,
	totalesDiarios
} from '$lib/logic/comisiones';
import type { ComisionHistorico, ComisionNivel, PagoDomiciliario, ResumenDia } from '$lib/types';

/**
 * Cuentas de comisiones (Fase 10 + 11 + 13 + 23).
 *
 * Fase 23: La deuda y el crédito a favor se almacenan como saldos
 * persistentes en domiciliarios (deuda_actual, credito_favor). Ya NO se
 * recalculan desde cero en cada petición. El ledger `deuda_movimientos`
 * registra cada generación y abono para auditoría.
 *
 * El resumen de HOY (entregas de hoy → comisión del día) se calcula
 * en tiempo real para mostrar el avance del día actual.
 */

export interface CuentaResumen {
	/** Deuda pendiente (saldo persistente de domiciliarios.deuda_actual). */
	deuda: number;
	/** Crédito a favor (saldo persistente de domiciliarios.credito_favor). */
	credito_favor: number;
	/** Últimos abonos (descendente). */
	pagos: PagoDomiciliario[];
}

/** Resumen de cuenta con el desglose del día de hoy (panel del domiciliario). */
export type CuentaResumenConHoy = CuentaResumen & { hoy: ResumenDia };

const MAX_PAGOS = 10;

/**
 * Cuenta de un solo domiciliario (su panel). Lee el saldo persistente
 * de deuda_actual/credito_favor y calcula el resumen de HOY.
 */
export async function obtenerCuentaDomiciliario(
	db: SupabaseClient,
	domiciliarioId: string
): Promise<{ niveles: ComisionNivel[]; bloqueado: boolean; resumen: CuentaResumen; hoy: ResumenDia }> {
	const { data: fila } = await db
		.from('domiciliarios')
		.select('bloqueado, deuda_actual, credito_favor')
		.eq('id', domiciliarioId)
		.maybeSingle();

	const { data: niveles } = await db.from('comision_niveles').select('*').order('nivel');

	const resumenes = await obtenerResumenes(db, [domiciliarioId], (niveles ?? []) as ComisionNivel[]);
	const resumen = resumenes.get(domiciliarioId) ?? cuentaVaciaConHoy();

	// Usar saldo persistente (Fase 23) en lugar del recalculado
	if (fila) {
		resumen.deuda = fila.deuda_actual ?? 0;
		resumen.credito_favor = fila.credito_favor ?? 0;
	}

	return {
		niveles: (niveles ?? []) as ComisionNivel[],
		bloqueado: fila?.bloqueado === true,
		resumen,
		hoy: resumen.hoy
	};
}

/**
 * Resumen de deuda para un conjunto de domiciliarios (panel admin y panel
 * del domiciliario).
 *
 * Fase 23: Lee deuda_actual y credito_favor directamente de domiciliarios
 * (saldo persistente). Solo calcula el resumen de HOY en tiempo real.
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

	// Fase 23: Leer saldos persistentes de domiciliarios
	const { data: domiciliarios } = await db
		.from('domiciliarios')
		.select('id, deuda_actual, credito_favor')
		.in('id', unicos);

	for (const id of unicos) {
		const dom = domiciliarios?.find((d) => d.id === id);
		mapa.set(id, {
			deuda: dom?.deuda_actual ?? 0,
			credito_favor: dom?.credito_favor ?? 0,
			pagos: [],
			hoy: { fecha: hoyBogota, total: 0, nivel: null, comision: 0 }
		});
	}

	// Calcular resumen de HOY (entregas de hoy → comisión del día actual)
	const escalera = (niveles ?? ((await db.from('comision_niveles').select('*').order('nivel')).data ?? [])) as ComisionNivel[];
	const { data: historico } = await db.from('comision_historico').select('fecha, niveles');
	const porFecha = new Map<string, ComisionNivel[]>(
		((historico ?? []) as ComisionHistorico[]).map((h) => [h.fecha, h.niveles])
	);
	const entregados = await obtenerEntregadosHoy(db, unicos);
	const porDia = totalesDiarios(entregados);
	for (const [domId, dias] of porDia) {
		const r = mapa.get(domId);
		if (!r) continue;
		r.hoy = comisionHoy(porFecha, escalera, dias, hoyBogota);
	}

	// Abonos recientes (paginado)
	const rPagos = await obtenerPagos(db, unicos);
	for (const pago of rPagos) {
		const r = mapa.get(pago.domiciliario_id);
		if (!r) continue;
		if (r.pagos.length < MAX_PAGOS) r.pagos.push(pago);
	}

	return mapa;
}

/**
 * Resumen de HOY: comisión generada hoy por el domiciliario.
 * Solo calcula las entregas de hoy (consultas ligeras).
 */
function comisionHoy(
	porFecha: Map<string, ComisionNivel[]>,
	escalera: ComisionNivel[],
	totales: Map<string, number> | undefined,
	hoyBogota: string
): ResumenDia {
	let hoy: ResumenDia = { fecha: hoyBogota, total: 0, nivel: null, comision: 0, escalera_anterior: false };
	for (const [fecha, totalDia] of totales ?? []) {
		if (fecha !== hoyBogota) continue;
		const nivelesDia = nivelesParaFecha(porFecha, fecha, escalera);
		const comision = comisionDiaria(nivelesDia, totalDia);
		hoy = {
			fecha,
			total: totalDia,
			nivel: nivelDiario(nivelesDia, totalDia)?.nivel ?? null,
			comision,
			escalera_anterior: !mismasEscaleras(nivelesDia, escalera)
		};
	}
	return hoy;
}

const PAGE = 1000;

/** Solo pedidos entregados HOY (consulta ligera para el resumen del día). */
async function obtenerEntregadosHoy(db: SupabaseClient, ids: string[]): Promise<{ domiciliario_id: string | null; total: number | null; tarifa_base: number; recargo_total: number; updated_at: string }[]> {
	const hoyInicio = new Date();
	hoyInicio.setUTCHours(5, 0, 0, 0); // 00:00 Bogotá = 05:00 UTC
	const { data, error } = await db
		.from('pedidos')
		.select('domiciliario_id, total, tarifa_base, recargo_total, updated_at')
		.eq('estado', 'entregado')
		.in('domiciliario_id', ids)
		.gte('updated_at', hoyInicio.toISOString())
		.limit(PAGE);
	if (error) throw new Error(error.message);
	return (data ?? []) as { domiciliario_id: string | null; total: number | null; tarifa_base: number; recargo_total: number; updated_at: string }[];
}

/** Abonos de los domiciliarios, paginado (la suma total no debe truncarse). */
async function obtenerPagos(db: SupabaseClient, ids: string[]): Promise<PagoDomiciliario[]> {
	const filas: PagoDomiciliario[] = [];
	for (let offset = 0; offset < 10000; offset += PAGE) {
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
	return { deuda: 0, credito_favor: 0, pagos: [] };
}

function cuentaVaciaConHoy(): CuentaResumenConHoy {
	return {
		...cuentaVacia(),
		hoy: { fecha: fechaBogota(new Date().toISOString()), total: 0, nivel: null, comision: 0 }
	};
}
