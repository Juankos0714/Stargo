import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import {
	RLS_DISPONIBLE,
	clienteService,
	clienteComo,
	crearAdmin,
	esperaError,
	limpiarTodo,
	type UsuarioRol
} from './helpers';

/**
 * CHECK constraint en comision_historico.niveles (Fase 18).
 *
 * La columna niveles debe ser un JSONB array (no object, no string, no null).
 * El CHECK: CHECK (jsonb_typeof(niveles) = 'array').
 *
 * Se prueba con service_role (RLS no aplica, pero CHECK siempre se evalúa).
 */
describe.skipIf(!RLS_DISPONIBLE)('CHECK comision_historico.niveles = array', () => {
	let servicio: ReturnType<typeof clienteService>;
	let admin: UsuarioRol;

	beforeAll(async () => {
		servicio = clienteService();
		admin = await crearAdmin();
	});

	afterAll(async () => {
		await limpiarTodo();
	});

	test('INSERT con niveles = array válido → aceptado', async () => {
		const { error } = await servicio.from('comision_historico').insert({
			fecha: '2099-12-31',
			niveles: [{ nivel: 1, hasta: 10000, valor: 1300 }],
			paso: 10000,
			es_backfill: false
		});
		expect(error, `INSERT array válido falló: ${error?.message}`).toBeNull();
		// Limpieza.
		await servicio.from('comision_historico').delete().eq('fecha', '2099-12-31');
	});

	test('INSERT con niveles = object JSONB → rechazado por CHECK', async () => {
		const { error } = await servicio.from('comision_historico').insert({
			fecha: '2099-12-30',
			niveles: { nivel: 1, hasta: 10000, valor: 1300 }, // object, no array
			paso: 10000,
			es_backfill: false
		});
		esperaError(
			{ error: error ? { message: error.message, code: error.code ?? '' } : null, filas: 0 },
			'INSERT object en niveles',
			/check|violat/i
		);
	});

	test('INSERT con niveles = string → rechazado por CHECK', async () => {
		const { error } = await servicio.from('comision_historico').insert({
			fecha: '2099-12-29',
			niveles: 'no soy un array', // string, no array
			paso: 10000,
			es_backfill: false
		});
		esperaError(
			{ error: error ? { message: error.message, code: error.code ?? '' } : null, filas: 0 },
			'INSERT string en niveles',
			/check|violat|invalid/i
		);
	});

	test('INSERT con niveles = number → rechazado por CHECK', async () => {
		const { error } = await servicio.from('comision_historico').insert({
			fecha: '2099-12-28',
			niveles: 42, // number, no array
			paso: 10000,
			es_backfill: false
		});
		esperaError(
			{ error: error ? { message: error.message, code: error.code ?? '' } : null, filas: 0 },
			'INSERT number en niveles',
			/check|violat|invalid/i
		);
	});

	test('INSERT con niveles = null → aceptado (nullable)', async () => {
		// La columna puede ser null (la migración no pone NOT NULL).
		const { error } = await servicio.from('comision_historico').insert({
			fecha: '2099-12-27',
			niveles: null,
			paso: 10000,
			es_backfill: false
		});
		expect(error, `INSERT null en niveles falló: ${error?.message}`).toBeNull();
		// Limpieza.
		await servicio.from('comision_historico').delete().eq('fecha', '2099-12-27');
	});

	test('INSERT con niveles = array vacío → aceptado', async () => {
		const { error } = await servicio.from('comision_historico').insert({
			fecha: '2099-12-26',
			niveles: [],
			paso: 10000,
			es_backfill: false
		});
		expect(error, `INSERT array vacío falló: ${error?.message}`).toBeNull();
		// Limpieza.
		await servicio.from('comision_historico').delete().eq('fecha', '2099-12-26');
	});

	test('UPDATE cambiando niveles a object → rechazado por CHECK', async () => {
		// Primero inserta un registro válido.
		await servicio.from('comision_historico').insert({
			fecha: '2099-12-25',
			niveles: [{ nivel: 1, hasta: 10000, valor: 1300 }],
			paso: 10000,
			es_backfill: false
		});

		const { error } = await servicio
			.from('comision_historico')
			.update({ niveles: { invalido: true } })
			.eq('fecha', '2099-12-25');

		esperaError(
			{ error: error ? { message: error.message, code: error.code ?? '' } : null, filas: 0 },
			'UPDATE niveles a object',
			/check|violat/i
		);

		// Limpieza.
		await servicio.from('comision_historico').delete().eq('fecha', '2099-12-25');
	});
});
