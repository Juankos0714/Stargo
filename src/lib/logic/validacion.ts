/**
 * Validadores de formularios (Parte 1 — tests unitarios).
 *
 * Lógica pura de validación: teléfono, campos requeridos, longitudes y
 * motivos de cancelación. Sin dependencias de BD ni de UI. Los mensajes
 * coinciden con los que la API devuelve al cliente.
 */

export const LIMITES = {
	direccion: 300,
	observaciones: 1000,
	recargos: 15,
	motivoCancelacion: 300
} as const;

export interface DatosPedido {
	barrioOrigen: string | null;
	barrioDestino: string | null;
	direccionOrigen: string;
	direccionDestino: string;
	observaciones: string;
	recargos?: string[];
}

/**
 * Valida el formulario de pedido. Devuelve un mapa de errores por campo
 * (vacío = formulario válido).
 */
export function validarPedido(d: DatosPedido): Record<string, string> {
	const errores: Record<string, string> = {};

	if (!d.barrioOrigen) errores.origen = 'Selecciona el barrio de origen.';
	if (!d.barrioDestino) errores.destino = 'Selecciona el barrio de destino.';

	if (!d.direccionOrigen.trim()) errores.dirOrigen = 'La dirección de origen es obligatoria.';
	else if (d.direccionOrigen.length > LIMITES.direccion) {
		errores.dirOrigen = `Máximo ${LIMITES.direccion} caracteres.`;
	}

	if (!d.direccionDestino.trim()) errores.dirDestino = 'La dirección de destino es obligatoria.';
	else if (d.direccionDestino.length > LIMITES.direccion) {
		errores.dirDestino = `Máximo ${LIMITES.direccion} caracteres.`;
	}

	if (d.observaciones.length > LIMITES.observaciones) {
		errores.observaciones = `Máximo ${LIMITES.observaciones} caracteres.`;
	}

	if ((d.recargos?.length ?? 0) > LIMITES.recargos) {
		errores.recargos = `Selecciona máximo ${LIMITES.recargos} recargos.`;
	}

	return errores;
}

/**
 * Valida el motivo de cancelación: requerido y con longitud máxima.
 * Devuelve el mensaje de error o null si es válido.
 */
export function validarMotivoCancelacion(motivo: string): string | null {
	const m = (motivo ?? '').trim();
	if (!m) return 'Selecciona un motivo para cancelar.';
	if (m.length > LIMITES.motivoCancelacion) {
		return `El motivo es demasiado largo (máx. ${LIMITES.motivoCancelacion} caracteres).`;
	}
	return null;
}

/**
 * Teléfono móvil colombiano: 10 dígitos empezando por 3. Se ignora el
 * formato (espacios, guiones) y se descarta el prefijo de país +57 / 57
 * cuando acompaña a un número de 10 dígitos.
 */
export function validarTelefono(telefono: string): boolean {
	let limpio = (telefono ?? '').replace(/\D/g, '');
	if (limpio.length === 12 && limpio.startsWith('57')) limpio = limpio.slice(2);
	return /^3\d{9}$/.test(limpio);
}
