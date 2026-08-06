import { describe, expect, test } from 'vitest';
import { formatearFecha, formatearPeso, tiempoRelativo } from '../../src/lib/logic/formato';

describe('formatearPeso (COP)', () => {
	test('formatea valores enteros sin decimales', () => {
		expect(formatearPeso(5000)).toContain('5.000');
		expect(formatearPeso(1234567)).toContain('1.234.567');
	});

	test('valores nulos o NaN devuelven el placeholder', () => {
		expect(formatearPeso(null)).toBe('—');
		expect(formatearPeso(undefined)).toBe('—');
		expect(formatearPeso(Number.NaN)).toBe('—');
	});

	test('un valor de 0 se formatea como 0 (no como placeholder)', () => {
		expect(formatearPeso(0)).not.toBe('—');
		expect(formatearPeso(0)).toContain('0');
	});
});

describe('formatearFecha', () => {
	test('fecha válida: incluye día, mes y hora', () => {
		const s = formatearFecha('2026-08-06T12:00:00');
		expect(s).toMatch(/6/); // día
		expect(s).toContain('ago'); // mes abreviado en español
		expect(s).toMatch(/12:00/); // hora:minuto
	});

	test('fecha inválida devuelve el placeholder', () => {
		expect(formatearFecha('no-es-una-fecha')).toBe('—');
		expect(formatearFecha('')).toBe('—');
	});
});

describe('tiempoRelativo', () => {
	const ahora = new Date('2026-08-06T12:00:00');

	test('fechas inválidas devuelven el placeholder', () => {
		expect(tiempoRelativo('basura', ahora)).toBe('—');
	});

	test('menos de un minuto: «justo ahora»', () => {
		expect(tiempoRelativo('2026-08-06T11:59:40', ahora)).toBe('justo ahora');
		expect(tiempoRelativo('2026-08-06T12:00:00', ahora)).toBe('justo ahora');
	});

	test('fechas futuras (reloj del cliente) se tratan como «justo ahora»', () => {
		expect(tiempoRelativo('2026-08-06T12:05:00', ahora)).toBe('justo ahora');
	});

	test('minutos y horas', () => {
		expect(tiempoRelativo('2026-08-06T11:55:00', ahora)).toBe('hace 5 min');
		expect(tiempoRelativo('2026-08-06T10:00:00', ahora)).toBe('hace 2 h');
		expect(tiempoRelativo('2026-08-06T09:00:00', ahora)).toBe('hace 3 h');
	});

	test('días (singular y plural)', () => {
		expect(tiempoRelativo('2026-08-05T12:00:00', ahora)).toBe('hace 1 día');
		expect(tiempoRelativo('2026-08-03T12:00:00', ahora)).toBe('hace 3 días');
		expect(tiempoRelativo('2026-07-08T12:00:00', ahora)).toBe('hace 29 días');
	});

	test('meses (singular y plural)', () => {
		expect(tiempoRelativo('2026-07-06T12:00:00', ahora)).toBe('hace 1 mes');
		expect(tiempoRelativo('2026-06-06T12:00:00', ahora)).toBe('hace 2 meses');
		expect(tiempoRelativo('2025-09-06T12:00:00', ahora)).toBe('hace 11 meses');
	});

	test('años (singular y plural)', () => {
		expect(tiempoRelativo('2025-08-06T12:00:00', ahora)).toBe('hace 1 año');
		expect(tiempoRelativo('2024-08-06T12:00:00', ahora)).toBe('hace 2 años');
	});
});
