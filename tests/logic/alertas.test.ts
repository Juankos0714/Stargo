import { describe, expect, test } from 'vitest';
import {
	hayAlertaReciente,
	pedidosPendientesVencidos,
	pesoNivel,
	textoWebhook,
	type NivelAlerta
} from '../../src/lib/logic/alertas';

describe('alertas — pedidosPendientesVencidos', () => {
	const ahora = new Date('2026-01-01T12:00:00Z');
	const hace = (min: number) => new Date(ahora.getTime() - min * 60_000).toISOString();

	test('filtra solo los que superan el umbral, ordenados del más antiguo primero', () => {
		const vencidos = pedidosPendientesVencidos(
			[
				{ numero: 'NUEVO', created_at: hace(5) },
				{ numero: 'VIEJO', created_at: hace(120) },
				{ numero: 'MEDIO', created_at: hace(45) }
			],
			ahora,
			30
		);
		expect(vencidos.map((p) => p.numero)).toEqual(['VIEJO', 'MEDIO']);
		expect(vencidos[0].minutos).toBe(120);
		expect(vencidos[1].minutos).toBe(45);
	});

	test('con umbral 0 todo pendiente con algo de antigüedad cuenta', () => {
		const vencidos = pedidosPendientesVencidos([{ numero: 'A', created_at: hace(1) }], ahora, 0);
		expect(vencidos).toHaveLength(1);
		expect(vencidos[0].minutos).toBe(1);
	});

	test('fechas inválidas se ignoran', () => {
		const vencidos = pedidosPendientesVencidos([{ numero: 'ROTO', created_at: 'no-es-fecha' }], ahora, 10);
		expect(vencidos).toHaveLength(0);
	});

	test('lista vacía o sin vencidos', () => {
		expect(pedidosPendientesVencidos([], ahora, 10)).toEqual([]);
		expect(
			pedidosPendientesVencidos([{ numero: 'RECIENTE', created_at: hace(2) }], ahora, 10)
		).toEqual([]);
	});
});

describe('alertas — hayAlertaReciente', () => {
	const ahora = new Date('2026-01-01T12:00:00Z');

	test('true si alguna alerta está dentro del cooldown', () => {
		expect(
			hayAlertaReciente(['2026-01-01T11:30:00Z'], ahora, 60)
		).toBe(true);
		expect(
			hayAlertaReciente(['2026-01-01T12:00:00Z', '2026-01-01T01:00:00Z'], ahora, 60)
		).toBe(true);
	});

	test('false si todas están fuera del cooldown', () => {
		expect(hayAlertaReciente(['2026-01-01T10:00:00Z'], ahora, 60)).toBe(false);
		expect(hayAlertaReciente([], ahora, 60)).toBe(false);
	});

	test('fechas nulas o inválidas no cuentan', () => {
		expect(hayAlertaReciente([null, undefined, 'basura'], ahora, 60)).toBe(false);
	});
});

describe('alertas — textoWebhook y niveles', () => {
	test('incluye entorno, emoji por nivel y detalle en línea nueva', () => {
		const texto = textoWebhook('Supabase caído', 'critical', 'No responde', 'staging');
		expect(texto).toContain('[StarGo · staging]');
		expect(texto).toContain('🚨');
		expect(texto).toContain('Supabase caído');
		expect(texto).toContain('\nNo responde');
	});

	test('sin detalle no añade línea vacía', () => {
		expect(textoWebhook('X', 'info', '', 'prod')).toBe('[StarGo · prod] ℹ️ X');
	});

	test('pesoNivel ordena por severidad', () => {
		const orden = ['info', 'warning', 'critical'] as NivelAlerta[];
		const pesos = orden.map(pesoNivel);
		expect(pesos).toEqual([1, 2, 3]);
	});
});
