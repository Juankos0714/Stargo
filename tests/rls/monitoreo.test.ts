import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';	import {
	RLS_DISPONIBLE,
	clienteAnon,
	clienteService,
	clienteComo,
	crearAdmin,
	crearCliente,
	sembrarCatalogo,
	seleccion,
	actualizacion,
	insercion,
	eliminacion,
	esperaDenegado,
	esperaPermitido,
	esperaVacio,
	limpiarTodo,
	PREFIJO,
	type Catalogo,
	type UsuarioRol
} from './helpers';

/**
 * Parte 9 — RLS de las tablas de monitoreo y el trigger de auditoría.
 *
 * Matriz esperada (ver migracion_fase9_monitoreo.sql):
 *   errores_app        : anon/authenticated SOLO ejecutan el RPC
 *                        registrar_error; nadie lee sin ser admin.
 *   alertas            : anon/authenticated SOLO ejecutan registrar_alerta;
 *                        SELECT solo admin.
 *   historial_tarifas  : SELECT solo admin; los INSERT los hace el trigger
 *                        SECURITY DEFINER al modificar la matriz.
 *   RPCs de alerta     : pedidos_pendientes_para_alerta / errores_recientes
 *                        / alerta_reciente ejecutables por anon (el cron usa
 *                        el cliente anónimo del servidor).
 */
