import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	RLS_DISPONIBLE,
	clienteAnon,
	clienteService,
	clienteComo,
	crearAdmin,
	crearDomiciliario,
	crearCliente,
	sembrarCatalogo,
	sembrarPedido,
	seleccion,
	insercion,
	actualizacion,
	eliminacion,
	esperaDenegado,
	esperaPermitido,
	esperaVacio,
	limpiarTodo,
	type Catalogo,
	type UsuarioRol
} from './helpers';

/**
 * Matriz RLS esperada (ver supabase/audit_rls.sql):
 *   zonas/barrios/tarifas/recargos : SELECT público; escritura solo admin.
 *   pedido_eventos                 : SELECT público.
 *   pedidos                        : SELECT admin todo; domiciliario solo sus asignados;
 *                                    UPDATE/INSERT SOLO vía RPCs; DELETE por SQL solo admin
 *                                    (política pedidos_admin_delete, Fase 8).
 *   historial_estados              : SELECT admin todo; domiciliario solo el suyo.
 *   domiciliarios                  : admin todo; domiciliario solo su fila.
 *   admins                         : cada usuario solo su propia fila.
 * El anon NO tiene grants sobre las tablas privadas.
 */
describe.skipIf(!RLS_DISPONIBLE)('RLS — matriz de acceso por tabla y rol', () => {
	let servicio: SupabaseClient;
	let anon: SupabaseClient;
	let admin: UsuarioRol;
	let domA: UsuarioRol & { domiciliarioId: string };
	let domB: UsuarioRol & { domiciliarioId: string };
	let cliente: UsuarioRol;
	let cat: Catalogo;
	let pDeA: { id: string; numero: string };
	let pDeB: { id: string; numero: string };
	let pSinAsignar: { id: string; numero: string };

	beforeAll(async () => {
		servicio = clienteService();
		anon = clienteAnon();
		cat = await sembrarCatalogo();
		admin = await crearAdmin();
		domA = await crearDomiciliario();
		domB = await crearDomiciliario();
		cliente = await crearCliente();
		pDeA = await sembrarPedido({
			barrioOrigenId: cat.barrioA,
			barrioDestinoId: cat.barrioB,
			estado: 'asignado',
			domiciliarioId: domA.domiciliarioId
		});
		pDeB = await sembrarPedido({
			barrioOrigenId: cat.barrioA,
			barrioDestinoId: cat.barrioB,
			estado: 'asignado',
			domiciliarioId: domB.domiciliarioId
		});
		pSinAsignar = await sembrarPedido({
			barrioOrigenId: cat.barrioA,
			barrioDestinoId: cat.barrioB,
			estado: 'pendiente'
		});
		// Historial de cada pedido (para probar el aislamiento del domiciliario).
		await servicio.from('historial_estados').insert([
			{ pedido_id: pDeA.id, estado: 'asignado', notas: 'Asignado a A' },
			{ pedido_id: pDeB.id, estado: 'asignado', notas: 'Asignado a B' }
		]);
	});

	afterAll(async () => {
		await limpiarTodo();
	});

	// ---------- Catálogo público (zonas, barrios, tarifas, recargos) ----------

	describe('catálogo público: lectura anónima y autenticada', () => {
		for (const tabla of ['zonas', 'barrios', 'tarifas', 'recargos']) {
			test(`anon puede SELECT ${tabla}`, async () => {
				esperaPermitido(await seleccion(anon, tabla), `anon SELECT ${tabla}`);
			});
		}

		test('cliente (autenticado sin rol) puede SELECT zonas', async () => {
			esperaPermitido(await seleccion(clienteComo(cliente.token), 'zonas'), 'cliente SELECT zonas');
		});

		test('admin puede SELECT zonas', async () => {
			esperaPermitido(await seleccion(clienteComo(admin.token), 'zonas'), 'admin SELECT zonas');
		});
	});

	describe('anon: no lee tablas sensibles ni escribe el catálogo', () => {
		for (const tabla of ['pedidos', 'historial_estados', 'domiciliarios', 'admins']) {
			test(`anon NO puede SELECT ${tabla}`, async () => {
				esperaDenegado(await seleccion(anon, tabla), `anon SELECT ${tabla}`);
			});
		}

		test('anon NO puede INSERT en tarifas', async () => {
			esperaDenegado(
				await insercion(anon, 'tarifas', {
					zona_origen_id: cat.zonaA,
					zona_destino_id: cat.zonaB,
					valor: 1
				}),
				'anon INSERT tarifas'
			);
		});

		test('anon NO puede UPDATE tarifas', async () => {
			esperaDenegado(
				await actualizacion(anon, 'tarifas', 'zona_origen_id', cat.zonaA, { valor: 1 }),
				'anon UPDATE tarifas'
			);
		});
	});

	// ---------- Cliente (autenticado sin rol) ----------

	describe('cliente: solo lectura pública; cero acceso a pedidos', () => {
		test('cliente NO puede SELECT pedidos (denegación silenciosa: 0 filas)', async () => {
			esperaVacio(await seleccion(clienteComo(cliente.token), 'pedidos'), 'cliente SELECT pedidos');
		});

		test('cliente NO puede SELECT historial_estados', async () => {
			esperaVacio(
				await seleccion(clienteComo(cliente.token), 'historial_estados'),
				'cliente SELECT historial_estados'
			);
		});

		test('cliente NO puede SELECT domiciliarios', async () => {
			esperaVacio(
				await seleccion(clienteComo(cliente.token), 'domiciliarios'),
				'cliente SELECT domiciliarios'
			);
		});

		test('cliente NO puede SELECT admins', async () => {
			esperaVacio(await seleccion(clienteComo(cliente.token), 'admins'), 'cliente SELECT admins');
		});

		test('cliente NO puede INSERT un pedido directamente (solo vía RPC crear_pedido)', async () => {
			esperaDenegado(
				await insercion(clienteComo(cliente.token), 'pedidos', {
					numero: `X${Math.random().toString(36).slice(2, 8)}`,
					barrio_origen_id: cat.barrioA,
					direccion_origen: 'x',
					barrio_destino_id: cat.barrioB,
					direccion_destino: 'y',
					tarifa_base: 5000,
					estado: 'pendiente'
				}),
				'cliente INSERT pedidos'
			);
		});

		test('cliente NO puede cambiar el estado de un pedido directamente', async () => {
			esperaDenegado(
				await actualizacion(clienteComo(cliente.token), 'pedidos', 'numero', pSinAsignar.numero, {
					estado: 'cancelado'
				}),
				'cliente UPDATE pedido.estado'
			);
		});

		test('cliente NO puede borrar un pedido', async () => {
			esperaDenegado(
				await eliminacion(clienteComo(cliente.token), 'pedidos', 'numero', pSinAsignar.numero),
				'cliente DELETE pedidos'
			);
		});

		test('cliente NO puede escribir el catálogo (RLS es_admin())', async () => {
			esperaDenegado(
				await insercion(clienteComo(cliente.token), 'tarifas', {
					zona_origen_id: cat.zonaA,
					zona_destino_id: cat.zonaB,
					valor: 1
				}),
				'cliente INSERT tarifas'
			);
			esperaDenegado(
				await actualizacion(clienteComo(cliente.token), 'tarifas', 'zona_origen_id', cat.zonaA, {
					valor: 1
				}),
				'cliente UPDATE tarifas'
			);
		});

		test('cliente NO puede leer pedidos ajenos (ni siquiera el que creó vía RPC)', async () => {
			// El cliente crea un pedido por el flujo público autorizado…
			const r = await anon.rpc('crear_pedido', {
				p_barrio_origen_id: cat.barrioA,
				p_direccion_origen: 'Calle test',
				p_barrio_destino_id: cat.barrioB,
				p_direccion_destino: 'Carrera test',
				p_observaciones: null,
				p_recargos: null,
				p_telefono: '3001234567'
			});
			expect(r.error, `crear_pedido falló: ${r.error?.message}`).toBeNull();
			const numero = r.data?.numero as string;
			expect(numero).toBeTruthy();
			// …pero NO puede verlo por SQL directo: solo consultar_pedido (público).
			esperaVacio(
				await seleccion(clienteComo(cliente.token), 'pedidos', { columna: 'numero', valor: numero }),
				'cliente SELECT su propio pedido por SQL'
			);
		});
	});

	// ---------- Domiciliario ----------

	describe('domiciliario: solo sus pedidos asignados; nunca escribe por SQL', () => {
		test('domiciliario A ve SOLO su pedido asignado (no el de B ni el pendiente)', async () => {
			const r = await seleccion(clienteComo(domA.token), 'pedidos');
			esperaPermitido(r, 'domA SELECT pedidos');
			expect(r.filas, 'domA debería ver exactamente 1 pedido').toBe(1);

			esperaVacio(
				await seleccion(clienteComo(domA.token), 'pedidos', { columna: 'id', valor: pDeB.id }),
				'domA SELECT pedido de domB'
			);
			esperaVacio(
				await seleccion(clienteComo(domA.token), 'pedidos', { columna: 'id', valor: pSinAsignar.id }),
				'domA SELECT pedido sin asignar'
			);
		});

		test('el teléfono del cliente es visible SOLO para el admin y el domiciliario asignado (Fase 19)', async () => {
			// Siembra el teléfono como lo haría crear_pedido.
			await servicio
				.from('pedidos')
				.update({ telefono: '3001234567', nombre_cliente: 'Ana' })
				.eq('id', pDeA.id);

			// El domiciliario A ve el teléfono de SU pedido asignado.
			const cDomA = clienteComo(domA.token);
			const { data: mio } = await cDomA.from('pedidos').select('telefono, nombre_cliente').eq('id', pDeA.id).single();
			expect(mio?.telefono).toBe('3001234567');
			expect(mio?.nombre_cliente).toBe('Ana');

			// El domiciliario B NO ve el pedido de A (ni por tanto su teléfono).
			esperaVacio(
				await seleccion(clienteComo(domB.token), 'pedidos', { columna: 'id', valor: pDeA.id }),
				'domB SELECT pedido de domA (con teléfono)'
			);

			// El cliente (sin rol) tampoco lo ve.
			esperaVacio(
				await seleccion(clienteComo(cliente.token), 'pedidos', { columna: 'id', valor: pDeA.id }),
				'cliente SELECT pedido ajeno (con teléfono)'
			);
		});

		test('domiciliario A ve el historial de su pedido, no el de B', async () => {
			esperaPermitido(
				await seleccion(clienteComo(domA.token), 'historial_estados', {
					columna: 'pedido_id',
					valor: pDeA.id
				}),
				'domA SELECT historial propio'
			);
			esperaVacio(
				await seleccion(clienteComo(domA.token), 'historial_estados', {
					columna: 'pedido_id',
					valor: pDeB.id
				}),
				'domA SELECT historial de domB'
			);
		});

		test('domiciliario A ve solo su propia fila en domiciliarios', async () => {
			const r = await seleccion(clienteComo(domA.token), 'domiciliarios');
			esperaPermitido(r, 'domA SELECT domiciliarios');
			expect(r.filas, 'domA debería ver exactamente su fila').toBe(1);
		});

		test('domiciliario NO puede modificar el campo tarifa de un pedido (ni el suyo)', async () => {
			esperaDenegado(
				await actualizacion(clienteComo(domA.token), 'pedidos', 'id', pDeA.id, {
					tarifa_base: 999999
				}),
				'domA UPDATE tarifa_base'
			);
		});

		test('domiciliario NO puede cambiar el estado por SQL directo (solo vía RPC transicionar_pedido)', async () => {
			esperaDenegado(
				await actualizacion(clienteComo(domA.token), 'pedidos', 'id', pDeA.id, {
					estado: 'entregado'
				}),
				'domA UPDATE estado directo'
			);
		});

		test('domiciliario NO puede borrar pedidos', async () => {
			esperaDenegado(
				await eliminacion(clienteComo(domA.token), 'pedidos', 'id', pDeA.id),
				'domA DELETE pedidos'
			);
		});
	});

	// ---------- Admin ----------

	describe('admin: acceso total', () => {
		test('admin ve todos los pedidos', async () => {
			const r = await seleccion(clienteComo(admin.token), 'pedidos');
			esperaPermitido(r, 'admin SELECT pedidos');
			expect(r.filas, 'admin debería ver los 3 pedidos sembrados').toBeGreaterThanOrEqual(3);
		});

		test('admin puede INSERT, UPDATE y DELETE en el catálogo', async () => {
			const zonaTmp = `zona_tmp_${Date.now().toString(36)}`;
			const cAdmin = clienteComo(admin.token);

			esperaPermitido(
				await insercion(cAdmin, 'zonas', { id: zonaTmp, nombre: 'Zona temporal', tipo: 'urbana' }),
				'admin INSERT zonas'
			);
			esperaPermitido(
				await actualizacion(cAdmin, 'zonas', 'id', zonaTmp, { nombre: 'Zona temporal 2' }),
				'admin UPDATE zonas'
			);
			esperaPermitido(await eliminacion(cAdmin, 'zonas', 'id', zonaTmp), 'admin DELETE zonas');
		});

		test('admin: UPDATE directo negado (RPCs), DELETE por SQL permitido (RLS admin)', async () => {
			const cAdmin = clienteComo(admin.token);
			const pTmp = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});
			// Fase 8: las transiciones de estado van por RPCs (transicionar_pedido);
			// el UPDATE directo está revocado para todos los roles.
			esperaDenegado(
				await actualizacion(cAdmin, 'pedidos', 'id', pTmp.id, { estado: 'cancelado' }),
				'admin UPDATE pedido.estado'
			);
			// Excepción del hardening: DELETE por SQL queda habilitado para
			// authenticated y la política pedidos_admin_delete (es_admin())
			// restringe el borrado a administradores.
			esperaPermitido(await eliminacion(cAdmin, 'pedidos', 'id', pTmp.id), 'admin DELETE pedido');
		});
	});
});
