/**
 * Utilidades de formateo (Parte 1 — tests unitarios).
 *
 * Moneda (COP), fechas y tiempos relativos. Funciones puras, sin estado ni
 * dependencias; se testean con casos límite (null, NaN, fechas inválidas).
 */

/** Formatea un valor como pesos colombianos (sin decimales). */
export function formatearPeso(valor: number | null | undefined): string {
	if (valor == null || Number.isNaN(valor)) return '—';
	return new Intl.NumberFormat('es-CO', {
		style: 'currency',
		currency: 'COP',
		maximumFractionDigits: 0
	}).format(valor);
}

/** Fecha corta en español: día + mes abreviado + hora:minuto. */
export function formatearFecha(iso: string): string {
	const fecha = new Date(iso);
	if (Number.isNaN(fecha.getTime())) return '—';
	return fecha.toLocaleString('es-CO', {
		day: '2-digit',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});
}

/**
 * Tiempo relativo en español: «justo ahora», «hace 5 min», «hace 2 h»,
 * «hace 3 días», «hace 1 mes»… Usa `ahora` como referencia (útil en tests).
 */
export function tiempoRelativo(iso: string, ahora: Date = new Date()): string {
	const fecha = new Date(iso);
	if (Number.isNaN(fecha.getTime())) return '—';

	const segundos = Math.max(0, Math.floor((ahora.getTime() - fecha.getTime()) / 1000));
	if (segundos < 60) return 'justo ahora';

	const minutos = Math.floor(segundos / 60);
	if (minutos < 60) return `hace ${minutos} min`;

	const horas = Math.floor(minutos / 60);
	if (horas < 24) return `hace ${horas} h`;

	const dias = Math.floor(horas / 24);
	if (dias < 30) return dias === 1 ? 'hace 1 día' : `hace ${dias} días`;

	const meses = Math.floor(dias / 30);
	if (meses < 12) return meses === 1 ? 'hace 1 mes' : `hace ${meses} meses`;

	const anios = Math.floor(meses / 12);
	return anios === 1 ? 'hace 1 año' : `hace ${anios} años`;
}
