import { describe, expect, test } from 'vitest';
import {
	esEstadoFinal,
	FLUJO_PRINCIPAL,
	puedeCancelar,
	puedeTransicionar,
	transicionesPermitidas,
	transicionar,
	TRANSICIONES_POR_ROL,
	type RolTransicion
} from '../../src/lib/logic/estado-pedido';
import type { EstadoPedido } from '../../src/lib/types';

describe('máquina de estados — flujo principal válido', () => {
	test('el flujo completo pendiente → … → entregado es válido con los roles correctos', () => {
		// Admin asigna: pendiente → asignado
		expect(puedeTransicionar('admin', 'pendiente', 'asignado')).toBe(true);
		// El domiciliario avanza su cadena:
		expect(puedeTransicionar('domiciliario', 'asignado', 'aceptado')).toBe(true);
		expect(puedeTransicionar('domiciliario', 'aceptado', 'recogido')).toBe(true);
		expect(puedeTransicionar('domiciliario', 'recogido', 'en_camino')).toBe(true);
		expect(puedeTransicionar('domiciliario', 'en_camino', 'entregado')).toBe(true);
	});

	test('FLUJO_PRINCIPAL define el orden del servicio', () => {
		expect(FLUJO_PRINCIPAL).toEqual([
			'pendiente',
			'asignado',
			'aceptado',
			'recogido',
			'en_camino',
			'entregado'
		]);
	});

	test('transicionar() devuelve el nuevo estado para transiciones válidas', () => {
		expect(transicionar('admin', 'pendiente', 'asignado')).toBe('asignado');
		expect(transicionar('domiciliario', 'recogido', 'en_camino')).toBe('en_camino');
		expect(transicionar('cliente', 'pendiente', 'cancelado')).toBe('cancelado');
	});
});

describe('máquina de estados — cancelaciones', () => {
	test('el admin puede cancelar desde cualquier estado activo', () => {
		for (const estado of ['pendiente', 'asignado', 'aceptado', 'recogido', 'en_camino'] as const) {
			expect(puedeCancelar('admin', estado), `admin no puede cancelar desde ${estado}`).toBe(true);
			expect(puedeTransicionar('admin', estado, 'cancelado')).toBe(true);
		}
	});

	test('el cliente solo puede cancelar un pedido pendiente', () => {
		expect(puedeCancelar('cliente', 'pendiente')).toBe(true);
		expect(puedeCancelar('cliente', 'asignado')).toBe(false);
		expect(puedeCancelar('cliente', 'entregado')).toBe(false);
	});

	test('el domiciliario no puede cancelar (la cancelación es de admin/cliente)', () => {
		for (const estado of ['asignado', 'aceptado', 'recogido', 'en_camino'] as const) {
			expect(puedeCancelar('domiciliario', estado)).toBe(false);
		}
	});
});

describe('máquina de estados — transiciones inválidas rechazadas', () => {
	const casosInvalidos: [RolTransicion, EstadoPedido, EstadoPedido][] = [
		['admin', 'entregado', 'pendiente'], // terminales no retroceden
		['admin', 'cancelado', 'pendiente'],
		['admin', 'pendiente', 'aceptado'], // el admin no avanza la cadena
		['admin', 'asignado', 'entregado'],
		['domiciliario', 'pendiente', 'aceptado'], // sin asignación no hay cadena
		['domiciliario', 'asignado', 'entregado'], // sin saltos
		['domiciliario', 'entregado', 'en_camino'], // no retroceder
		['cliente', 'asignado', 'cancelado'], // el cliente solo desde pendiente
		['cliente', 'entregado', 'cancelado']
	];

	for (const [rol, desde, hacia] of casosInvalidos) {
		test(`${rol}: ${desde} → ${hacia} es rechazada`, () => {
			expect(puedeTransicionar(rol, desde, hacia)).toBe(false);
			expect(() => transicionar(rol, desde, hacia)).toThrow(
				`No se puede pasar de «${desde}» a «${hacia}»`
			);
		});
	}

	test('transicionar() rechaza el mismo estado con el mensaje de la BD', () => {
		expect(() => transicionar('admin', 'pendiente', 'pendiente')).toThrow(
			'El pedido ya está en «pendiente»'
		);
	});

	test('estados terminales no ofrecen ninguna transición para ningún rol', () => {
		expect(transicionesPermitidas('admin', 'entregado')).toEqual([]);
		expect(transicionesPermitidas('admin', 'cancelado')).toEqual([]);
		expect(transicionesPermitidas('domiciliario', 'entregado')).toEqual([]);
		expect(transicionesPermitidas('cliente', 'entregado')).toEqual([]);
	});

	test('un rol sin entrada para un estado devuelve lista vacía (sin excepción)', () => {
		expect(transicionesPermitidas('domiciliario', 'pendiente')).toEqual([]);
		expect(transicionesPermitidas('cliente', 'aceptado')).toEqual([]);
	});
});

describe('máquina de estados — helpers', () => {
	test('esEstadoFinal solo es true para entregado y cancelado', () => {
		expect(esEstadoFinal('entregado')).toBe(true);
		expect(esEstadoFinal('cancelado')).toBe(true);
		expect(esEstadoFinal('pendiente')).toBe(false);
		expect(esEstadoFinal('en_camino')).toBe(false);
	});

	test('el mapa por rol solo contiene estados definidos del CHECK de la BD', () => {
		const definidos: EstadoPedido[] = [
			'pendiente',
			'asignado',
			'aceptado',
			'recogido',
			'en_camino',
			'entregado',
			'cancelado'
		];
		for (const [rol, mapa] of Object.entries(TRANSICIONES_POR_ROL)) {
			for (const desde of Object.keys(mapa)) {
				expect(definidos, `${rol} tiene estado desconocido: ${desde}`).toContain(desde);
				for (const hacia of mapa[desde as EstadoPedido] ?? []) {
					expect(definidos, `${rol}: ${desde} → ${hacia} desconocido`).toContain(hacia);
				}
			}
		}
	});
});
