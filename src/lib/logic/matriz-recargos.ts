/**
 * Matriz de visibilidad de recargos por tipo de diligencia.
 *
 * Compartida entre el formulario del cliente y la validación server-side
 * para garantizar integridad de datos (el cliente filtra la UI, el
 * servidor valida el payload antes de insertar en la BD).
 *
 * visibles:  tipos de recargo que el usuario puede seleccionar.
 * ocultos:   tipos que nunca deben aparecer (redundantes o no aplican).
 * obligatorios: tipos que se auto-seleccionan al elegir la diligencia.
 */

export interface ReglaRecargos {
	visibles: string[];
	ocultos: string[];
	obligatorios: string[];
}

export const MATRIZ_RECARGOS: Record<string, ReglaRecargos> = {
	pago: {
		visibles: ['tiempo_espera', 'paradas', 'otro'],
		ocultos: ['compra', 'peso', 'pago'],
		obligatorios: []
	},
	banco: {
		visibles: ['tiempo_espera', 'paradas', 'otro'],
		ocultos: ['compra', 'peso', 'pago'],
		obligatorios: []
	},
	compra: {
		visibles: ['compra', 'tiempo_espera', 'paradas', 'peso', 'pago', 'otro'],
		ocultos: [],
		obligatorios: ['compra']
	},
	tramite: {
		visibles: ['tiempo_espera', 'paradas', 'otro'],
		ocultos: ['compra', 'peso', 'pago'],
		obligatorios: []
	},
	otro: {
		visibles: ['tiempo_espera', 'paradas', 'pago', 'otro'],
		ocultos: ['compra', 'peso'],
		obligatorios: []
	}
};

/**
 * Valida que un array de códigos de recargo sean válidos para un tipo
 * de diligencia dado. Devuelve los códigos filtrados (solo los válidos).
 *
 * @param tipoDiligencia - Tipo de diligencia del pedido.
 * @param recargos       - Códigos de recargo enviados por el cliente.
 * @param tiposPorCodigo - Mapa de código → tipo de recargo (catálogo de BD).
 * @returns Códigos válidos; si hay inválidos, también retorna un error string.
 */
export function filtrarRecargosServidor(
	tipoDiligencia: string | null | undefined,
	recargos: string[],
	tiposPorCodigo: Map<string, string>
): { validos: string[]; error?: string } {
	if (!tipoDiligencia || recargos.length === 0) {
		return { validos: recargos };
	}

	const matriz = MATRIZ_RECARGOS[tipoDiligencia];
	if (!matriz) {
		// Tipo de diligencia desconocido: rechazar todos los recargos.
		return {
			validos: [],
			error: `Tipo de diligencia no válido: ${tipoDiligencia}`
		};
	}

	const visibles = new Set(matriz.visibles);
	const validos: string[] = [];
	const invalidos: string[] = [];

	for (const codigo of recargos) {
		const tipo = tiposPorCodigo.get(codigo);
		if (tipo && visibles.has(tipo)) {
			validos.push(codigo);
		} else {
			invalidos.push(codigo);
		}
	}

	if (invalidos.length > 0) {
		return {
			validos,
			error: `Recargos no válidos para ${tipoDiligencia}: ${invalidos.join(', ')}`
		};
	}

	return { validos };
}
