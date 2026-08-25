/**
 * Motor de precios — Modelo de tramos y anti-duplicación.
 *
 * Regla central: un pedido se cobra por "tramos" (legs), no por "tipo de
 * diligencia". Cada tramo tiene un propósito y una sola tabla de precio
 * le aplica — nunca dos.
 *
 * - Tramo principal de `diligencia_bancaria`: precio de tabla_recargos.pagos.
 *   NO se cobra además por matriz_domicilio.
 * - Tramo principal de `domicilio`, `compra` o `tramite`: precio de
 *   matriz_domicilio (origen → destino).
 * - Tramo adicional de recogida: se cobra con matriz_domicilio.
 * - Recargos: se suman al total, pero nunca duplican lo que ya está en el
 *   precio base del tramo principal.
 */

import { obtenerTarifaDomicilio, type SectorId } from './matriz-domicilio';
import {
	TABLA_RECARGOS,
	recargoPeso,
	recargoTransferencia,
	recargoPagoAlto,
	recargoCompra,
	type TipoPago
} from './tabla-recargos';

// ---------- Tipos ----------

export type TipoDiligencia =
	| 'domicilio'
	| 'compra'
	| 'diligencia_bancaria'
	| 'tramite'
	| 'otro';

export interface Tramo {
	origen: SectorId;
	destino: SectorId;
	proposito: 'pago' | 'recogida_extra' | 'domicilio' | 'compra' | 'tramite';
}

export interface RecargoSeleccionado {
	id: string;
	// Campos opcionales según el tipo de recargo
	bloques_20min?: number;
	paradas?: number;
}

export interface PedidoCalculo {
	tipo_diligencia: TipoDiligencia;
	subtipo_pago?: TipoPago; // 'bancario' | 'corresponsal' — solo si diligencia_bancaria
	tramo_principal: Tramo;
	tramos_adicionales: Tramo[];
	recargos: RecargoSeleccionado[];
	monto_pago?: number; // Para recargo_pagos_altos y transferencias
	peso_kg?: number;
}

export interface DesgloseTramo {
	origen: SectorId;
	destino: SectorId;
	proposito: string;
	valor: number;
	fuente: 'matriz_domicilio' | 'tabla_pagos';
}

export interface ResultadoCalculo {
	total: number;
	tramo_principal: DesgloseTramo;
	tramos_adicionales: DesgloseTramo[];
	recargos_desglose: { id: string; valor: number }[];
	recargo_total: number;
	disponible: boolean;
	aproximado: boolean; // true cuando el precio es estimado (sin tarifa exacta)
	motivo?: string;
}

// ---------- Motor de precios ----------

/**
 * Calcula el precio completo de un pedido usando el modelo de tramos.
 */
export function calcularPrecio(pedido: PedidoCalculo): ResultadoCalculo {
	let total = 0;
	const recargosDesglose: { id: string; valor: number }[] = [];
	let recargoTotal = 0;
	let esAproximado = false;

	// 1. Precio del tramo principal
	let tramoPrincipalDesglose: DesgloseTramo;

	if (pedido.tipo_diligencia === 'diligencia_bancaria') {
		// Para pagos bancarios, la tarifa PLANA ya incluye el desplazamiento.
		const subtipo = pedido.subtipo_pago ?? 'bancario';
		const valor = TABLA_RECARGOS.pagos[subtipo];

		tramoPrincipalDesglose = {
			origen: pedido.tramo_principal.origen,
			destino: pedido.tramo_principal.destino,
			proposito: 'pago',
			valor,
			fuente: 'tabla_pagos'
		};
		total += valor;
	} else {
		// Para domicilio, compra, tramite: matriz de zonas.
		const valorExacto = obtenerTarifaDomicilio(
			pedido.tramo_principal.origen,
			pedido.tramo_principal.destino
		);

		// Si no hay tarifa exacta, usar un mínimo estimado ($5,000 = mismo_sector)
		// y marcar como aproximado. El domiciliario confirma el precio final.
		const valorFinal = valorExacto ?? 5000;
		esAproximado = valorExacto === null;

		tramoPrincipalDesglose = {
			origen: pedido.tramo_principal.origen,
			destino: pedido.tramo_principal.destino,
			proposito: pedido.tramo_principal.proposito,
			valor: valorFinal,
			fuente: 'matriz_domicilio'
		};
		total += valorFinal;
	}

	// 2. Tramos adicionales (recogidas separadas del punto principal)
	const tramosAdicionalesDesglose: DesgloseTramo[] = [];
	for (const tramo of pedido.tramos_adicionales) {
		const valor = obtenerTarifaDomicilio(tramo.origen, tramo.destino);
		if (valor === null) {
			return {
				total: 0,
				tramo_principal: tramoPrincipalDesglose,
				tramos_adicionales: [],
				recargos_desglose: [],
				recargo_total: 0,
				disponible: false,
				motivo: 'sin_tarifa_tramo_adicional'
			};
		}
		tramosAdicionalesDesglose.push({
			origen: tramo.origen,
			destino: tramo.destino,
			proposito: tramo.proposito,
			valor,
			fuente: 'matriz_domicilio'
		});
		total += valor;
	}

	// 3. Recargos — nunca duplicar lo que ya está en el precio base
	for (const recargo of pedido.recargos) {
		const esRedundante =
			pedido.tipo_diligencia === 'diligencia_bancaria' &&
			(recargo.id === 'pagos_bancarios' || recargo.id === 'corresponsal');

		if (esRedundante) continue;

		let valor = 0;

		switch (recargo.id) {
			case 'recargo_compra':
			case 'compra':
				valor = recargoCompra(recargo.bloques_20min ?? 0, recargo.paradas ?? 0);
				break;
			case 'peso':
			case 'peso_extra':
				valor = recargoPeso(pedido.peso_kg ?? 0);
				break;
			case 'transferencias':
				valor = recargoTransferencia(pedido.monto_pago ?? 0);
				break;
			case 'recargo_pagos_altos':
				valor = recargoPagoAlto(pedido.monto_pago ?? 0);
				break;
			case 'tiempo_espera':
			case 'espera':
				// No tarifado en el PDF — se define aparte.
				valor = 0;
				break;
			default:
				valor = 0;
		}

		if (valor > 0) {
			recargosDesglose.push({ id: recargo.id, valor });
			recargoTotal += valor;
			total += valor;
		}
	}

	return {
		total,
		tramo_principal: tramoPrincipalDesglose,
		tramos_adicionales: tramosAdicionalesDesglose,
		recargos_desglose: recargosDesglose,
		recargo_total: recargoTotal,
		disponible: true,
		aproximado: esAproximado
	};
}

/**
 * Helper: crea un tramo principal a partir de origen/destino y tipo de diligencia.
 */
export function crearTramoPrincipal(
	origen: SectorId,
	destino: SectorId,
	tipo: TipoDiligencia
): Tramo {
	return { origen, destino, proposito: tipo as Tramo['proposito'] };
}
