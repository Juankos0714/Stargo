import type { SupabaseClient } from '@supabase/supabase-js';
import { erroresPorMinuto, minutosHito, promedioMinutos } from '$lib/logic/metricas';
import { EN_CURSO } from './reportes';

/**
 * Métricas operativas del dashboard (Parte 9).
 *
 * Consulta la BD con el cliente del ADMIN (por eso RLS deja leer pedidos,
 * historial_estados, errores_app, alertas e historial_tarifas) y calcula:
 *   - pedidos activos (pendiente + en curso);
 *   - tiempo promedio de asignación y de entrega (últimas 24 h);
 *   - errores por minuto (última hora);
 *   - últimas alertas emitidas;
 *   - cambios recientes de tarifas (auditoría, sección 14 del doc funcional).
 */

export interface AlertaRegistrada {
	id: number;
	evento: string;
	nivel: 'info' | 'warning' | 'critical';
	detalle: string | null;
	created_at: string;
}

export interface CambioTarifa {
	id: number;
	operacion: 'INSERT' | 'UPDATE' | 'DELETE';
	zona_origen_id: string | null;
	zona_destino_id: string | null;
	valor_antes: number | null;
	valor_despues: number | null;
	usuario_id: string | null;
	created_at: string;
}

export interface MetricasDashboard {
	pedidos_activos: number;
	/** Minutos promedio pedido→asignado (últimas 24 h); null si no hay datos. */
	tiempo_asignacion_prom_min: number | null;
	/** Minutos promedio pedido→entregado (últimas 24 h); null si no hay datos. */
	tiempo_entrega_prom_min: number | null;
	errores_por_minuto: number;
	errores_ultima_hora: number;
	alertas_recientes: AlertaRegistrada[];
	historial_tarifas: CambioTarifa[];
	generado_en: string;
}

const VENTANA_TIEMPOS_H = 24;
const VENTANA_ERRORES_MIN = 60;
const ULTIMAS = 10;

function isoHace(horas: number): string {
	return new Date(Date.now() - horas * 60 * 60 * 1000).toISOString();
}

/**
 * Minutos entre el created_at del pedido y su PRIMER hito del estado dado.
 * Devuelve el mínimo por pedido (una reasignación no cuenta dos veces).
 */
function minutosPorHito(
	hitos: { pedido_id: string; estado: string; created_at: string }[],
	pedidos: Map<string, string>,
	estado: string
): number[] {
	const porPedido = new Map<string, string>();
	for (const h of hitos) {
		if (h.estado !== estado) continue;
		const actual = porPedido.get(h.pedido_id);
		if (!actual || h.created_at < actual) porPedido.set(h.pedido_id, h.created_at);
	}
	const diffs: number[] = [];
	for (const [pedidoId, hito] of porPedido) {
		const creado = pedidos.get(pedidoId);
		if (!creado) continue;
		const min = minutosHito(creado, hito);
		if (min !== null) diffs.push(min);
	}
	return diffs;
}

export async function obtenerMetricas(db: SupabaseClient): Promise<MetricasDashboard> {
	// 1) Pedidos activos (pendiente + en curso), sin importar la fecha.
	const { count: activos } = await db
		.from('pedidos')
		.select('id', { count: 'exact', head: true })
		.in('estado', ['pendiente', ...EN_CURSO]);

	// 2) Tiempos promedio: hitos de las últimas 24 h unidos con su pedido.
	const { data: hitos, error: errHitos } = await db
		.from('historial_estados')
		.select('pedido_id, estado, created_at')
		.in('estado', ['asignado', 'entregado'])
		.gte('created_at', isoHace(VENTANA_TIEMPOS_H))
		.order('created_at', { ascending: true });

	const ids = [...new Set((hitos ?? []).map((h) => h.pedido_id))];
	const pedidos = new Map<string, string>();
	if (!errHitos && ids.length > 0) {
		const { data: filas } = await db
			.from('pedidos')
			.select('id, created_at')
			.in('id', ids.slice(0, 500));
		for (const f of filas ?? []) pedidos.set(f.id, f.created_at);
	}

	const tiempoAsignacion = promedioMinutos(minutosPorHito(hitos ?? [], pedidos, 'asignado'));
	const tiempoEntrega = promedioMinutos(minutosPorHito(hitos ?? [], pedidos, 'entregado'));

	// 3) Errores de la última hora.
	const { count: errores } = await db
		.from('errores_app')
		.select('id', { count: 'exact', head: true })
		.gte('created_at', isoHace(VENTANA_ERRORES_MIN / 60));

	// 4) Últimas alertas y auditoría de tarifas.
	const { data: alertas } = await db
		.from('alertas')
		.select('id, evento, nivel, detalle, created_at')
		.order('created_at', { ascending: false })
		.limit(ULTIMAS);

	const { data: tarifas } = await db
		.from('historial_tarifas')
		.select('id, operacion, zona_origen_id, zona_destino_id, valor_antes, valor_despues, usuario_id, created_at')
		.order('created_at', { ascending: false })
		.limit(ULTIMAS);

	return {
		pedidos_activos: activos ?? 0,
		tiempo_asignacion_prom_min: tiempoAsignacion,
		tiempo_entrega_prom_min: tiempoEntrega,
		errores_por_minuto: erroresPorMinuto(errores ?? 0, VENTANA_ERRORES_MIN),
		errores_ultima_hora: errores ?? 0,
		alertas_recientes: (alertas ?? []) as AlertaRegistrada[],
		historial_tarifas: (tarifas ?? []) as CambioTarifa[],
		generado_en: new Date().toISOString()
	};
}
