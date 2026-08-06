/**
 * Máquina de estados del pedido (Parte 1 — tests unitarios).
 *
 * Espejo en TypeScript de las transiciones que valida la BD:
 *   - transicionar_pedido()        → admin cancela desde estados activos;
 *                                    domiciliario: asignado→…→entregado
 *   - asignar_domiciliario()       → admin: pendiente→asignado
 *   - cancelar_pedido_cliente()    → cliente: pendiente→cancelado
 *
 * La BD sigue siendo la autoridad final; este módulo es el mismo contrato
 * en TS para fallar rápido y para testear sin tocar Postgres.
 */

import type { EstadoPedido } from '../types';

export type RolTransicion = 'admin' | 'domiciliario' | 'cliente';

/** Flujo principal del servicio: pendiente → … → entregado. */
export const FLUJO_PRINCIPAL: EstadoPedido[] = [
	'pendiente',
	'asignado',
	'aceptado',
	'recogido',
	'en_camino',
	'entregado'
];

/**
 * Transiciones permitidas por rol y estado actual. Deben reflejar EXACTAMENTE
 * la máquina de estados de la BD; si divergen, el pre-check en TS puede
 * rechazar antes que la BD o (peor) dejar pasar algo que la BD rechaza.
 */
export const TRANSICIONES_POR_ROL: Record<
	RolTransicion,
	Partial<Record<EstadoPedido, EstadoPedido[]>>
> = {
	admin: {
		pendiente: ['asignado', 'cancelado'],
		asignado: ['cancelado'],
		aceptado: ['cancelado'],
		recogido: ['cancelado'],
		en_camino: ['cancelado']
	},
	domiciliario: {
		asignado: ['aceptado'],
		aceptado: ['recogido'],
		recogido: ['en_camino'],
		en_camino: ['entregado']
	},
	cliente: {
		pendiente: ['cancelado']
	}
};

/** Estados terminales: a partir de aquí no hay ninguna transición válida. */
export const ESTADOS_TERMINALES: EstadoPedido[] = ['entregado', 'cancelado'];

/** Estados activos: pedidos en curso (los que ocupan a un domiciliario). */
export const ESTADOS_ACTIVOS: EstadoPedido[] = [
	'asignado',
	'aceptado',
	'recogido',
	'en_camino'
];

/** Devuelve los estados a los que `rol` puede pasar desde `desde`. */
export function transicionesPermitidas(
	rol: RolTransicion,
	desde: EstadoPedido
): EstadoPedido[] {
	return TRANSICIONES_POR_ROL[rol][desde] ?? [];
}

/** ¿El rol puede pasar el pedido de `desde` a `hacia`? */
export function puedeTransicionar(
	rol: RolTransicion,
	desde: EstadoPedido,
	hacia: EstadoPedido
): boolean {
	return transicionesPermitidas(rol, desde).includes(hacia);
}

/** ¿Puede el rol cancelar un pedido que está en `desde`? */
export function puedeCancelar(rol: RolTransicion, desde: EstadoPedido): boolean {
	return puedeTransicionar(rol, desde, 'cancelado');
}

/** ¿Es un estado terminal (no admite más transiciones)? */
export function esEstadoFinal(estado: EstadoPedido): boolean {
	return ESTADOS_TERMINALES.includes(estado);
}

/**
 * Aplica la transición si es válida; si no, lanza un Error con el mismo
 * mensaje que usa la BD (fail-fast sin tocar Postgres).
 */
export function transicionar(
	rol: RolTransicion,
	desde: EstadoPedido,
	hacia: EstadoPedido
): EstadoPedido {
	if (desde === hacia) {
		throw new Error(`El pedido ya está en «${hacia}»`);
	}
	if (!puedeTransicionar(rol, desde, hacia)) {
		throw new Error(`No se puede pasar de «${desde}» a «${hacia}»`);
	}
	return hacia;
}
