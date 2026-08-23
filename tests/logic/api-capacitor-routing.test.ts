import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests de api.ts — enrutamiento CapacitorHttp vs fetch.
 *
 * En Capacitor, las peticiones HTTP deben usar CapacitorHttp (bypasses
 * WebView fetch issues). En web, se usa fetch normal.
 *
 * Verifica:
 *  - apiUrl() resuelve URLs correctamente en ambos entornos
 *  - request() usa CapacitorHttp en Capacitor, fetch en web
 *  - apiFetch() usa CapacitorHttp en Capacitor, fetch en web
 *  - buildCookieHeader() se inyecta en requests de Capacitor
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

let nativePlatform = false;

vi.mock('@capacitor/core', () => ({
	get Capacitor() {
		return {
			isNativePlatform: () => nativePlatform,
			getPlatform: () => (nativePlatform ? 'android' : 'web')
		};
	},
	CapacitorHttp: {
		request: vi.fn()
	}
}));

vi.mock('$lib/capacitor-auth', () => ({
	esCapacitor: () => nativePlatform,
	buildCookieHeader: () => (nativePlatform ? 'stargo_access_token=test-at; stargo_refresh_token=test-rt' : ''),
	getStoredSession: () => (nativePlatform ? { accessToken: 'test-at', refreshToken: 'test-rt' } : null),
	storeSession: vi.fn(),
	clearSession: vi.fn()
}));

// Importar después de mocks
import { api, apiFetch } from '$lib/api';
import { CapacitorHttp } from '@capacitor/core';

beforeEach(() => {
	nativePlatform = false;
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// ── api.post ────────────────────────────────────────────────────────────────

describe('api.post — routing por plataforma', () => {
	test('web: usa fetch con Content-Type JSON', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ data: { suscrito: true } })
			}))
		);

		const result = await api.post('/api/push/suscribir', { endpoint: 'test' });

		expect(result.data?.suscrito).toBe(true);
		expect(fetch).toHaveBeenCalledWith(
			'/api/push/suscribir',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({ 'Content-Type': 'application/json' })
			})
		);
	});

	test('Capacitor: usa CapacitorHttp con Cookie header', async () => {
		nativePlatform = true;
		(CapacitorHttp.request as ReturnType<typeof vi.fn>).mockResolvedValue({
			status: 200,
			data: { data: { suscrito: true } },
			headers: {}
		});

		const result = await api.post('/api/push/suscribir', { endpoint: 'test' });

		expect(result.data?.suscrito).toBe(true);
		expect(CapacitorHttp.request).toHaveBeenCalledWith(
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					'Cookie': 'stargo_access_token=test-at; stargo_refresh_token=test-rt'
				})
			})
		);
	});
});

// ── api.get ─────────────────────────────────────────────────────────────────

describe('api.get — routing por plataforma', () => {
	test('web: usa fetch GET', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ data: { tiene_token: true } })
			}))
		);

		const result = await api.get('/api/push/estado');

		expect(result.data?.tiene_token).toBe(true);
		expect(fetch).toHaveBeenCalledWith(
			'/api/push/estado',
			expect.objectContaining({
				headers: expect.objectContaining({ 'Content-Type': 'application/json' })
			})
		);
	});

	test('Capacitor: usa CapacitorHttp GET', async () => {
		nativePlatform = true;
		(CapacitorHttp.request as ReturnType<typeof vi.fn>).mockResolvedValue({
			status: 200,
			data: { data: { tiene_token: true } },
			headers: {}
		});

		const result = await api.get('/api/push/estado');

		expect(result.data?.tiene_token).toBe(true);
		expect(CapacitorHttp.request).toHaveBeenCalledWith(
			expect.objectContaining({ method: 'GET' })
		);
	});
});

// ── apiFetch ─────────────────────────────────────────────────────────────────

describe('apiFetch — routing por plataforma', () => {
	test('web: retorna Response de fetch', async () => {
		const fakeResponse = new Response('{"ok":true}', { status: 200 });
		vi.stubGlobal('fetch', vi.fn(async () => fakeResponse));

		const result = await apiFetch('/api/pedidos');

		expect(result).toBe(fakeResponse);
		expect(fetch).toHaveBeenCalledWith('/api/pedidos', expect.anything());
	});

	test('Capacitor: retorna Response-like de CapacitorHttp', async () => {
		nativePlatform = true;
		(CapacitorHttp.request as ReturnType<typeof vi.fn>).mockResolvedValue({
			status: 200,
			data: [{ id: 1 }],
			headers: { 'content-type': 'application/json' }
		});

		const result = await apiFetch('/api/pedidos');

		expect(result.status).toBe(200);
		expect(result).toBeInstanceOf(Response);
		const body = await result.json();
		expect(body).toEqual([{ id: 1 }]);
	});

	test('Capacitor: inyecta Cookie header en apiFetch', async () => {
		nativePlatform = true;
		(CapacitorHttp.request as ReturnType<typeof vi.fn>).mockResolvedValue({
			status: 200,
			data: '{}',
			headers: {}
		});

		await apiFetch('/api/sesion');

		expect(CapacitorHttp.request).toHaveBeenCalledWith(
			expect.objectContaining({
				headers: expect.objectContaining({
					'Cookie': 'stargo_access_token=test-at; stargo_refresh_token=test-rt'
				})
			})
		);
	});
});

// ── Resolución de URLs ──────────────────────────────────────────────────────

describe('URL resolution — rutas absolutas vs relativas', () => {
	test('URL absoluta se usa tal cual', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ data: null })
			}))
		);

		await api.get('https://external-api.com/data');

		expect(fetch).toHaveBeenCalledWith(
			'https://external-api.com/data',
			expect.anything()
		);
	});

	test('Capacitor: ruta relativa se resuelve con CAPACITOR_API_BASE', async () => {
		nativePlatform = true;
		(CapacitorHttp.request as ReturnType<typeof vi.fn>).mockResolvedValue({
			status: 200,
			data: { data: null },
			headers: {}
		});

		await api.get('/api/push/estado');

		expect(CapacitorHttp.request).toHaveBeenCalledWith(
			expect.objectContaining({
				url: 'https://stargo-zeta.vercel.app/api/push/estado'
			})
		);
	});
});

// ── Manejo de errores ──────────────────────────────────────────────────────

describe('Error handling — responses de error', () => {
	test('web: error HTTP retorna { data: null, error }', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: false,
				json: async () => ({ error: 'No autenticado' })
			}))
		);

		const result = await api.get('/api/push/estado');

		expect(result.data).toBeNull();
		expect(result.error).toBe('No autenticado');
	});

	test('Capacitor: error HTTP retorna { data: null, error }', async () => {
		nativePlatform = true;
		(CapacitorHttp.request as ReturnType<typeof vi.fn>).mockResolvedValue({
			status: 401,
			data: { error: 'No autenticado' },
			headers: {}
		});

		const result = await api.get('/api/push/estado');

		expect(result.data).toBeNull();
		expect(result.error).toBe('No autenticado');
	});

	test('web: fetch falla por red → error', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network error'); }));

		const result = await api.get('/api/push/estado');

		expect(result.data).toBeNull();
		expect(result.error).toBe('Network error');
	});
});
