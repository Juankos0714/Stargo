import { describe, expect, test } from 'vitest';
import {
	calcularRecargos,
	MAX_RECARGOS_POR_PEDIDO,
	type RecargoSeleccionable
} from '../../src/lib/logic/recargos';

const recargo = (codigo: string, valor: number, activo = true): RecargoSeleccionable => ({
	codigo,
	nombre: `Recargo ${codigo}`,
	valor,
	activo
});

const CATALOGO = [
	recargo('compra_10', 1000),
	recargo('espera_15', 2000),
	recargo('parada_extra', 1500),
	recargo('peso_20', 5000),
	recargo('pago_transf', 2500),
	recargo('desactivado', 999, false)
];

describe('calcularRecargos — recargos individuales y en combinación', () => {
	test('sin selección: nada aplicado y total 0', () => {
		const r = calcularRecargos(CATALOGO, []);
		expect(r.aplicados).toEqual([]);
		expect(r.total).toBe(0);
		expect(r.descartados).toEqual([]);
		expect(r.excedeTope).toBe(false);
	});

	test('selección null/undefined se trata como vacía', () => {
		expect(calcularRecargos(CATALOGO, null).total).toBe(0);
		expect(calcularRecargos(CATALOGO, undefined).total).toBe(0);
	});

	test('un solo recargo (compra)', () => {
		const r = calcularRecargos(CATALOGO, ['compra_10']);
		expect(r.aplicados).toEqual([{ codigo: 'compra_10', nombre: 'Recargo compra_10', valor: 1000 }]);
		expect(r.total).toBe(1000);
	});

	test('varios recargos en combinación se suman (compra + espera + peso)', () => {
		const r = calcularRecargos(CATALOGO, ['compra_10', 'espera_15', 'peso_20']);
		expect(r.aplicados).toHaveLength(3);
		expect(r.total).toBe(1000 + 2000 + 5000);
		// El orden sigue el catálogo, no la selección.
		expect(r.aplicados.map((a) => a.codigo)).toEqual(['compra_10', 'espera_15', 'peso_20']);
	});

	test('un recargo inactivo nunca se aplica y se descarta', () => {
		const r = calcularRecargos(CATALOGO, ['desactivado']);
		expect(r.aplicados).toEqual([]);
		expect(r.total).toBe(0);
		expect(r.descartados).toEqual(['desactivado']);
	});

	test('código inexistente se descarta sin romper los válidos', () => {
		const r = calcularRecargos(CATALOGO, ['compra_10', 'no_existe']);
		expect(r.aplicados).toHaveLength(1);
		expect(r.total).toBe(1000);
		expect(r.descartados).toEqual(['no_existe']);
	});

	test('normaliza la selección: espacios, vacíos y duplicados', () => {
		const r = calcularRecargos(CATALOGO, ['  compra_10  ', '', '  ', 'compra_10', 'peso_20']);
		expect(r.aplicados.map((a) => a.codigo)).toEqual(['compra_10', 'peso_20']);
		expect(r.total).toBe(1000 + 5000);
		expect(r.descartados).toEqual([]);
	});
});

describe('calcularRecargos — tope', () => {
	const muchos = Array.from({ length: MAX_RECARGOS_POR_PEDIDO + 2 }, (_, i) =>
		recargo(`r_${i}`, 100, true)
	);
	const catalogoTope = Array.from({ length: MAX_RECARGOS_POR_PEDIDO + 5 }, (_, i) =>
		recargo(`r_${i}`, 100, true)
	);

	test(`con exactamente ${MAX_RECARGOS_POR_PEDIDO} no excede el tope`, () => {
		const seleccion = muchos.slice(0, MAX_RECARGOS_POR_PEDIDO).map((r) => r.codigo);
		const r = calcularRecargos(catalogoTope, seleccion);
		expect(r.excedeTope).toBe(false);
		expect(r.aplicados).toHaveLength(MAX_RECARGOS_POR_PEDIDO);
		expect(r.total).toBe(MAX_RECARGOS_POR_PEDIDO * 100);
	});

	test(`al superar ${MAX_RECARGOS_POR_PEDIDO} marca excedeTope y aplica solo los primeros`, () => {
		const seleccion = muchos.map((r) => r.codigo);
		const r = calcularRecargos(catalogoTope, seleccion);
		expect(r.excedeTope).toBe(true);
		expect(r.aplicados).toHaveLength(MAX_RECARGOS_POR_PEDIDO);
		expect(r.total).toBe(MAX_RECARGOS_POR_PEDIDO * 100);
	});
});
