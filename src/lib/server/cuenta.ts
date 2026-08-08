import type { SupabaseClient } from '@supabase/supabase-js';
import { calcularDeuda } from '$lib/logic/comisiones';
import type { ComisionNivel, PagoDomiciliario } from '$lib/types';

/**
 * Cuentas de comisiones (Fase 10 + 11).
 *
 * Deuda de un domiciliario = Σ comisiones de sus pedidos ENTREGADOS − Σ abonos
 * registrados. La comisión de cada pedido se congeló al entregarlo
 * (pedidos.comision) según el NIVEL que le correspondía por su valor; cambiar
 * un nivel después no altera las deudas pasadas.
 */

export interface CuentaResumen {
	total_comision: number;
	total_pagos: number;
	deuda: number;
	/** Últimos abonos (descendente). */
	pagos: PagoDomiciliario[];
}

const MAX_PAGOS = 10;

/**
 * Cuenta de un solo domiciliario (su panel). Devuelve los niveles vigentes
 * de comisión (para que sepa cuánto pagará por pedido), su bloqueo y el
 * resumen de deuda.
 */
export async function obtenerCuentaDomiciliario(
	db: SupabaseClient,
	domiciliarioId: string
): Promise<{ niveles: ComisionNivel[]; bloqueado: boolean; resumen: CuentaResumen }> {
	const { data: fila } = await db
		.from('domiciliarios')
		.select('bloqueado')
		.eq('id', domiciliarioId)
		.maybeSingle();

	const { data: niveles } = await db.from('comision_niveles').select('*').order('nivel');

	const resumen = await obtenerResumenes(db, [domiciliarioId]);
	return {
		niveles: (niveles ?? []) as ComisionNivel[],
		bloqueado: fila?.bloqueado === true,
		resumen: resumen.get(domiciliarioId) ?? cuentaVacia()
	};
}

/**
 * Resumen de deuda para un conjunto de domiciliarios (panel admin).
 * Consultas por lotes: pedidos entregados (Σ comisión) + abonos.
 */
export async function obtenerResumenes(
	db: SupabaseClient,
	ids: string[]
): Promise<Map<string, CuentaResumen>> {
	const mapa = new Map<string, CuentaResumen>();
	const unicos = [...new Set(ids)].filter(Boolean);
	if (unicos.length === 0) return mapa;
	for (const id of unicos) mapa.set(id, cuentaVacia());

	// 1) Comisiones generadas por pedidos entregados.
	const { data: entregados } = await db
		.from('pedidos')
		.select('domiciliario_id, comision')
		.eq('estado', 'entregado')
		.in('domiciliario_id', unicos);
	for (const p of entregados ?? []) {
		const r = mapa.get(p.domiciliario_id);
		if (r) r.total_comision += p.comision ?? 0;
	}

	// 2) Abonos (con pocos domiciliarios la lista es corta).
	const { data: rPagos } = await db
		.from('pagos_domiciliarios')
		.select('*')
		.in('domiciliario_id', unicos)
		.order('created_at', { ascending: false });

	for (const pago of (rPagos ?? []) as PagoDomiciliario[]) {
		const r = mapa.get(pago.domiciliario_id);
		if (!r) continue;
		r.total_pagos += pago.valor;
		if (r.pagos.length < MAX_PAGOS) r.pagos.push(pago);
	}

	for (const r of mapa.values()) r.deuda = calcularDeuda(r.total_comision, r.total_pagos);
	return mapa;
}

function cuentaVacia(): CuentaResumen {
	return { total_comision: 0, total_pagos: 0, deuda: 0, pagos: [] };
}
