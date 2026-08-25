/**
 * Calcula la base sugerida para el domiciliario: efectivo total que debe
 * tener disponible para cubrir recargos + tarifa de servicio + valor del
 * mandado (factura, compra, etc.).
 *
 * @param valorMandado - Dinero del cliente que el domiciliario adelanta
 *   (factura, compra, etc.). 0 si no aplica.
 * @param recargoTotal - Suma de recargos seleccionados (ResultadoRecargos.total).
 * @param tarifaServicio - Tarifa calculada del trayecto (precio?.valor).
 * @returns Base necesaria redondeada, mínimo 0.
 */
export function calcularBaseSugerida(params: {
	valorMandado: number;
	recargoTotal: number;
	tarifaServicio: number;
}): number {
	return Math.max(
		0,
		Math.round(params.valorMandado + params.recargoTotal + params.tarifaServicio)
	);
}
