import { describe, expect, test } from 'vitest';
import {
	calcularDeuda,
	comisionDiaria,
	fechaBogota,
	mismasEscaleras,
	nivelComision,
	nivelDeTotal,
	nivelDiario,
	nivelesParaFecha,
	rangoDeNiveles,
	redondearComision,
	totalPedidoComision,
	totalesDiarios,
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

describe('comisión DIARIA acumulada (Fase 13)', () => {
	test('fechaBogota devuelve la fecha local de Bogotá (UTC-5)', () => {
		// 2026-08-07T23:30:00Z = 18:30 en Bogotá → mismo día.
		expect(fechaBogota('2026-08-07T23:30:00Z')).toBe('2026-08-07');
		// 2026-08-08T02:00:00Z = 21:00 del 7 en Bogotá → día anterior.
		expect(fechaBogota('2026-08-08T02:00:00Z')).toBe('2026-08-07');
		expect(fechaBogota('')).toBe('');
		expect(fechaBogota('no-es-fecha')).toBe('');
	});

	test('totalPedidoComision usa el total con respaldo a tarifa + recargos', () => {
		expect(totalPedidoComision(6000, 4000, 2000)).toBe(6000);
		expect(totalPedidoComision(null, 4000, 2000)).toBe(6000);
		expect(totalPedidoComision(-5, 4000, 2000)).toBe(0);
	});

	test('totalesDiarios agrupa por domiciliario y por día (Bogotá)', () => {
		const entregas = [
			{ domiciliario_id: 'a', total: 6000, tarifa_base: 6000, recargo_total: 0, updated_at: '2026-08-07T18:00:00Z' },
			{ domiciliario_id: 'a', total: 15000, tarifa_base: 15000, recargo_total: 0, updated_at: '2026-08-07T20:30:00Z' },
			{ domiciliario_id: 'a', total: 9000, tarifa_base: 9000, recargo_total: 0, updated_at: '2026-08-08T00:30:00Z' }, // 7 en Bogotá
			{ domiciliario_id: 'b', total: 5000, tarifa_base: 5000, recargo_total: 0, updated_at: '2026-08-08T12:00:00Z' }
		];
		const dias = totalesDiarios(entregas);
		expect(dias.get('a')?.get('2026-08-07')).toBe(6000 + 15000 + 9000);
		expect(dias.get('b')?.get('2026-08-08')).toBe(5000);
		expect(dias.get('a')?.has('2026-08-08')).toBe(false);
		// Sin domiciliario se ignora.
		expect(dias.get('')).toBeUndefined();
	});

	test('nivelDiario: sin entregas (0) no hay nivel; con total usa el criterio de nivelDeTotal', () => {
		expect(nivelDiario(ESCALERA, 0)).toBeNull();
		expect(nivelDiario(ESCALERA, -1)).toBeNull();
		// ESCALERA salta del nivel 3 (hasta 30.000) al 10 (hasta 100.000).
		expect(nivelDiario(ESCALERA, 30000)?.nivel).toBe(3);
		expect(nivelDiario(ESCALERA, 30001)?.nivel).toBe(10);
		expect(nivelDiario(ESCALERA, 99999)?.nivel).toBe(10);
		expect(nivelDiario([], 5000)).toBeNull();
	});

	test('comisionDiaria: $40.000 → nivel 4 → 1300 × 4 = 5200', () => {
		const l4 = niveles(
			[1, 10000, 1300],
			[2, 20000, 1300],
			[3, 30000, 1300],
			[4, 40000, 1300]
		);
		expect(comisionDiaria(l4, 40000)).toBe(5200); // nivel 4 → 4 × 1300
		expect(comisionDiaria(l4, 29999)).toBe(3900); // nivel 3 → 3 × 1300
		expect(comisionDiaria(l4, 1)).toBe(1300); // nivel 1 → 1 × 1300
		expect(comisionDiaria(l4, 0)).toBe(0);
		expect(comisionDiaria(l4, -5)).toBe(0);
	});

	test('comisionDiaria suma el valor de CADA nivel cruzado (valores distintos por nivel)', () => {
		const variada = niveles(
			[1, 10000, 1300],
			[2, 20000, 2200],
			[3, 30000, 3500]
		);
		expect(comisionDiaria(variada, 25000)).toBe(1300 + 2200 + 3500); // nivel 3
		expect(comisionDiaria(variada, 15000)).toBe(1300 + 2200); // nivel 2
		expect(comisionDiaria(variada, 99999)).toBe(1300 + 2200 + 3500); // sobre el último
	});

	test('comisionDiaria sin niveles devuelve 0', () => {
		expect(comisionDiaria([], 50000)).toBe(0);
	});

	// ── Escalón: agregar pedidos sin cruzar umbral NO cambia la comisión ──
	test('escalón: $8.000 + $1.500 = $9.500 → sigue en nivel 1, comisión unchanged', () => {
		const l1 = niveles([1, 10000, 1300], [2, 20000, 2200]);
		// Día con $8.000 → nivel 1 → comisión $1.300
		expect(comisionDiaria(l1, 8000)).toBe(1300);
		// Agrega un pedido de $1.500 → total $9.500 → sigue en nivel 1
		expect(comisionDiaria(l1, 9500)).toBe(1300);
		// Misma comisión: no subió porque no cruzó el umbral ($10.000)
		expect(comisionDiaria(l1, 9500)).toBe(comisionDiaria(l1, 8000));
	});

	test('escalón: cruzar el umbral SÍ incrementa la comisión', () => {
		const l1 = niveles([1, 10000, 1300], [2, 20000, 2200]);
		// $9.500 → nivel 1 → $1.300
		expect(comisionDiaria(l1, 9500)).toBe(1300);
		// $10.001 → nivel 2 → $1.300 + $2.200 = $3.500
		expect(comisionDiaria(l1, 10001)).toBe(3500);
	});

	test('deuda: abono reduce deuda total sin importar en qué día se generó', () => {
		// Día 1: $15.000 → nivel 2 → comisión $3.500
		// Día 2: $25.000 → nivel 3 → comisión $7.000
		// Total generado: $10.500
		// Abono de $4.000 → deuda: $6.500
		const l3 = niveles([1, 10000, 1300], [2, 20000, 2200], [3, 30000, 3500]);
		const totalComision = comisionDiaria(l3, 15000) + comisionDiaria(l3, 25000);
		expect(totalComision).toBe(3500 + 7000); // $10.500
		expect(calcularDeuda(totalComision, 4000)).toBe(6500);
		// Abono de $10.500 → deuda 0 (no importa que la comisión sea por escalón)
		expect(calcularDeuda(totalComision, 10500)).toBe(0);
	});
});	describe('escenario reportado: 90.000/día vs deuda (Fase 13)', () => {
		/** Escalera por defecto (Fase 12): 20 niveles de $10.000, $1.300 c/u. */
		function escalera20(): ComisionNivel[] {
			return niveles(...Array.from({ length: 20 }, (_, i) => [i + 1, (i + 1) * 10000, 1300] as [number, number, number]));
		}

		test('3 pedidos de 30.000 el mismo día = 90.000 → comisión del día 11.700 (9 × 1.300)', () => {
			const escalera = escalera20();
			// Los tres pedidos se entregan el mismo día (Bogotá).
			const entregas = [1, 2, 3].map((i) => ({
				domiciliario_id: 'dom-a',
				total: 30000,
				tarifa_base: 30000,
				recargo_total: 0,
				updated_at: `2026-08-09T${10 + i}:00:00Z` // 05:00-07:00 en Bogotá: mismo día
			}));
			const dias = totalesDiarios(entregas);
			expect(dias.get('dom-a')?.get('2026-08-09')).toBe(90000);
			// Comisión DIARIA: 90.000 cae en el nivel 9 → 9 × 1.300 = 11.700.
			expect(nivelDiario(escalera, 90000)?.nivel).toBe(9);
			expect(comisionDiaria(escalera, 90000)).toBe(11700);
			// Lo que la Fase 11 congelaba POR PEDIDO: 3 × 1.300 = 3.900 (ya no se usa).
			expect(3 * nivelComision(escalera, 30000)).toBe(3900);
		});

		test('deuda = Σ comisiones diarias − Σ abonos (no usa los snapshots por pedido)', () => {
			const escalera = escalera20();
			const totalComision = comisionDiaria(escalera, 90000); // 11.700
			expect(totalComision).toBe(11700);
			expect(calcularDeuda(totalComision, 0)).toBe(11700);
			expect(calcularDeuda(totalComision, 7800)).toBe(3900);
			expect(calcularDeuda(totalComision, 11700)).toBe(0);
		});

		test('si la escalera solo llega al nivel 3, un día de 90.000 cobra 3 × 1.300 = 3.900 (el total cae en el último nivel)', () => {
			const corta = niveles(
				[1, 10000, 1300],
				[2, 20000, 1300],
				[3, 30000, 1300]
			);
			expect(nivelDiario(corta, 90000)?.nivel).toBe(3);
			expect(comisionDiaria(corta, 90000)).toBe(3900);
		});
	});

	describe('escaleras congeladas por día (Fase 18)', () => {
		const congeladas = new Map<string, ComisionNivel[]>([
			['2026-08-05', niveles([1, 10000, 1300], [2, 20000, 1300], [3, 30000, 1300])],
			['2026-08-06', niveles([1, 10000, 1500], [2, 20000, 1500], [3, 30000, 1500])]
		]);
		const actuales = niveles([1, 10000, 9999], [2, 20000, 9999]);

		test('nivelesParaFecha: un día congelado usa SU escalera, no la vigente', () => {
			expect(nivelesParaFecha(congeladas, '2026-08-05', actuales)).toBe(congeladas.get('2026-08-05'));
			expect(nivelesParaFecha(congeladas, '2026-08-06', actuales)).toBe(congeladas.get('2026-08-06'));
		});

		test('nivelesParaFecha: un día sin congelar usa la escalera vigente', () => {
			// Días sin cambio desde entonces (o el día en curso antes de un cambio).
			expect(nivelesParaFecha(congeladas, '2026-08-07', actuales)).toBe(actuales);
			expect(nivelesParaFecha(new Map(), '2026-08-01', actuales)).toBe(actuales);
		});

		test('mismasEscaleras: compara nivel/hasta/valor sin importar el orden ni el id', () => {
			const a = niveles([1, 10000, 1300], [2, 20000, 2200]);
			const b = niveles([2, 20000, 2200], [1, 10000, 1300]); // mismo contenido, distinto orden/id
			expect(mismasEscaleras(a, b)).toBe(true);
			expect(mismasEscaleras(a, a)).toBe(true);
			// Cambió el valor de un nivel → escaleras distintas.
			expect(mismasEscaleras(a, niveles([1, 10000, 1300], [2, 20000, 9999]))).toBe(false);
			// Cambió un tope → distintas.
			expect(mismasEscaleras(a, niveles([1, 10000, 1300], [2, 25000, 2200]))).toBe(false);
			// Distinta cantidad de niveles → distintas.
			expect(mismasEscaleras(a, niveles([1, 10000, 1300]))).toBe(false);
			expect(mismasEscaleras([], [])).toBe(true);
			expect(mismasEscaleras([], a)).toBe(false);
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
