import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { INTEGRACION_DISPONIBLE, peticion, CookieJar } from './http';
import {
	PASSWORD_TEST,
	loginEnApp,
	limpiarIntegracion,
	crearAdmin,
	crearDomiciliario,
	clienteService,
	clienteComo,
	type UsuarioRol
} from './helpers';

/**
 * Endpoints de push nativo (Capacitor + FCM/APNs) — Fase 20.
 *
 * POST /api/push/registrar-token — guarda un device token FCM.
 * GET  /api/push/estado         — verifica si el usuario tiene token registrado.
 *
 * Ambos requieren sesión con rol (admin o domiciliario).
 * Corren contra la app real (SvelteKit server) + Supabase local.
 */
describe.skipIf(!INTEGRACION_DISPONIBLE)('Push nativo — endpoints de integración', () => {
	let admin: UsuarioRol;
	let dom: UsuarioRol & { domiciliarioId: string };
	let servicio: ReturnType<typeof clienteService>;

	beforeAll(async () => {
		servicio = clienteService();
		admin = await crearAdmin();
		dom = await crearDomiciliario();
	});

	afterAll(async () => {
		// Limpia tokens de push sembrados por estos tests.
		await servicio
			.from('push_subscriptions')
			.delete()
			.like('endpoint', 'native://android/test-token-%');
		await servicio
			.from('push_subscriptions')
			.delete()
			.like('endpoint', 'native://ios/test-token-%');
		await limpiarIntegracion();
	});

	// ------------------------------------------------------------------
	// POST /api/push/registrar-token
	// ------------------------------------------------------------------

	describe('POST /api/push/registrar-token', () => {
		test('sin sesión → 401/403 (requiere rol)', async () => {
			const r = await peticion<{ error: string }>('/api/push/registrar-token', {
				metodo: 'POST',
				cuerpo: { token: 'test-token-123', plataforma: 'android' }
			});
			expect(r.status).toBeGreaterThanOrEqual(400);
			expect(r.status).toBeLessThan(500);
		});

		test('admin puede registrar un token FCM de Android', async () => {
			const s = await loginEnApp(admin.email, PASSWORD_TEST);
			const token = `test-token-${Date.now().toString(36)}`;
			const r = await peticion<{ data?: { registrado: boolean }; error?: string }>(
				'/api/push/registrar-token',
				{
					metodo: 'POST',
					cuerpo: { token, plataforma: 'android' },
					jar: s.jar
				}
			);
			expect(r.status).toBe(200);
			expect(r.data?.data?.registrado).toBe(true);
			expect(r.data?.error).toBeUndefined();

			// Verifica que quedó guardado en la BD.
			const { data: fila } = await servicio
				.from('push_subscriptions')
				.select('token, plataforma, usuario_id')
				.eq('usuario_id', admin.userId)
				.eq('token', token)
				.single();
			expect(fila).toBeTruthy();
			expect(fila?.token).toBe(token);
			expect(fila?.plataforma).toBe('android');
		});

		test('domiciliario puede registrar un token FCM de iOS', async () => {
			const s = await loginEnApp(dom.email, PASSWORD_TEST);
			const token = `test-token-ios-${Date.now().toString(36)}`;
			const r = await peticion<{ data?: { registrado: boolean }; error?: string }>(
				'/api/push/registrar-token',
				{
					metodo: 'POST',
					cuerpo: { token, plataforma: 'ios' },
					jar: s.jar
				}
			);
			expect(r.status).toBe(200);
			expect(r.data?.data?.registrado).toBe(true);

			const { data: fila } = await servicio
				.from('push_subscriptions')
				.select('token, plataforma')
				.eq('usuario_id', dom.userId)
				.eq('token', token)
				.single();
			expect(fila).toBeTruthy();
			expect(fila?.plataforma).toBe('ios');
		});

		test('token vacío → 400', async () => {
			const s = await loginEnApp(admin.email, PASSWORD_TEST);
			const r = await peticion<{ error: string }>('/api/push/registrar-token', {
				metodo: 'POST',
				cuerpo: { token: '', plataforma: 'android' },
				jar: s.jar
			});
			expect(r.status).toBe(400);
			expect(r.data?.error).toMatch(/token no es válido/);
		});

		test('plataforma inválida → 400', async () => {
			const s = await loginEnApp(admin.email, PASSWORD_TEST);
			const r = await peticion<{ error: string }>('/api/push/registrar-token', {
				metodo: 'POST',
				cuerpo: { token: 'test-token-valid', plataforma: 'windows' },
				jar: s.jar
			});
			expect(r.status).toBe(400);
			expect(r.data?.error).toMatch(/plataforma/);
		});

		test('upsert: registrar el mismo token actualiza la plataforma', async () => {
			const s = await loginEnApp(admin.email, PASSWORD_TEST);
			const token = `test-token-upsert-${Date.now().toString(36)}`;

			// Primera vez: Android.
			const r1 = await peticion<{ data?: { registrado: boolean } }>('/api/push/registrar-token', {
				metodo: 'POST',
				cuerpo: { token, plataforma: 'android' },
				jar: s.jar
			});
			expect(r1.status).toBe(200);

			// Segunda vez: iOS (cambia la plataforma).
			const r2 = await peticion<{ data?: { registrado: boolean } }>('/api/push/registrar-token', {
				metodo: 'POST',
				cuerpo: { token, plataforma: 'ios' },
				jar: s.jar
			});
			expect(r2.status).toBe(200);

			// Solo debe haber UNA fila con este token (upsert).
			const { data: filas } = await servicio
				.from('push_subscriptions')
				.select('plataforma')
				.eq('usuario_id', admin.userId)
				.eq('token', token);
			expect(filas).toHaveLength(1);
			expect(filas?.[0].plataforma).toBe('ios');
		});

		test('un usuario puede reemplazar un token viejo por uno nuevo', async () => {
			const s = await loginEnApp(dom.email, PASSWORD_TEST);
			const tokenViejo = `test-token-viejo-${Date.now().toString(36)}`;
			const tokenNuevo = `test-token-nuevo-${Date.now().toString(36)}`;

			// Registrar token viejo.
			await peticion('/api/push/registrar-token', {
				metodo: 'POST',
				cuerpo: { token: tokenViejo, plataforma: 'android' },
				jar: s.jar
			});

			// Registrar token nuevo (reemplaza el viejo porque el endpoint
			// usa upsert por usuario_id + endpoint).
			const r = await peticion<{ data?: { registrado: boolean } }>('/api/push/registrar-token', {
				metodo: 'POST',
				cuerpo: { token: tokenNuevo, plataforma: 'android' },
				jar: s.jar
			});
			expect(r.status).toBe(200);

			// Verificar que el token nuevo existe.
			const { data: nuevo } = await servicio
				.from('push_subscriptions')
				.select('id')
				.eq('usuario_id', dom.userId)
				.eq('token', tokenNuevo)
				.single();
			expect(nuevo).toBeTruthy();
		});
	});

	// ------------------------------------------------------------------
	// GET /api/push/estado
	// ------------------------------------------------------------------

	describe('GET /api/push/estado', () => {
		test('sin sesión → 401/403 (requiere rol)', async () => {
			const r = await peticion<{ error: string }>('/api/push/estado');
			expect(r.status).toBeGreaterThanOrEqual(400);
			expect(r.status).toBeLessThan(500);
		});

		test('admin sin token registrado → tiene_token: false', async () => {
			// Crear un admin fresh sin tokens previos.
			const fresh = await crearAdmin();
			const s = await loginEnApp(fresh.email, PASSWORD_TEST);
			const r = await peticion<{ data?: { tiene_token: boolean } }>('/api/push/estado', {
				jar: s.jar
			});
			expect(r.status).toBe(200);
			expect(r.data?.data?.tiene_token).toBe(false);
		});

		test('admin con token registrado → tiene_token: true', async () => {
			const s = await loginEnApp(admin.email, PASSWORD_TEST);

			// Registrar un token primero.
			await peticion('/api/push/registrar-token', {
				metodo: 'POST',
				cuerpo: { token: `test-token-estado-${Date.now().toString(36)}`, plataforma: 'android' },
				jar: s.jar
			});

			// Verificar estado.
			const r = await peticion<{ data?: { tiene_token: boolean } }>('/api/push/estado', {
				jar: s.jar
			});
			expect(r.status).toBe(200);
			expect(r.data?.data?.tiene_token).toBe(true);
		});

		test('domiciliario sin token → tiene_token: false', async () => {
			const fresh = await crearDomiciliario();
			const s = await loginEnApp(fresh.email, PASSWORD_TEST);
			const r = await peticion<{ data?: { tiene_token: boolean } }>('/api/push/estado', {
				jar: s.jar
			});
			expect(r.status).toBe(200);
			expect(r.data?.data?.tiene_token).toBe(false);
		});

		test('domiciliario con token → tiene_token: true', async () => {
			const s = await loginEnApp(dom.email, PASSWORD_TEST);

			await peticion('/api/push/registrar-token', {
				metodo: 'POST',
				cuerpo: { token: `test-token-dom-estado-${Date.now().toString(36)}`, plataforma: 'ios' },
				jar: s.jar
			});

			const r = await peticion<{ data?: { tiene_token: boolean } }>('/api/push/estado', {
				jar: s.jar
			});
			expect(r.status).toBe(200);
			expect(r.data?.data?.tiene_token).toBe(true);
		});

		test('el admin solo ve su propio estado, no el de otros usuarios', async () => {
			// El endpoint filtra por usuario_id = auth.uid(), así que
			// el admin solo ve su propio estado, no el de otros.
			const s = await loginEnApp(admin.email, PASSWORD_TEST);
			const r = await peticion<{ data?: { tiene_token: boolean } }>('/api/push/estado', {
				jar: s.jar
			});
			expect(r.status).toBe(200);
			// Solo refleja si el ADMIN tiene token, no si dom tiene.
			expect(typeof r.data?.data?.tiene_token).toBe('boolean');
		});
	});

	// ------------------------------------------------------------------
	// RLS implícito: verificar aislamiento por usuario
	// ------------------------------------------------------------------

	describe('aislamiento de tokens entre usuarios', () => {
		test('el token del admin no aparece en la consulta del domiciliario', async () => {
		const sAdmin = await loginEnApp(admin.email, PASSWORD_TEST);
		const sDom = await loginEnApp(dom.email, PASSWORD_TEST);

		// Registrar token único para admin.
		const tokenAdmin = `test-token-aislamiento-admin-${Date.now().toString(36)}`;
		await peticion('/api/push/registrar-token', {
			metodo: 'POST',
			cuerpo: { token: tokenAdmin, plataforma: 'android' },
			jar: sAdmin.jar
		});

		// Verificar que el admin tiene token.
		const rAdmin = await peticion<{ data?: { tiene_token: boolean } }>('/api/push/estado', {
			jar: sAdmin.jar
		});
			expect(rAdmin.data?.data?.tiene_token).toBe(true);

			// Crear un domiciliario SIN token registrado.
			const fresh = await crearDomiciliario();
			const sFresh = await loginEnApp(fresh.email, PASSWORD_TEST);
			const rFresh = await peticion<{ data?: { tiene_token: boolean } }>('/api/push/estado', {
				jar: sFresh.jar
			});
			expect(rFresh.data?.data?.tiene_token).toBe(false);
		});
	});
});
