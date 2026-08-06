import { describe, expect, test } from 'vitest';
import { erroresPorMinuto, formatearDuracion, minutosHito, promedioMinutos } from '../../src/lib/logic/metricas';

describe('metricas — minutosHito', () => {
	test('calcula minutos entre el pedido y el hito (redondeado)', () => {
		expect(minutosHito('2026-01-01T10:00:00Z', '2026-01-01T10:05:00Z')).toBe(5);
		expect(minutosHito('2026-01-01T10:00:00Z', '2026-01-01T10:30:30Z')).toBe(31); // 30.5 → redondea
	});

	test('devuelve null si falta una fecha o es inválida', () => {
		expect(minutosHito('', '2026-01-01T10:05:00Z')).toBeNull();
		expect(minutosHito('fecha-mala', '2026-01-01T10:05:00Z')).toBeNull();
		expect(minutosHito('2026-01-01T10:00:00Z', 'no')).toBeNull();
	});

	test('devuelve null si el hito es anterior al pedido (dato inconsistente)', () => {
		expect(minutosHito('2026-01-01T10:05:00Z', '2026-01-01T10:00:00Z')).toBeNull();
	});
});

describe('metricas — promedioMinutos', () => {
	test('promedia y redondea', () => {
		expect(promedioMinutos([10, 20, 30])).toBe(20);
		expect(promedioMinutos([11, 12])).toBe(12); // 11.5 → 12
	});

	test('null con lista vacía', () => {
		expect(promedioMinutos([])).toBeNull();
	});

	test('un solo valor es ese valor', () => {
		expect(promedioMinutos([7])).toBe(7);
	});
});

describe('metricas — erroresPorMinuto', () => {
	test('divide entre la ventana con 2 decimales', () => {
		expect(erroresPorMinuto(120, 60)).toBe(2);
		expect(erroresPorMinuto(150, 60)).toBe(2.5);
		expect(erroresPorMinuto(1, 60)).toBe(0.02);
	});

	test('ventana inválida devuelve 0 (evita división por cero)', () => {
		expect(erroresPorMinuto(10, 0)).toBe(0);
		expect(erroresPorMinuto(10, -5)).toBe(0);
	});
});

describe('metricas — formatearDuracion', () => {
	test('minutos cortos', () => {
		expect(formatearDuracion(0)).toBe('0 min');
		expect(formatearDuracion(12)).toBe('12 min');
		expect(formatearDuracion(59)).toBe('59 min');
	});

	test('horas con y sin minutos', () => {
		expect(formatearDuracion(60)).toBe('1 h');
		expect(formatearDuracion(65)).toBe('1 h 05 min');
		expect(formatearDuracion(120)).toBe('2 h');
		expect(formatearDuracion(187)).toBe('3 h 07 min');
	});

	test('null → guión', () => {
		expect(formatearDuracion(null)).toBe('—');
	});
});
