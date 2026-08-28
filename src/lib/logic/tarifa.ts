/**
 * Lógica pura de tarificación (Parte 1 — tests unitarios).
 *
 * Sin dependencias de BD ni de UI: recibe barrios ya resueltos contra la BD
 * y la matriz de tarifas, y devuelve el precio con su motivo. Es el espejo
 * en TypeScript de la función SQL public.calcular_tarifa().
 *
 * Casos de borde cubiertos de forma controlada (nunca silenciosa):
 *   - barrio no encontrado           → motivo 'barrio_no_encontrado'
 *   - barrio sin sector asignado     → motivo 'zona_no_disponible'
 *   - origen/destino en zona roja    → motivo 'zona_no_disponible'
 *   - trayecto sin tarifa (ni directa ni simétrica) → motivo 'sin_tarifa'
 */

export type MotivoTarifa = 'ok' | 'barrio_no_encontrado' | 'zona_no_disponible' | 'sin_tarifa';

export interface ResultadoTarifa {
	valor: number | null;
	meta: {
		disponible: boolean;
		motivo: MotivoTarifa;
		barrio_origen?: string | null;
		barrio_destino?: string | null;
		zona_origen?: string | null;
		zona_destino?: string | null;
	};
}

/** Barrio ya resuelto contra la BD (solo lo que necesita la tarificación). */
export interface BarrioResuelto {
	id?: string;
	nombre: string | null;
	zona_id: string | null;
}

/** Fila de la matriz de tarifas (origen → destino). */
export interface TarifaMatriz {
	zona_origen_id: string;
	zona_destino_id: string;
	valor: number | null;
}

/** Zona sin servicio de domicilios (nunca tiene tarifa). */
export const ZONA_ROJA = 'zona_roja';

/**
 * Busca en la matriz la tarifa directa y, si no existe, la del sentido
 * inverso (la matriz es simétrica). Una fila con valor null se trata como
 * «no hay tarifa» y permite caer al fallback inverso.
 */
export function buscarTarifa(
	zonaOrigen: string,
	zonaDestino: string,
	tarifas: TarifaMatriz[]
): number | null {
	const directa = tarifas.find(
		(t) => t.zona_origen_id === zonaOrigen && t.zona_destino_id === zonaDestino
	);
	if (directa != null && directa.valor != null) return directa.valor;

	const inversa = tarifas.find(
		(t) => t.zona_origen_id === zonaDestino && t.zona_destino_id === zonaOrigen
	);
	return inversa?.valor ?? null;
}

/**
 * Calcula la tarifa a partir de los barrios ya resueltos y la matriz.
 * Devuelve siempre un ResultadoTarifa (los fallos son controlados y
 * explicados en meta.motivo, nunca excepciones).
 */
export function calcularTarifaPura(
	origen: BarrioResuelto | null,
	destino: BarrioResuelto | null,
	tarifas: TarifaMatriz[]
): ResultadoTarifa {
	if (!origen || !destino) {
		return {
			valor: null,
			meta: {
				disponible: false,
				motivo: 'barrio_no_encontrado',
				barrio_origen: origen?.nombre ?? null,
				barrio_destino: destino?.nombre ?? null
			}
		};
	}

	// Un trayecto que empieza y termina en el mismo barrio no tiene una
	// tarifa automática. Esta validación se hace con el ID, no con la zona:
	// barrios diferentes de una misma zona conservan la tarifa de la matriz.
	if (origen.id && origen.id === destino.id) {
		return {
			valor: null,
			meta: {
				disponible: false,
				motivo: 'sin_tarifa',
				barrio_origen: origen.nombre,
				barrio_destino: destino.nombre,
				zona_origen: origen.zona_id,
				zona_destino: destino.zona_id
			}
		};
	}

	if (
		!origen.zona_id ||
		!destino.zona_id ||
		origen.zona_id === ZONA_ROJA ||
		destino.zona_id === ZONA_ROJA
	) {
		return {
			valor: null,
			meta: {
				disponible: false,
				motivo: 'zona_no_disponible',
				barrio_origen: origen.nombre,
				barrio_destino: destino.nombre,
				zona_origen: origen.zona_id,
				zona_destino: destino.zona_id
			}
		};
	}

	const valor = buscarTarifa(origen.zona_id, destino.zona_id, tarifas);
	return {
		valor,
		meta: {
			disponible: valor != null,
			motivo: valor == null ? 'sin_tarifa' : 'ok',
			barrio_origen: origen.nombre,
			barrio_destino: destino.nombre,
			zona_origen: origen.zona_id,
			zona_destino: destino.zona_id
		}
	};
}
