/**
 * Lógica pura de recargos (Parte 1 — tests unitarios).
 *
 * Calcula qué recargos activos aplican a un pedido a partir de los códigos
 * elegidos por el cliente, el total y los descartados. Sin dependencias de
 * BD ni de UI.
 */

export const MAX_RECARGOS_POR_PEDIDO = 15;

export interface RecargoSeleccionable {
	codigo: string;
	nombre: string;
	valor: number;
	activo: boolean;
	tipo?: string;
}

/** Snapshot de un recargo aplicado a un pedido (se guarda en la BD). */
export interface RecargoAplicado {
	codigo: string;
	nombre: string;
	valor: number;
}

export interface ResultadoRecargos {
	/** Recargos activos que coinciden con la selección, en orden del catálogo. */
	aplicados: RecargoAplicado[];
	/** Suma de los recargos aplicados. */
	total: number;
	/** Códigos solicitados que no existen o están inactivos. */
	descartados: string[];
	/** true si la selección supera el tope (solo se aplican los primeros 15). */
	excedeTope: boolean;
}

function normalizar(seleccion: string[] | null | undefined): string[] {
	return [...new Set((seleccion ?? []).map((c) => String(c).trim()).filter((c) => c.length > 0))];
}

/**
 * Aplica la selección de recargos del cliente contra el catálogo.
 * Los códigos desconocidos o de recargos inactivos se descartan (no fallan
 * el pedido: el cliente solo ve el desglose de lo que aplica).
 */
export function calcularRecargos(
	recargos: RecargoSeleccionable[],
	seleccionados: string[] | null | undefined
): ResultadoRecargos {
	const seleccion = normalizar(seleccionados);
	const excedeTope = seleccion.length > MAX_RECARGOS_POR_PEDIDO;
	const elegibles = seleccion.slice(0, MAX_RECARGOS_POR_PEDIDO);

	const catalogo = new Map(
		recargos.filter((r) => r.activo).map((r) => [r.codigo, r] as const)
	);

	const aplicados: RecargoAplicado[] = [];
	const descartados: string[] = [];
	for (const codigo of elegibles) {
		const r = catalogo.get(codigo);
		if (r) aplicados.push({ codigo: r.codigo, nombre: r.nombre, valor: r.valor });
		else descartados.push(codigo);
	}

	return {
		aplicados,
		total: aplicados.reduce((s, r) => s + r.valor, 0),
		descartados,
		excedeTope
	};
}

/**
 * Identifica los recargos automáticos aunque el catálogo histórico no tenga
 * el tipo actualizado. Los códigos son la fuente de compatibilidad para esos
 * registros existentes.
 */
function esRecargoDePeso(recargo: RecargoSeleccionable): boolean {
	return recargo.tipo === 'peso' || recargo.codigo === 'sin_peso' || recargo.codigo.startsWith('peso_');
}

function esRecargoDeTransferencia(recargo: RecargoSeleccionable): boolean {
	return recargo.tipo === 'transferencia' || recargo.codigo.startsWith('transferencia_');
}

/**
 * Sustituye los recargos automáticos de peso y transferencia según los datos
 * actuales del domicilio, sin modificar los recargos que el cliente eligió.
 */
export function sincronizarRecargosDomicilio(
	recargos: RecargoSeleccionable[],
	seleccionados: string[],
	pesoKg: string,
	transferencia: 'si' | 'no' | '',
	montoTransferencia: string
): string[] {
	const seleccion = new Set(seleccionados);
	const recargosPeso = recargos.filter(esRecargoDePeso);
	const recargosTransferencia = recargos.filter(esRecargoDeTransferencia);

	for (const recargo of [...recargosPeso, ...recargosTransferencia]) seleccion.delete(recargo.codigo);

	const peso = Number(pesoKg) || 0;
	if (peso > 0) {
		const codigoPeso = peso > 60
			? 'peso_mas_60kg'
			: peso > 40
				? 'peso_mas_40kg'
				: peso > 20
					? 'peso_mas_20kg'
					: 'sin_peso';
		if (recargosPeso.some((recargo) => recargo.codigo === codigoPeso)) seleccion.add(codigoPeso);
	}

	const monto = Number(montoTransferencia) || 0;
	if (transferencia === 'si' && monto > 0) {
		const codigoTransferencia = monto > 1000000
			? 'transferencia_1m'
			: monto > 500000
				? 'transferencia_500k'
				: monto > 100000
					? 'transferencia_100k'
					: '';
		if (recargosTransferencia.some((recargo) => recargo.codigo === codigoTransferencia)) {
			seleccion.add(codigoTransferencia);
		}
	}

	return [...seleccion];
}

/**
 * Sincroniza recargos de transferencia para compra/diligencia (pago, banco, trámite).
 * Usa el monto de la factura / pago para determinar el escalón correcto.
 */
export function sincronizarRecargosTransferencia(
	recargos: RecargoSeleccionable[],
	seleccionados: string[],
	montoPago: string
): string[] {
	const seleccion = new Set(seleccionados);
	const recargosTransferencia = recargos.filter(esRecargoDeTransferencia);

	// Eliminar códigos de transferencia existentes
	for (const recargo of recargosTransferencia) seleccion.delete(recargo.codigo);

	const monto = Number(montoPago) || 0;
	if (monto > 0) {
		const codigoTransferencia = monto > 1000000
			? 'transferencia_1m'
			: monto > 500000
				? 'transferencia_500k'
				: monto > 100000
					? 'transferencia_100k'
					: '';
		if (codigoTransferencia && recargosTransferencia.some((recargo) => recargo.codigo === codigoTransferencia)) {
			seleccion.add(codigoTransferencia);
		}
	}

	return [...seleccion];
}
