/**
 * Lógica pura de métricas operativas (Parte 9 — tests unitarios).
 *
 * Calcula indicadores de la operación a partir de datos ya consultados:
 * tiempos promedio de asignación/entrega, tasa de errores por minuto y
 * formato de duración. Sin dependencias de BD ni de UI.
 */

/** Minutos (redondeados) entre el created_at del pedido y su hito. */
export function minutosHito(pedidoCreatedAt: string, hitoCreatedAt: string): number | null {
	const pedido = new Date(pedidoCreatedAt).getTime();
	const hito = new Date(hitoCreatedAt).getTime();
	if (Number.isNaN(pedido) || Number.isNaN(hito)) return null;
	const ms = hito - pedido;
	if (ms < 0) return null; // hito anterior al pedido: dato inconsistente
	return Math.round(ms / 60_000);
}

/** Promedio en minutos (redondeado) de una lista; null si está vacía. */
export function promedioMinutos(valores: number[]): number | null {
	if (valores.length === 0) return null;
	return Math.round(valores.reduce((a, b) => a + b, 0) / valores.length);
}

/**
 * Errores por minuto con 2 decimales. ventanaMinutos <= 0 devuelve 0
 * (evita división por cero ante una ventana mal configurada).
 */
export function erroresPorMinuto(conteo: number, ventanaMinutos: number): number {
	if (ventanaMinutos <= 0) return 0;
	return Math.round((conteo / ventanaMinutos) * 100) / 100;
}

/** "12 min", "1 h 05 min", "3 h" o "—" si no hay dato. */
export function formatearDuracion(min: number | null): string {
	if (min === null) return '—';
	if (min < 60) return `${min} min`;
	const h = Math.floor(min / 60);
	const m = min % 60;
	return m > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
}
