import { describe, expect, test } from 'vitest';
import {
	DIAS_SEMANA,
	diaDeFecha,
	esHoraValida,
	etiquetaDia,
	horarioAbierto,
	validarHoras
} from '../../src/lib/logic/horario';

describe('esHoraValida', () => {
	test('acepta HH:MM de 24 horas', () => {
		expect(esHoraValida('08:00')).toBe(true);
		expect(esHoraValida('00:00')).toBe(true);
		expect(esHoraValida('23:59')).toBe(true);
		expect(esHoraValida('20:15')).toBe(true);
	});

	test('rechaza formatos inválidos', () => {
		expect(esHoraValida('8:00')).toBe(false);
		expect(esHoraValida('24:00')).toBe(false);
		expect(esHoraValida('08:60')).toBe(false);
		expect(esHoraValida('0800')).toBe(false);
		expect(esHoraValida('')).toBe(false);
	});
});

describe('validarHoras', () => {
	test('acepta un rango normal (apertura < cierre) y uno que cruza la medianoche', () => {
		expect(validarHoras('08:00', '20:00')).toBeNull();
		expect(validarHoras('20:00', '02:00')).toBeNull();
	});

	test('rechaza horas idénticas (0 minutos de atención)', () => {
		expect(validarHoras('08:00', '08:00')).toMatch(/misma hora/);
	});

	test('rechaza formatos inválidos', () => {
		expect(validarHoras('8:00', '20:00')).toMatch(/HH:MM/);
		expect(validarHoras('08:00', '20')).toMatch(/HH:MM/);
	});
});

describe('horarioAbierto', () => {
	test('rango normal: abierto dentro de [apertura, cierre)', () => {
		expect(horarioAbierto('08:00', '20:00', '08:00')).toBe(true);
		expect(horarioAbierto('08:00', '20:00', '12:30')).toBe(true);
		expect(horarioAbierto('08:00', '20:00', '19:59')).toBe(true);
		expect(horarioAbierto('08:00', '20:00', '20:00')).toBe(false);
		expect(horarioAbierto('08:00', '20:00', '07:59')).toBe(false);
	});

	test('horario que cruza la medianoche (20:00 → 02:00)', () => {
		expect(horarioAbierto('20:00', '02:00', '21:00')).toBe(true);
		expect(horarioAbierto('20:00', '02:00', '23:59')).toBe(true);
		expect(horarioAbierto('20:00', '02:00', '01:00')).toBe(true);
		expect(horarioAbierto('20:00', '02:00', '19:59')).toBe(false);
		expect(horarioAbierto('20:00', '02:00', '02:00')).toBe(false);
		expect(horarioAbierto('20:00', '02:00', '03:00')).toBe(false);
	});

	test('horas inválidas → cerrado', () => {
		expect(horarioAbierto('08:00', '20:00', '')).toBe(false);
		expect(horarioAbierto('8:00', '20:00', '12:00')).toBe(false);
	});
});

describe('etiquetaDia y DIAS_SEMANA', () => {
	test('1 = Lunes … 7 = Domingo', () => {
		expect(DIAS_SEMANA.map((d) => d.label)).toEqual([
			'Lunes',
			'Martes',
			'Miércoles',
			'Jueves',
			'Viernes',
			'Sábado',
			'Domingo'
		]);
		expect(etiquetaDia(1)).toBe('Lunes');
		expect(etiquetaDia(7)).toBe('Domingo');
		expect(etiquetaDia(9)).toBe('Día 9');
	});
});

describe('diaDeFecha', () => {
	test('2026-08-03 fue lunes (1)', () => {
		expect(diaDeFecha('2026-08-03')).toBe(1);
	});
	test('2026-08-09 fue domingo (7)', () => {
		expect(diaDeFecha('2026-08-09')).toBe(7);
	});
	test('fechas inválidas devuelven 0', () => {
		expect(diaDeFecha('')).toBe(0);
		expect(diaDeFecha('no')).toBe(0);
		expect(diaDeFecha('2026-13-40')).toBe(0);
	});
});
