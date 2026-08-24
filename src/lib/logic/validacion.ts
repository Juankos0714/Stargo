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
	motivoCancelacion: 300,
	nombreCliente: 120
} as const;

/** Tipo de diligencia dentro de compra/diligencia. */
export type TipoDiligencia = 'pago' | 'banco' | 'compra' | 'tramite' | 'otro' | '';

export interface DatosPedido {
	barrioOrigen: string | null;
	barrioDestino: string | null;
	direccionOrigen: string;
	direccionDestino: string;
	observaciones: string;
	recargos?: string[];
	/** 'domicilio' (default) o 'compra_diligencia' (Fase 14). */
	tipoServicio?: string;
	/** El usuario marcó explícitamente que no aplican recargos (Fase 14). */
	recargosConfirmadosNoAplica?: boolean;
	/** Celular del cliente: obligatorio para coordinar por WhatsApp (Fase 19). */
	telefono: string;
	/** Nombre del cliente, opcional (Fase 19): saluda en el mensaje de WhatsApp cuando existe. */
	nombreCliente?: string;

	// ---- Campos de diligencia (compra/diligencia) ----
	/** Tipo de diligencia seleccionado (pago, banco, compra, tramite, otro). */
	tipoDiligencia?: TipoDiligencia;
	/** Descripción de la diligencia (pago, banco). */
	dilDescripcion?: string;
	/** Valor de la factura / valor a pagar (pago, banco). */
	dilValorFactura?: string;
	/** Costo de la diligencia (todos los tipos). */
	dilCostoDiligencia?: string;
	/** Entidad / banco (banco). */
	dilEntidad?: string;
	/** Productos / descripción (compra). */
	dilProductos?: string;
	/** Cantidad (compra). */
	dilCantidad?: string;
	/** Presupuesto / valor estimado (compra). */
	dilPresupuesto?: string;
	/** Tipo de trámite (tramite). */
	dilTramite?: string;
	/** Instrucciones (tramite, otro). */
	dilInstrucciones?: string;
	/** Lugar del trámite (tramite). */
	dilLugarTramite?: string;
	/** Descripción de "otra" diligencia (otro). */
	dilOtraDescripcion?: string;
	/** El usuario necesita recoger algo antes (compra/diligencia). */
	necesitaRecoger?: boolean | null;
}

/**
 * Valida el formulario de pedido. Devuelve un mapa de errores por campo
 * (vacío = formulario válido).
 *
 * Reglas por tipo de servicio (Fase 14):
 *   - domicilio:         origen Y destino obligatorios (como siempre).
 *   - compra_diligencia: destino obligatorio; origen OPCIONAL (p. ej. un pago
 *     bancario solo va al banco).
 * Recargos: se exige una decisión explícita — elegir recargos o marcar
 * «No aplica» (recargosConfirmadosNoAplica) — antes de poder enviar.
 *
 * Reglas por tipo de diligencia:
 *   - pago:     descripción, valor factura, costo obligatorios.
 *   - banco:    entidad, descripción, valor, costo obligatorios.
 *   - compra:   productos, costo obligatorios.
 *   - tramite:  trámite, instrucciones, costo obligatorios.
 *   - otro:     descripción, costo obligatorios.
 */
export function validarPedido(d: DatosPedido): Record<string, string> {
	const errores: Record<string, string> = {};
	const tipoServicio = d.tipoServicio === 'compra_diligencia' ? 'compra_diligencia' : 'domicilio';

	if (tipoServicio === 'domicilio' && !d.barrioOrigen) errores.origen = 'Selecciona el barrio de origen.';
	if (!d.barrioDestino) errores.destino = 'Selecciona el barrio de destino.';

	if (tipoServicio === 'domicilio') {
		if (!d.direccionOrigen.trim()) errores.dirOrigen = 'La dirección de origen es obligatoria.';
		else if (d.direccionOrigen.length > LIMITES.direccion) {
			errores.dirOrigen = `Máximo ${LIMITES.direccion} caracteres.`;
		}
	} else if (d.direccionOrigen.length > LIMITES.direccion) {
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
	} else if ((d.recargos?.length ?? 0) === 0 && d.recargosConfirmadosNoAplica !== true) {
		// Decisión explícita de recargos: elegir o marcar «No aplica».
		errores.recargos = 'Indica si aplican recargos a tu pedido o marca «No aplica».';
	}

	// Teléfono del cliente (Fase 19): obligatorio y en formato colombiano.
	if (!validarTelefono(d.telefono)) {
		errores.telefono = (d.telefono ?? '').trim()
			? 'Ingresa un número de celular colombiano válido (10 dígitos).'
			: 'El teléfono es obligatorio para coordinar la entrega.';
	}

	// Nombre del cliente (opcional, Fase 19): solo tope de longitud.
	if ((d.nombreCliente ?? '').length > LIMITES.nombreCliente) {
		errores.nombreCliente = `Máximo ${LIMITES.nombreCliente} caracteres.`;
	}

	// ---- Validaciones por tipo de diligencia ----
	if (tipoServicio === 'compra_diligencia') {
		const td = d.tipoDiligencia ?? '';

		if (!td) {
			errores.tipoDiligencia = 'Selecciona el tipo de diligencia.';
		} else {
			// Costo de la diligencia siempre obligatorio
			const costo = (d.dilCostoDiligencia ?? '').trim();
			if (!costo) {
				errores.dilCostoDiligencia = 'El costo de la diligencia es obligatorio.';
			} else if (Number(costo) < 0) {
				errores.dilCostoDiligencia = 'El costo no puede ser negativo.';
			}

			if (td === 'pago') {
				// Pago de factura o servicio
				if (!(d.dilDescripcion ?? '').trim()) {
					errores.dilDescripcion = 'La descripción del pago es obligatoria.';
				}
				if (!(d.dilValorFactura ?? '').trim()) {
					errores.dilValorFactura = 'El valor de la factura es obligatorio.';
				}
			} else if (td === 'banco') {
				// Pago bancario o corresponsal
				if (!(d.dilEntidad ?? '').trim()) {
					errores.dilEntidad = 'La entidad o banco es obligatorio.';
				}
				if (!(d.dilDescripcion ?? '').trim()) {
					errores.dilDescripcion = 'La descripción del pago es obligatoria.';
				}
				if (!(d.dilValorFactura ?? '').trim()) {
					errores.dilValorFactura = 'El valor a pagar es obligatorio.';
				}
			} else if (td === 'compra') {
				// Compra de productos
				if (!(d.dilProductos ?? '').trim()) {
					errores.dilProductos = 'Describe los productos que necesitas.';
				}
			} else if (td === 'tramite') {
				// Trámite o documento
				if (!(d.dilTramite ?? '').trim()) {
					errores.dilTramite = 'Indica qué trámite necesitas.';
				}
				if (!(d.dilInstrucciones ?? '').trim()) {
					errores.dilInstrucciones = 'Las instrucciones son obligatorias.';
				}
			} else if (td === 'otro') {
				// Otra diligencia
				if (!(d.dilOtraDescripcion ?? '').trim()) {
					errores.dilOtraDescripcion = 'Describe la diligencia.';
				}
			}
		}
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
