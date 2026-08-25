/**
 * Tabla de recargos — Tarifas 2026.
 *
 * Extraída del PDF "Tarifas 2026 Actualizadas".
 * Cada categoría tiene sus propias reglas de cálculo.
 */

export const TABLA_RECARGOS = {
	compras: {
		tiempo_varias_paradas: 3000,
		tiempo_mismo_lugar_cada_20min: 3000,
		por_parada: 3000
	},
	pagos: {
		bancario: 12000,
		corresponsal: 8000
		// Tarifa PLANA que ya incluye el desplazamiento hasta el punto
		// de pago. NO sumar además la matriz de domicilio para ese tramo.
	},
	recargo_pagos_altos: {
		por_millon_adicional: 2000
		// Aplica sobre pagos > $1,000,000: $2,000 por cada millón adicional.
	},
	peso: {
		mas_20kg: 2000,
		mas_40kg: 5000,
		mas_60kg: 10000
	},
	transferencias: {
		despues_100000: 2000,
		despues_500000: 4000,
		despues_1000000: 6000
	}
} as const;

export type TipoPago = keyof typeof TABLA_RECARGOS.pagos;

/**
 * Calcula el recargo por peso del paquete.
 * Escala escalonada: >20kg, >40kg, >60kg.
 */
export function recargoPeso(pesoKg: number): number {
	if (pesoKg > 60) return TABLA_RECARGOS.peso.mas_60kg;
	if (pesoKg > 40) return TABLA_RECARGOS.peso.mas_40kg;
	if (pesoKg > 20) return TABLA_RECARGOS.peso.mas_20kg;
	return 0;
}

/**
 * Calcula el recargo por monto de transferencia.
 */
export function recargoTransferencia(monto: number): number {
	if (monto > 1000000) return TABLA_RECARGOS.transferencias.despues_1000000;
	if (monto > 500000) return TABLA_RECARGOS.transferencias.despues_500000;
	if (monto > 100000) return TABLA_RECARGOS.transferencias.despues_100000;
	return 0;
}

/**
 * Calcula el recargo por pago alto (> $1,000,000).
 * $2,000 por cada millón adicional.
 */
export function recargoPagoAlto(monto: number): number {
	if (monto > 1000000) {
		// El primer millón no tiene recargo, solo los adicionales.
		// Ej: $1,500,000 → 0.5 millón adicional → redondeo hacia abajo → 1 millón → $2,000
		// Ej: $3,000,000 → 2 millones adicionales → $4,000
		const millonesAdicionales = Math.floor(monto / 1000000) - 1;
		return TABLA_RECARGOS.recargo_pagos_altos.por_millon_adicional * Math.max(0, millonesAdicionales);
	}
	return 0;
}

/**
 * Calcula el recargo por compra (tiempo + paradas).
 * @param bloques20min - Bloques de 20 minutos de espera
 * @param paradas - Número de paradas adicionales
 */
export function recargoCompra(bloques20min: number, paradas: number): number {
	return (
		TABLA_RECARGOS.compras.tiempo_mismo_lugar_cada_20min * bloques20min +
		TABLA_RECARGOS.compras.por_parada * paradas
	);
}
