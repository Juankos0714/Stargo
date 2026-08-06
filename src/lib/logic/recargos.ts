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
