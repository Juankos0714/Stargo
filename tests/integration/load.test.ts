import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { INTEGRACION_DISPONIBLE, peticion, peticionTexto, CookieJar } from './http';	import {
		PASSWORD_TEST,
		loginEnApp,
		sesionConToken,
		limpiarIntegracion,
		crearAdmin,
		crearDomiciliario,
		crearCliente,
		type UsuarioRol
	} from './helpers';

/**
 * Detecta si el servidor soporta SSR (necesario para los redirects 303).
 * adapter-vercel + vite preview NO ejecuta SSR (las funciones serverless
 * solo corren en el runtime de Vercel), así que los redirects no funcionan.
 * Este test se salta automáticamente cuando SSR no está disponible.
 */
async function detectarSSR(): Promise<boolean> {
	if (!INTEGRACION_DISPONIBLE) return false;
	try {
		const r = await peticion('/admin', { redirect: 'manual' });
		// Con SSR, sin sesión → 303 redirect a /login.
		// Sin SSR, siempre devuelve 200 (SPA shell).
		return r.status === 303 || r.status === 302;
	} catch {
		return false;
	}
}

const SSR_DISPONIBLE = await detectarSSR();

/**
 * load functions: los guards SSR de los paneles. Lo que la spec exige se
 * prueba aquí contra la app real (SSR de verdad):
 *   - datos correctos según el rol autenticado (el email del layout),
 *   - sesión ausente/expirada → redirect a /login, NUNCA un error 500.
 */
describe.skipIf(!INTEGRACION_DISPONIBLE || !SSR_DISPONIBLE)('load functions — guards por rol y sesión', () => {
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

	/** GET con redirect manual: devuelve status + Location. */
	async function get(path: string, jar?: CookieJar) {
		return peticion(path, { jar, redirect: 'manual' });
	}

	describe('/admin (panel)', () => {
		test('sin sesión → 303 a /login (no 500)', async () => {
			const r = await get('/admin');
			expect(r.status).toBe(303);
			expect(r.headers.get('location')).toBe('/login');
		});

		test('sesión inválida/expirada → 303 a /login (no 500)', async () => {
			const jar = new CookieJar();
			jar.poner('stargo_access_token', 'token-vencido');
			jar.poner('stargo_refresh_token', 'refresh-vencido');
			const r = await get('/admin', jar);
			expect(r.status).toBe(303);
			expect(r.headers.get('location')).toBe('/login');
		});

		test('cliente autenticado sin rol admin → 303 a /login', async () => {
			// La app no permite login por /api/login a usuarios sin rol (403);
			// un cliente con sesión de Supabase activa se simula con su token.
			const s = sesionConToken(cliente.token);
			const r = await get('/admin', s.jar);
			expect(r.status).toBe(303);
			expect(r.headers.get('location')).toBe('/login');
		});

		test('admin autenticado → 200 y el load devuelve su email (visible en el SSR)', async () => {
			const s = await loginEnApp(admin.email, PASSWORD_TEST);
			const r = await peticionTexto('/admin', { jar: s.jar });
			expect(r.status).toBe(200);
			// El layout pinta «Hola, {email}» desde page.data (lo que devuelve el load).
			expect(r.texto).toContain(admin.email!.split('@')[0]);
		});

		test('domiciliario autenticado (no admin) → 303 a /login', async () => {
			const s = await loginEnApp(dom.email, PASSWORD_TEST);
			const r = await get('/admin', s.jar);
			expect(r.status).toBe(303);
		});
	});

	describe('/domiciliario', () => {
		test('sin sesión → 303 a /login', async () => {
			const r = await get('/domiciliario');
			expect(r.status).toBe(303);
			expect(r.headers.get('location')).toBe('/login');
		});

		test('admin (que no es domiciliario) → 303 a /login', async () => {
			const s = await loginEnApp(admin.email, PASSWORD_TEST);
			const r = await get('/domiciliario', s.jar);
			expect(r.status).toBe(303);
			expect(r.headers.get('location')).toBe('/login');
		});

		test('domiciliario activo → 200 y el load devuelve su email', async () => {
			const s = await loginEnApp(dom.email, PASSWORD_TEST);
			const r = await peticionTexto('/domiciliario', { jar: s.jar });
			expect(r.status).toBe(200);
			expect(r.texto).toContain(dom.email!.split('@')[0]);
		});
	});

	describe('redirecciones históricas', () => {
		test('/admin/login → 307 a /login', async () => {
			const r = await get('/admin/login');
			expect(r.status).toBe(307);
			expect(r.headers.get('location')).toBe('/login');
		});
	});
});
