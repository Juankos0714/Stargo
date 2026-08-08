import { describe, expect, test } from 'vitest';
import {
	calcularDeuda,
	nivelComision,
	nivelDeTotal,
	rangoDeNiveles,
	redondearComision,
	validarTopeNivel,
	vistaCompactaNiveles,
	type NivelConRango
} from '../../src/lib/logic/comisiones';
import type { ComisionNivel } from '../../src/lib/types';

function niveles(...pares: [nivel: number, hasta: number, valor: number][]): ComisionNivel[] {
	return pares.map(([nivel, hasta, valor]) => ({
		id: `n-${nivel}`,
		nivel,
		hasta,
		valor
	}));
}

const ESCALERA = niveles(
	[1, 10000, 1300],
	[2, 20000, 1300],
	[3, 30000, 1300],
	[10, 100000, 1300]
);

describe('calcularDeuda', () => {
	test('deuda = comisiones generadas − abonos', () => {
		expect(calcularDeuda(6000, 2000)).toBe(4000);
	});

	test('sin abonos la deuda es todo lo generado', () => {
		expect(calcularDeuda(6000, 0)).toBe(6000);
	});

	test('nunca negativa aunque se pague de más', () => {
		expect(calcularDeuda(5000, 8000)).toBe(0);
		expect(calcularDeuda(0, 1000)).toBe(0);
	});

	test('tolerante a valores inválidos', () => {
		expect(calcularDeuda(NaN, 1000)).toBe(0);
		expect(calcularDeuda(1000, NaN)).toBe(1000);
		expect(calcularDeuda(-500, 100)).toBe(0);
		expect(calcularDeuda(100, -200)).toBe(100);
	});
});

describe('redondearComision', () => {
	test('redondea al entero y nunca queda negativa', () => {
		expect(redondearComision(2000.6)).toBe(2001);
		expect(redondearComision(-5)).toBe(0);
		expect(redondearComision(0)).toBe(0);
		expect(redondearComision(NaN)).toBe(0);
	});
});

describe('nivelDeTotal', () => {
	test('asigna el nivel por el total del pedido (límites incluidos)', () => {
		expect(nivelDeTotal(ESCALERA, 0)?.nivel).toBe(1);
		expect(nivelDeTotal(ESCALERA, 10000)?.nivel).toBe(1); // hasta incluye el tope
		expect(nivelDeTotal(ESCALERA, 10001)?.nivel).toBe(2);
		expect(nivelDeTotal(ESCALERA, 20000)?.nivel).toBe(2);
		expect(nivelDeTotal(ESCALERA, 20001)?.nivel).toBe(3);
		expect(nivelDeTotal(ESCALERA, 30000)?.nivel).toBe(3);
		expect(nivelDeTotal(ESCALERA, 50000)?.nivel).toBe(10); // salta al siguiente disponible
	});

	test('si el total supera el último nivel, aplica el nivel más alto', () => {
		expect(nivelDeTotal(ESCALERA, 999999)?.nivel).toBe(10);
		expect(nivelDeTotal(ESCALERA, 100001)?.nivel).toBe(10);
	});

	test('sin niveles devuelve null; totales inválidos caen al nivel 1', () => {
		expect(nivelDeTotal([], 5000)).toBeNull();
		expect(nivelDeTotal(ESCALERA, NaN)).toBe(ESCALERA[0]);
		expect(nivelDeTotal(ESCALERA, -100)).toBe(ESCALERA[0]);
	});

	test('no depende del orden en que lleguen los niveles', () => {
		const desordenadas = [...ESCALERA].reverse();
		expect(nivelDeTotal(desordenadas, 15000)?.nivel).toBe(2);
	});
});

describe('nivelComision', () => {
	test('devuelve el valor del nivel que corresponde al total', () => {
		expect(nivelComision(ESCALERA, 5000)).toBe(1300);
		expect(nivelComision(ESCALERA, 15000)).toBe(1300);
		expect(nivelComision(ESCALERA, 999999)).toBe(1300);
	});

	test('con valores distintos por nivel aplica el correcto', () => {
		const variada = niveles(
			[1, 10000, 1300],
			[2, 20000, 2200],
			[3, 30000, 3500]
		);
		expect(nivelComision(variada, 9000)).toBe(1300);
		expect(nivelComision(variada, 15000)).toBe(2200);
		expect(nivelComision(variada, 25000)).toBe(3500);
		expect(nivelComision(variada, 40000)).toBe(3500); // arriba del tope → último
	});

	test('sin niveles devuelve 0', () => {
		expect(nivelComision([], 5000)).toBe(0);
	});
});

