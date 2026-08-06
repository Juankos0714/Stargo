import { describe, expect, test } from 'vitest';
import { buscarTarifa, calcularTarifaPura, ZONA_ROJA, type TarifaMatriz } from '../../src/lib/logic/tarifa';

const CENTRO = { nombre: 'Centro', zona_id: 'z1' };
const CANO = { nombre: 'Caño', zona_id: 'z2' };
const NORTE = { nombre: 'Norte', zona_id: 'z3' };

const tarifa = (zona_origen_id: string, zona_destino_id: string, valor: number | null): TarifaMatriz => ({
	zona_origen_id,
	zona_destino_id,
	valor
});

describe('buscarTarifa (matriz simétrica)', () => {
	test('devuelve la tarifa directa cuando existe', () => {
		const tarifas = [
			tarifa('z1', 'z2', 6000),
			tarifa('z2', 'z3', 7000)
		];
		expect(buscarTarifa('z1', 'z2', tarifas)).toBe(6000);
	});

	test('cae al sentido inverso cuando la directa no existe', () => {
		const tarifas = [tarifa('z2', 'z1', 7500)];
		expect(buscarTarifa('z1', 'z2', tarifas)).toBe(7500);
	});

	test('una fila directa con valor null se trata como inexistente y cae al inverso', () => {
		const tarifas = [tarifa('z1', 'z2', null), tarifa('z2', 'z1', 8000)];
		expect(buscarTarifa('z1', 'z2', tarifas)).toBe(8000);
	});

	test('devuelve null si ni directa ni inversa existen', () => {
		expect(buscarTarifa('z1', 'z2', [])).toBeNull();
		expect(buscarTarifa('z1', 'z2', [tarifa('z1', 'z3', 5000)])).toBeNull();
	});

	test('ignora filas con valor null al resolver el inverso', () => {
		const tarifas = [tarifa('z2', 'z1', null)];
		expect(buscarTarifa('z1', 'z2', tarifas)).toBeNull();
	});
});

describe('calcularTarifaPura (barrio → zona → matriz)', () => {
	test('tarifa directa: motivo ok y meta completa', () => {
		const r = calcularTarifaPura(CENTRO, CANO, [tarifa('z1', 'z2', 6000)]);
		expect(r.valor).toBe(6000);
		expect(r.meta.disponible).toBe(true);
		expect(r.meta.motivo).toBe('ok');
		expect(r.meta.barrio_origen).toBe('Centro');
		expect(r.meta.barrio_destino).toBe('Caño');
		expect(r.meta.zona_origen).toBe('z1');
		expect(r.meta.zona_destino).toBe('z2');
	});

	test('tarifa simétrica (sentido inverso)', () => {
		const r = calcularTarifaPura(CENTRO, CANO, [tarifa('z2', 'z1', 7500)]);
		expect(r.valor).toBe(7500);
		expect(r.meta.motivo).toBe('ok');
	});

	test('una tarifa de valor 0 es válida (no se confunde con «no hay tarifa»)', () => {
		const r = calcularTarifaPura(CENTRO, CANO, [tarifa('z1', 'z2', 0)]);
		expect(r.valor).toBe(0);
		expect(r.meta.disponible).toBe(true);
		expect(r.meta.motivo).toBe('ok');
	});

	test('sin tarifa: fallo controlado (motivo sin_tarifa, nunca excepción)', () => {
		const r = calcularTarifaPura(CENTRO, CANO, []);
		expect(r.valor).toBeNull();
		expect(r.meta.disponible).toBe(false);
		expect(r.meta.motivo).toBe('sin_tarifa');
	});

	test('ambos barrios inexistentes: barrio_no_encontrado', () => {
		const r = calcularTarifaPura(null, null, []);
		expect(r.valor).toBeNull();
		expect(r.meta.motivo).toBe('barrio_no_encontrado');
		expect(r.meta.barrio_origen).toBeNull();
		expect(r.meta.barrio_destino).toBeNull();
	});

	test('solo el origen inexistente: barrio_no_encontrado con el destino presente', () => {
		const r = calcularTarifaPura(null, CANO, []);
		expect(r.meta.motivo).toBe('barrio_no_encontrado');
		expect(r.meta.barrio_origen).toBeNull();
		expect(r.meta.barrio_destino).toBe('Caño');
	});

	test('solo el destino inexistente: barrio_no_encontrado con el origen presente', () => {
		const r = calcularTarifaPura(CENTRO, null, []);
		expect(r.meta.motivo).toBe('barrio_no_encontrado');
		expect(r.meta.barrio_origen).toBe('Centro');
		expect(r.meta.barrio_destino).toBeNull();
	});

	test('barrio sin sector asignado (zona null): zona_no_disponible', () => {
		const sinSector = { nombre: 'Sin sector', zona_id: null };
		const r = calcularTarifaPura(sinSector, CANO, [tarifa('z1', 'z2', 6000)]);
		expect(r.valor).toBeNull();
		expect(r.meta.motivo).toBe('zona_no_disponible');
		expect(r.meta.zona_origen).toBeNull();
	});

	test('destino sin sector asignado: zona_no_disponible', () => {
		const sinSector = { nombre: 'Sin sector', zona_id: null };
		const r = calcularTarifaPura(CENTRO, sinSector, []);
		expect(r.meta.motivo).toBe('zona_no_disponible');
	});

	test('origen en zona roja: zona_no_disponible', () => {
		const rojo = { nombre: 'Zona Roja', zona_id: ZONA_ROJA };
		const r = calcularTarifaPura(rojo, CANO, []);
		expect(r.valor).toBeNull();
		expect(r.meta.motivo).toBe('zona_no_disponible');
		expect(r.meta.zona_origen).toBe(ZONA_ROJA);
	});

	test('destino en zona roja: zona_no_disponible', () => {
		const rojo = { nombre: 'Zona Roja', zona_id: ZONA_ROJA };
		const r = calcularTarifaPura(CENTRO, rojo, [tarifa('z1', ZONA_ROJA, 9999)]);
		expect(r.meta.motivo).toBe('zona_no_disponible');
		expect(r.meta.zona_destino).toBe(ZONA_ROJA);
	});
});
