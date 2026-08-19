import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import {
	RLS_DISPONIBLE,
	clienteAnon,
	clienteService,
	clienteComo,
	crearAdmin,
	crearDomiciliario,
	crearCliente,
	seleccion,
	insercion,
	actualizacion,
	eliminacion,
	esperaPermitido,
	esperaDenegado,
	esperaVacio,
	limpiarTodo,
	type UsuarioRol
} from './helpers';

/**
 * RLS de push_subscriptions (Fase 15 + 20 — Web Push y push nativo).
 *
 * Cada usuario solo puede leer/escribir sus propias suscripciones.
 * La tabla almacena tanto suscripciones Web Push (endpoint/p256dh/auth)
 * como tokens nativos FCM (token/plataforma).
 *
 * Matriz esperada:
 *   - admin: lee/escribe solo las suyas.
 *   - domiciliario: lee/escribe solo las suyas.
 *   - cliente (sin rol): 0 filas (denegación silenciosa).
 *   - anon: denegado (error explícito).
 */
describe.skipIf(!RLS_DISPONIBLE)('RLS de push_subscriptions', () => {
	let servicio: ReturnType<typeof clienteService>;
	let anon: ReturnType<typeof clienteAnon>;
	let admin: UsuarioRol;
	let domA: UsuarioRol & { domiciliarioId: string };
	let domB: UsuarioRol & { domiciliarioId: string };
	let cliente: UsuarioRol;

	beforeAll(async () => {
		servicio = clienteService();
		anon = clienteAnon();
		admin = await crearAdmin();
		domA = await crearDomiciliario();
		domB = await crearDomiciliario();
		cliente = await crearCliente();

		// Siembra suscripciones de prueba para cada usuario.
		await servicio.from('push_subscriptions').insert([
			{
				usuario_id: admin.userId,
				endpoint: 'https://fcm.googleapis.com/test-admin',
				p256dh: 'admin-p256dh',
				auth: 'admin-auth'
			},
			{
				usuario_id: domA.userId,
				endpoint: 'https://fcm.googleapis.com/test-domA',
				p256dh: 'domA-p256dh',
				auth: 'domA-auth'
			},
			{
				usuario_id: domB.userId,
				endpoint: 'https://fcm.googleapis.com/test-domB',
				p256dh: 'domB-p256dh',
				auth: 'domB-auth'
			}
		]);
	});

	afterAll(async () => {
		await limpiarTodo();
		// Limpia suscripciones de prueba.
		await servicio.from('push_subscriptions').delete().like('endpoint', 'https://fcm.googleapis.com/test-%');
	});

	describe('cada usuario solo lee sus propias suscripciones', () => {
		test('admin ve solo su suscripción', async () => {
			const r = await seleccion(clienteComo(admin.token), 'push_subscriptions');
			esperaPermitido(r, 'admin SELECT push_subscriptions');
			expect(r.filas).toBe(1);
		});

		test('domiciliario A ve solo la suya', async () => {
			const r = await seleccion(clienteComo(domA.token), 'push_subscriptions');
			esperaPermitido(r, 'domA SELECT push_subscriptions');
			expect(r.filas).toBe(1);
		});

		test('domiciliario B ve solo la suya', async () => {
			const r = await seleccion(clienteComo(domB.token), 'push_subscriptions');
			esperaPermitido(r, 'domB SELECT push_subscriptions');
			expect(r.filas).toBe(1);
		});

		test('cliente (sin rol) ve 0 suscripciones', async () => {
			esperaVacio(
				await seleccion(clienteComo(cliente.token), 'push_subscriptions'),
				'cliente SELECT push_subscriptions'
			);
		});

		test('anon NO puede leer push_subscriptions (denegado)', async () => {
			esperaDenegado(await seleccion(anon, 'push_subscriptions'), 'anon SELECT push_subscriptions');
		});
	});

	describe('cada usuario solo escribe sus propias suscripciones', () => {
		test('admin puede INSERT su propia suscripción', async () => {
			const r = await insercion(clienteComo(admin.token), 'push_subscriptions', {
				usuario_id: admin.userId,
				endpoint: 'https://fcm.googleapis.com/test-admin-nueva',
				p256dh: 'nueva-p256dh',
				auth: 'nueva-auth'
			});
			esperaPermitido(r, 'admin INSERT push_subscriptions');
			// Limpia la suscripción creada.
			await servicio
				.from('push_subscriptions')
				.delete()
				.eq('endpoint', 'https://fcm.googleapis.com/test-admin-nueva');
		});

		test('domiciliario A puede INSERT su propia suscripción', async () => {
			const r = await insercion(clienteComo(domA.token), 'push_subscriptions', {
				usuario_id: domA.userId,
				endpoint: 'https://fcm.googleapis.com/test-domA-nueva',
				p256dh: 'nueva-p256dh',
				auth: 'nueva-auth'
			});
			esperaPermitido(r, 'domA INSERT push_subscriptions');
			await servicio
				.from('push_subscriptions')
				.delete()
				.eq('endpoint', 'https://fcm.googleapis.com/test-domA-nueva');
		});

		test('domiciliario A NO puede INSERT una suscripción de domB', async () => {
			const r = await insercion(clienteComo(domA.token), 'push_subscriptions', {
				usuario_id: domB.userId,
				endpoint: 'https://fcm.googleapis.com/test-hack',
				p256dh: 'hack-p256dh',
				auth: 'hack-auth'
			});
			// RLS deniega: usuario_id != auth.uid()
			esperaDenegado(r, 'domA INSERT push_subscriptions de domB');
		});

		test('cliente (sin rol) NO puede INSERT push_subscriptions', async () => {
			const r = await insercion(clienteComo(cliente.token), 'push_subscriptions', {
				usuario_id: cliente.userId,
				endpoint: 'https://fcm.googleapis.com/test-cliente',
				p256dh: 'cli-p256dh',
				auth: 'cli-auth'
			});
			esperaDenegado(r, 'cliente INSERT push_subscriptions');
		});

		test('anon NO puede INSERT push_subscriptions', async () => {
			const r = await insercion(anon, 'push_subscriptions', {
				usuario_id: '00000000-0000-0000-0000-000000000000',
				endpoint: 'https://fcm.googleapis.com/test-anon',
				p256dh: 'anon-p256dh',
				auth: 'anon-auth'
			});
			esperaDenegado(r, 'anon INSERT push_subscriptions');
		});
	});

	describe('cada usuario solo borra sus propias suscripciones', () => {
		test('admin puede DELETE su propia suscripción', async () => {
			// Primero crea una temporal.
			await insercion(clienteComo(admin.token), 'push_subscriptions', {
				usuario_id: admin.userId,
				endpoint: 'https://fcm.googleapis.com/test-admin-delete',
				p256dh: 'del-p256dh',
				auth: 'del-auth'
			});
			const r = await eliminacion(
				clienteComo(admin.token),
				'push_subscriptions',
				'endpoint',
				'https://fcm.googleapis.com/test-admin-delete'
			);
			esperaPermitido(r, 'admin DELETE push_subscriptions propio');
		});

		test('domiciliario A NO puede DELETE la suscripción de domB', async () => {
			const r = await eliminacion(
				clienteComo(domA.token),
				'push_subscriptions',
				'endpoint',
				'https://fcm.googleapis.com/test-domB'
			);
			// RLS deniega: usuario_id != auth.uid()
			esperaDenegado(r, 'domA DELETE push_subscriptions de domB');
		});
	});
});