describe('validarTopeNivel', () => {
	test('acepta un tope estrictamente entre vecinos (sin solapamientos ni huecos)', () => {
		expect(validarTopeNivel(ESCALERA, 2, 15000)).toBeNull();
		expect(validarTopeNivel(ESCALERA, 3, 25000)).toBeNull();
		expect(validarTopeNivel(ESCALERA, 1, 10000)).toBeNull();
		expect(validarTopeNivel(ESCALERA, 10, 150000)).toBeNull(); // último nivel: sin límite superior
	});

	test('rechaza un tope menor o igual al nivel anterior (solapamiento)', () => {
		expect(validarTopeNivel(ESCALERA, 2, 10000)).toMatch(/mayor que 10000/);
		expect(validarTopeNivel(ESCALERA, 3, 15000)).toMatch(/mayor que 20000/);
		expect(validarTopeNivel(ESCALERA, 10, 30000)).toMatch(/mayor que 30000/);
	});

	test('rechaza un tope mayor o igual al siguiente nivel (deja un hueco/adelanta el rango)', () => {
		expect(validarTopeNivel(ESCALERA, 1, 20000)).toMatch(/menor que 20000/);
		expect(validarTopeNivel(ESCALERA, 2, 30000)).toMatch(/menor que 30000/);
		expect(validarTopeNivel(ESCALERA, 3, 100000)).toMatch(/menor que 100000/);
	});

	test('tolera listas vacías y niveles inexistentes', () => {
		expect(validarTopeNivel([], 1, 10000)).toBeNull();
		expect(validarTopeNivel(ESCALERA, 99, 10000)).toBeNull();
	});
});

describe('rangoDeNiveles', () => {
	test('calcula el desde de cada nivel (anterior.hasta + 1)', () => {
		const rangos: NivelConRango[] = rangoDeNiveles(niveles(
			[1, 10000, 1300],
			[2, 20000, 1300],
			[3, 30000, 1300]
		));
		expect(rangos.map((r) => r.desde)).toEqual([1, 10001, 20001]);
		expect(rangos[0].hasta).toBe(10000);
		expect(rangos[2].valor).toBe(1300);
	});

	test('ordena por nivel y devuelve [] sin niveles', () => {
		expect(rangoDeNiveles([])).toEqual([]);
		const rangos = rangoDeNiveles(niveles([3, 30000, 100], [1, 10000, 50]));
		expect(rangos.map((r) => r.nivel)).toEqual([1, 3]);
		expect(rangos.map((r) => r.desde)).toEqual([1, 10001]);
	});
});

describe('vistaCompactaNiveles', () => {
	function escalera(cantidad: number): ComisionNivel[] {
		return niveles(
			...Array.from({ length: cantidad }, (_, i) => [i + 1, (i + 1) * 10000, 1300] as [number, number, number])
		);
	}

	test('con 20 niveles oculta los intermedios: primeros 5 + últimos 3', () => {
		const v = vistaCompactaNiveles(escalera(20), false);
		expect(v.primeros.map((n) => n.nivel)).toEqual([1, 2, 3, 4, 5]);
		expect(v.resto.map((n) => n.nivel)).toEqual([18, 19, 20]);
		expect(v.ocultos).toBe(12);
		expect(v.mostrarControl).toBe(true);
	});

	test('verCompletos devuelve la lista completa (control sigue visible)', () => {
		const v = vistaCompactaNiveles(escalera(20), true);
		expect(v.primeros.map((n) => n.nivel)).toEqual([1, 2, 3, 4, 5]);
		expect(v.resto.map((n) => n.nivel)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
		expect(v.ocultos).toBe(0);
		expect(v.mostrarControl).toBe(true);
	});

	test('con 9 niveles oculta 1 solo intermedio', () => {
		const v = vistaCompactaNiveles(escalera(9), false);
		expect(v.primeros.map((n) => n.nivel)).toEqual([1, 2, 3, 4, 5]);
		expect(v.resto.map((n) => n.nivel)).toEqual([7, 8, 9]);
		expect(v.ocultos).toBe(1);
		expect(v.mostrarControl).toBe(true);
	});

	test('con 8 o menos niveles no oculta nada ni muestra control', () => {
		const v = vistaCompactaNiveles(escalera(8), false);
		expect(v.primeros.map((n) => n.nivel)).toEqual([1, 2, 3, 4, 5]);
		expect(v.resto.map((n) => n.nivel)).toEqual([6, 7, 8]);
		expect(v.ocultos).toBe(0);
		expect(v.mostrarControl).toBe(false);
	});

	test('con 6 niveles la lista se divide en ambos bloques sin control', () => {
		const v = vistaCompactaNiveles(escalera(6), false);
		expect(v.primeros.map((n) => n.nivel)).toEqual([1, 2, 3, 4, 5]);
		expect(v.resto.map((n) => n.nivel)).toEqual([6]);
		expect(v.ocultos).toBe(0);
		expect(v.mostrarControl).toBe(false);
	});

	test('no depende del orden de llegada y tolera listas vacías', () => {
		const desordenada = [...escalera(20)].reverse();
		const v = vistaCompactaNiveles(desordenada, false);
		expect(v.primeros.map((n) => n.nivel)).toEqual([1, 2, 3, 4, 5]);
		expect(v.resto.map((n) => n.nivel)).toEqual([18, 19, 20]);

		const vacia = vistaCompactaNiveles([], false);
		expect(vacia.primeros).toEqual([]);
		expect(vacia.resto).toEqual([]);
		expect(vacia.ocultos).toBe(0);
		expect(vacia.mostrarControl).toBe(false);
	});
});
