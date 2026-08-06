import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { INTEGRACION_DISPONIBLE, peticion, CookieJar } from './http';
import {
	PASSWORD_TEST,
	loginEnApp,
	limpiarIntegracion,
	crearAdmin,
	crearDomiciliario,
	crearCliente,
	clienteComo,
	type UsuarioRol
} from './helpers';

/**
 * Sesión y sincronización cliente ↔ servidor (SvelteKit SSR + Supabase Auth
 * con cookies httpOnly). Estos tests pasan por el flujo real de la app:
 * login → cookies → cada request autenticado con ellas; cubre el caso
 * clásico de bugs sutiles (sesión válida en cliente pero no reconocida en el
 * servidor o viceversa) sin mocks.
 */
describe.skipIf(!INTEGRACION_DISPONIBLE)('Sesión y sincronización cliente-servidor', () => {
	let admin: UsuarioRol;
	let dom: UsuarioRol & { domiciliarioId: string };
	let cliente: UsuarioRol;

	beforeAll(async () => {
		admin = await crearAdmin();
		dom = await crearDomiciliario();
		cliente = await crearCliente();
	});

	afterAll(async () => {
		await limpiarIntegracion();
	});

	describe('POST /api/login', () => {
		test('admin válido → 200, cookies de sesión httpOnly y roles', async () => {
			const s = await loginEnApp(admin.email, PASSWORD_TEST);
			expect(s.esAdmin).toBe(true);
			expect(s.esDomiciliario).toBe(false);
			// Las cookies de sesión se emiten como httpOnly (el navegador no
			// las puede leer con JS: la sesión vive en el servidor).
			expect(s.jar.get('stargo_access_token')).toBeTruthy();
			expect(s.jar.get('stargo_refresh_token')).toBeTruthy();
		});

		test('credenciales inválidas → 401 con mensaje claro (no 500)', async () => {
			const r = await peticion<{ error: string }>('/api/login', {
				metodo: 'POST',
				cuerpo: { email: admin.email, password: 'contraseña-mal' }
			});
			expect(r.status).toBe(401);
			expect(r.data?.error).toBeTruthy();
		});

		test('campos vacíos → 400 (valida antes de tocar Supabase)', async () => {
			const r = await peticion<{ error: string }>('/api/login', {
				metodo: 'POST',
				cuerpo: { email: '', password: '' }
			});
			expect(r.status).toBe(400);
			expect(r.data?.error).toMatch(/Faltan email o password/);
		});

		test('usuario sin rol registrado → 403 y sin cookies de sesión', async () => {
			const jar = new CookieJar();
			const r = await peticion<{ error: string }>('/api/login', {
				metodo: 'POST',
				cuerpo: { email: cliente.email, password: PASSWORD_TEST },
				jar
			});
			expect(r.status).toBe(403);
			expect(r.data?.error).toMatch(/no está registrado como administrador ni domiciliario/);
			expect(jar.header()).toBe('');
		});
	});

	describe('GET /api/sesion — datos correctos según el rol', () => {
		test('anónimo → 200 con {data:null} (no un 401 que rompa la consola)', async () => {
			const r = await peticion('/api/sesion');
			expect(r.status).toBe(200);
			expect(r.data).toEqual({ data: null });
		});

		test('admin → roles y tokens propios', async () => {
			const s = await loginEnApp(admin.email, PASSWORD_TEST);
			const r = await peticion<{
				data: { email: string; esAdmin: boolean; esDomiciliario: boolean; access_token: string; refresh_token: string };
			}>('/api/sesion', { jar: s.jar });
			expect(r.status).toBe(200);
			expect(r.data?.data.email).toBe(admin.email);
			expect(r.data?.data.esAdmin).toBe(true);
			expect(r.data?.data.esDomiciliario).toBe(false);
			expect(r.data?.data.access_token).toBeTruthy();
		});

		test('domiciliario → esDomiciliario true', async () => {
			const s = await loginEnApp(dom.email, PASSWORD_TEST);
			const r = await peticion<{
				data: { email: string; esAdmin: boolean; esDomiciliario: boolean };
			}>('/api/sesion', { jar: s.jar });
			expect(r.status).toBe(200);
			expect(r.data?.data.email).toBe(dom.email);
			expect(r.data?.data.esDomiciliario).toBe(true);
			expect(r.data?.data.esAdmin).toBe(false);
		});
	});

	describe('Sincronización de sesión (SSR + cookies)', () => {
		test('access token corrupto + refresh válido → el servidor renueva la sesión y re-emite cookies', async () => {
			const s = await loginEnApp(admin.email, PASSWORD_TEST);
			const tokenOriginal = s.jar.get('stargo_access_token')!;
			// Simula un access token expirado/inválido en el cliente.
			s.jar.poner('stargo_access_token', 'corrupto');

			const r = await peticion<{ data: { email: string; esAdmin: boolean } }>('/api/sesion', { jar: s.jar });
			expect(r.status).toBe(200);
			expect(r.data?.data.email).toBe(admin.email);
			// La sesión fue renovada: el servidor re-emitió una access token nueva.
			const nueva = s.jar.get('stargo_access_token');
			expect(nueva).toBeTruthy();
			expect(nueva).not.toBe('corrupto');
			expect(nueva).not.toBe(tokenOriginal);

			// Con la sesión renovada, la siguiente petición sigue autenticada.
			const r2 = await peticion<{ data: { email: string } }>('/api/sesion', { jar: s.jar });
			expect(r2.data?.data.email).toBe(admin.email);
		});

		test('sesión inválida (ambas cookies corruptas) → {data:null}, sin 500', async () => {
			const s = await loginEnApp(admin.email, PASSWORD_TEST);
			s.jar.poner('stargo_access_token', 'corrupto');
			s.jar.poner('stargo_refresh_token', 'corrupto');
			const r = await peticion('/api/sesion', { jar: s.jar });
			expect(r.status).toBe(200);
			expect(r.data).toEqual({ data: null });
		});

		test('logout → limpia cookies y el servidor deja de reconocer la sesión', async () => {
			const s = await loginEnApp(admin.email, PASSWORD_TEST);
			expect((await peticion<{ data: { email: string } }>('/api/sesion', { jar: s.jar })).data?.data.email).toBe(
				admin.email
			);
			const r = await peticion('/api/salir', { metodo: 'POST', jar: s.jar });
			expect(r.status).toBe(200);
			expect(s.jar.header()).toBe('');
			const tras = await peticion('/api/sesion', { jar: s.jar });
			expect(tras.data).toEqual({ data: null });
		});

		test('los tokens que el servidor expone se hidratan en el cliente supabase-js (misma sesión en ambos lados)', async () => {
			const s = await loginEnApp(dom.email, PASSWORD_TEST);
			const r = await peticion<{
				data: { access_token: string; refresh_token: string };
			}>('/api/sesion', { jar: s.jar });
			const { access_token, refresh_token } = r.data!.data;

			// Esto es exactamente lo que hace supabase-browser.ts (setSession)
			// para suscribirse a Realtime con el JWT del usuario.
			const cliente = clienteComo(access_token);
			const { data: filas, error } = await cliente
				.from('domiciliarios')
				.select('id, activo')
				.eq('id', dom.domiciliarioId);
			expect(error).toBeNull();
			expect(filas).toHaveLength(1);
			expect(filas![0].id).toBe(dom.domiciliarioId);

			// El refresh token también es válido para renovar del lado del cliente.
			const { data: renovada, error: errRen } = await cliente.auth.refreshSession({
				refresh_token
			});
			expect(errRen).toBeNull();
			expect(renovada.session).toBeTruthy();
		});
	});
});
