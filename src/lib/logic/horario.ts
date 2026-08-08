/**
 * Lógica pura de horarios de operación (Fase 13 — tests unitarios).
 *
 * Sin dependencias de BD ni de UI. El horario se compone de:
 *   - horario_operacion: 7 filas (1 = Lunes … 7 = Domingo) con apertura,
 *     cierre y un interruptor abierto/cerrado.
 *   - horario_excepcion: fechas puntuales que anulan el día de la semana.
 *
 * Las horas se representan como 'HH:MM' (formato de 24 horas, hora de
 * Bogotá). El espejo SQL de estas reglas vive en public.horario_hoy()
 * (migración Fase 13), que es la fuente de verdad para la API y para el
 * bloqueo en crear_pedido(); estas funciones puras alimentan el panel del
 * admin y los tests.
 */

/** Etiqueta en español de un día de la semana (1 = Lunes … 7 = Domingo). */
export const DIAS_SEMANA: { dia: number; label: string }[] = [
	{ dia: 1, label: 'Lunes' },
	{ dia: 2, label: 'Martes' },
	{ dia: 3, label: 'Miércoles' },
	{ dia: 4, label: 'Jueves' },
	{ dia: 5, label: 'Viernes' },
	{ dia: 6, label: 'Sábado' },
	{ dia: 7, label: 'Domingo' }
];

export function etiquetaDia(dia: number): string {
	return DIAS_SEMANA.find((d) => d.dia === dia)?.label ?? `Día ${dia}`;
}

/** Valida que una hora tenga formato HH:MM de 24 horas. */
export function esHoraValida(h: string): boolean {
	return /^([01]\d|2[0-3]):[0-5]\d$/.test(h);
}

/**
 * Valida un par apertura/cierre. Devuelve un mensaje legible o null si es
 * válido. Se permite que el cierre sea MENOR a la apertura (horario que
 * cruza la medianoche, p. ej. 20:00 → 02:00); lo único prohibido es que
 * sean idénticos (duraría 0 minutos).
 */
export function validarHoras(apertura: string, cierre: string): string | null {
	if (!esHoraValida(apertura) || !esHoraValida(cierre)) {
		return 'Las horas deben tener formato HH:MM (24 horas).';
	}
	if (apertura === cierre) {
		return 'La apertura y el cierre no pueden ser la misma hora.';
	}
	return null;
}

/**
 * ¿Está abierto a la hora indicada? `horaActual` debe ser 'HH:MM'.
 * Un cierre menor a la apertura cruza la medianoche.
 */
export function horarioAbierto(apertura: string, cierre: string, horaActual: string): boolean {
	if (!esHoraValida(apertura) || !esHoraValida(cierre) || !esHoraValida(horaActual)) return false;
	if (cierre > apertura) {
		return horaActual >= apertura && horaActual < cierre;
	}
	// Cruza la medianoche: abierto desde apertura hasta las 23:59 y desde 00:00 hasta cierre.
	return horaActual >= apertura || horaActual < cierre;
}

/**
 * Día de la semana (1 = Lunes … 7 = Domingo) de una fecha YYYY-MM-DD en
 * hora de Bogotá (UTC-5): útil para consultas deterministas en los tests.
 * Devuelve 0 si la fecha no es válida.
 */
export function diaDeFecha(fecha: string): number {
	const [y, m, d] = fecha.split('-').map(Number);
	// Validación estricta: los rangos fuera de límite (p. ej. 13-40) hacen que
	// Date.UTC haga rollover en vez de fallar; aquí se rechazan explícitamente.
	if (!Number.isInteger(y) || y < 1 || !Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(d) || d < 1 || d > 31) {
		return 0;
	}
	const dt = new Date(Date.UTC(y, m - 1, d));
	if (Number.isNaN(dt.getTime())) return 0;
	// getUTCDay: 0 = Domingo … 6 = Sábado → se convierte a 1..7 (Lun..Dom).
	const domingo = dt.getUTCDay();
	return domingo === 0 ? 7 : domingo;
}