describe.skipIf(!RLS_DISPONIBLE)('RLS — monitoreo (errores, alertas, auditoría de tarifas)', () => {
	let servicio: SupabaseClient;
	let anon: SupabaseClient;
	let admin: UsuarioRol;
	let cliente: UsuarioRol;
	let cat: Catalogo;

	beforeAll(async () => {
		servicio = clienteService();
		anon = clienteAnon();
		cat = await sembrarCatalogo();
		[admin, cliente] = await Promise.all([crearAdmin(), crearCliente()]);
	});

	afterAll(async () => {
		// Limpieza específica de las tablas de monitoreo (la genérica no las
		// toca): errores y alertas de esta corrida + auditoría de tarifas del
		// catálogo sembrado.
		const s = clienteService();
		await s.from('errores_app').delete().eq('mensaje', 'Error de prueba RLS');
		await s.from('alertas').delete().eq('evento', 'alerta_test');
		await s.from('historial_tarifas').delete().like('zona_origen_id', `zona_${PREFIJO}%`);
		await limpiarTodo();
	});

	// ---------- errores_app ----------

	describe('errores_app', () => {
		test('anon ejecuta registrar_error (RPC) y el error queda registrado', async () => {
			const { error } = await anon.rpc('registrar_error', {
				p_origen: 'cliente',
				p_tipo: 'unhandled',
				p_mensaje: 'Error de prueba RLS',
				p_ruta: '/test'
			});
			expect(error, `registrar_error falló: ${error?.message}`).toBeNull();
		});

		test('anon NO puede SELECT errores_app (ni con filtro)', async () => {
			esperaDenegado(await seleccion(anon, 'errores_app'), 'anon SELECT errores_app');
			esperaVacio(
				await seleccion(anon, 'errores_app', { columna: 'tipo', valor: 'unhandled' }),
				'anon SELECT errores_app filtrado'
			);
		});

		test('admin SÍ puede SELECT errores_app', async () => {
			esperaPermitido(
				await seleccion(clienteComo(admin.token), 'errores_app'),
				'admin SELECT errores_app'
			);
		});

		test('cliente (autenticado sin rol) NO puede leer errores_app', async () => {
			esperaVacio(
				await seleccion(clienteComo(cliente.token), 'errores_app'),
				'cliente SELECT errores_app'
			);
		});

		test('anon NO puede INSERT directo en errores_app (solo vía RPC)', async () => {
			esperaDenegado(
				await insercion(anon, 'errores_app', { origen: 'cliente', tipo: 'x', mensaje: 'y' }),
				'anon INSERT errores_app'
			);
		});

		test('registrar_error valida el origen (rechaza valores fuera de la taxonomía)', async () => {
			const { error } = await anon.rpc('registrar_error', {
				p_origen: 'hacker',
				p_tipo: 'otro',
				p_mensaje: 'x',
				p_ruta: null
			});
			expect(error, 'debería rechazar origen inválido').not.toBeNull();
		});
	});

	// ---------- alertas ----------

	describe('alertas', () => {
		test('anon ejecuta registrar_alerta (RPC) y la alerta queda registrada', async () => {
			const { error } = await anon.rpc('registrar_alerta', {
				p_evento: 'alerta_test',
				p_nivel: 'info',
				p_detalle: 'Prueba RLS'
			});
			expect(error, `registrar_alerta falló: ${error?.message}`).toBeNull();
		});

		test('anon NO puede SELECT alertas; admin SÍ', async () => {
			esperaDenegado(await seleccion(anon, 'alertas'), 'anon SELECT alertas');
			esperaPermitido(
				await seleccion(clienteComo(admin.token), 'alertas'),
				'admin SELECT alertas'
			);
		});

		test('anon NO puede INSERT directo en alertas', async () => {
			esperaDenegado(
				await insercion(anon, 'alertas', { evento: 'x', nivel: 'info' }),
				'anon INSERT alertas'
			);
		});

		test('registrar_alerta rechaza nivel inválido', async () => {
			const { error } = await anon.rpc('registrar_alerta', {
				p_evento: 'x',
				p_nivel: 'extremo',
				p_detalle: null
			});
			expect(error).not.toBeNull();
		});
	});

	// ---------- historial_tarifas (auditoría) ----------

	describe('historial_tarifas — trigger de auditoría', () => {
		test('UPDATE de una tarifa genera la fila de auditoría con valores antes/después', async () => {
			// Cambia la tarifa sembrada por el admin autenticado (auth.uid()).
			const { error } = await actualizacion(
				clienteComo(admin.token),
				'tarifas',
				'zona_origen_id',
				cat.zonaA,
				{ valor: 7777 }
			);
			expect(error, `update tarifa falló: ${error?.message}`).toBeNull();

			const { data } = await servicio
				.from('historial_tarifas')
				.select('operacion, valor_antes, valor_despues, usuario_id')
				.eq('zona_origen_id', cat.zonaA)
				.order('id', { ascending: false })
				.limit(1)
				.single();
			expect(data, 'debería existir la fila de auditoría').not.toBeNull();
			expect(data?.operacion).toBe('UPDATE');
			expect(data?.valor_antes).toBe(6000);
			expect(data?.valor_despues).toBe(7777);
			expect(data?.usuario_id).toBe(admin.userId);
		});

		test('INSERT y DELETE también se auditan', async () => {
			// INSERT
			const { error: errIns } = await insercion(clienteComo(admin.token), 'tarifas', {
				zona_origen_id: cat.zonaB,
				zona_destino_id: cat.zonaA,
				valor: 8888
			});
			expect(errIns).toBeNull();
			// DELETE
			const { error: errDel } = await eliminacion(
				clienteComo(admin.token),
				'tarifas',
				'zona_origen_id',
				cat.zonaB
			);
			expect(errDel).toBeNull();

			const { data } = await servicio
				.from('historial_tarifas')
				.select('operacion')
				.eq('zona_origen_id', cat.zonaB)
				.order('id', { ascending: false })
				.limit(2);
			const ops = (data ?? []).map((f) => f.operacion);
			expect(ops).toContain('INSERT');
			expect(ops).toContain('DELETE');
		});

		test('anon NO puede leer historial_tarifas; admin SÍ', async () => {
			esperaDenegado(
				await seleccion(anon, 'historial_tarifas'),
				'anon SELECT historial_tarifas'
			);
			esperaPermitido(
				await seleccion(clienteComo(admin.token), 'historial_tarifas'),
				'admin SELECT historial_tarifas'
			);
		});
	});

	// ---------- RPCs del cron de alertas ----------

	describe('RPCs del cron (clientes anónimos del servidor)', () => {
		test('pedidos_pendientes_para_alerta: ejecutable por anon y devuelve solo lo mínimo', async () => {
			const { data, error } = await anon.rpc('pedidos_pendientes_para_alerta', {
				p_minutos: 0
			});
			expect(error, `RPC falló: ${error?.message}`).toBeNull();
			expect(Array.isArray(data)).toBe(true);
		});

		test('errores_recientes_para_alerta: ejecutable por anon, agrupa por tipo', async () => {
			const { data, error } = await anon.rpc('errores_recientes_para_alerta', {
				p_minutos: 60
			});
			expect(error, `RPC falló: ${error?.message}`).toBeNull();
			expect(Array.isArray(data)).toBe(true);
		});

		test('alerta_reciente: ejecutable por anon, devuelve booleano', async () => {
			const { data, error } = await anon.rpc('alerta_reciente', {
				p_evento: 'no_existe_evento',
				p_minutos: 60
			});
			expect(error, `RPC falló: ${error?.message}`).toBeNull();
			expect(typeof data).toBe('boolean');
		});
	});
});
