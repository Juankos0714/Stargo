/**
 * Lógica pura de alertas (Parte 9 — tests unitarios).
 *
 * Decide qué pedidos pendientes están vencidos, si una alerta está en
 * cooldown y arma el texto del webhook. Sin dependencias de BD ni de UI;
 * la parte de red (webhook, Supabase) vive en $lib/server/alertas.
 */

export type NivelAlerta = 'info' | 'warning' | 'critical';

/** Peso numérico del nivel (para ordenar por severidad). */
export function pesoNivel(nivel: NivelAlerta): number {
	return nivel === 'critical' ? 3 : nivel === 'warning' ? 2 : 1;
}

export interface PedidoPendiente {
	numero: string;
	created_at: string;
}

export interface PedidoVencido {
	numero: string;
	minutos: number;
}

/**
 * Filtra los pedidos pendientes que llevan más de `umbralMin` minutos sin
 * asignar, ordenados del más antiguo al más reciente (los más críticos
 * primero). Minutos = antigüedad redondeada hacia abajo.
 */
export function pedidosPendientesVencidos(
	pedidos: PedidoPendiente[],
	ahora: Date,
	umbralMin: number
): PedidoVencido[] {
	const umbralMs = umbralMin * 60_000;
	return pedidos
		.map((p) => ({ numero: p.numero, t: new Date(p.created_at).getTime() }))
		.filter((p) => !Number.isNaN(p.t) && ahora.getTime() - p.t > umbralMs)
		.map((p) => ({ numero: p.numero, minutos: Math.floor((ahora.getTime() - p.t) / 60_000) }))
		.sort((a, b) => b.minutos - a.minutos);
}

/**
 * true si existe al menos una alerta del mismo evento dentro de la ventana
 * de cooldown (evita spamear el webhook cada ejecución del cron).
 */
export function hayAlertaReciente(
	createdAtAlertas: (string | null | undefined)[],
	ahora: Date,
	cooldownMin: number
): boolean {
	const limite = ahora.getTime() - cooldownMin * 60_000;
	return createdAtAlertas.some((c) => {
		const t = new Date(c ?? '').getTime();
		return !Number.isNaN(t) && t > limite;
	});
}

/** Texto legible del webhook (compatible Slack/Discord: campo `text`). */
export function textoWebhook(evento: string, nivel: NivelAlerta, detalle: string, entorno: string): string {
	const emoji = nivel === 'critical' ? '🚨' : nivel === 'warning' ? '⚠️' : 'ℹ️';
	const base = `[StarGo · ${entorno}] ${emoji} ${evento}`;
	return detalle ? `${base}\n${detalle}` : base;
}
