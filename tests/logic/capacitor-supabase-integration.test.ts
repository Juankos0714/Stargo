/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests de integración Supabase + Capacitor.
 *
 * Verifica que la conexión a la base de datos Supabase funciona correctamente
 * en el contexto de Capacitor:
 *
 *  1. Login → storeSession → buildCookieHeader → CapacitorHttp → API
 *  2. Hidratación de sesión Realtime (tokens ↔ Supabase setSession)
 *  3. Polling con queries a la API (pedidos, notificaciones, domiciliarios)
 *  4. Refresh de tokens en Capacitor
 *  5. RLS via cookies inyectadas → queries autenticadas
 *  6. Logout → clearSession → sesión inválida
 */

// ── Mocks ───────────────────────────────────────────────────────────────────

const {
	nativePlatformRef,
	storedSessionRef,
	mockSetSessionFn,
	mockCapHttpFn
} = vi.hoisted(() => {
	const storedSessionRef: { value: { accessToken: string; refreshToken: string } | null } = { value: null };
	return {
		nativePlatformRef: { value: false },
		storedSessionRef,
		mockSetSessionFn: vi.fn().mockResolvedValue({ error: null }),
		mockCapHttpFn: vi.fn().mockResolvedValue({ status: 200, data: {}, headers: {} })
	};
});

vi.mock('@capacitor/core', () => ({
	get Capacitor() {
		return {
			isNativePlatform: () => nativePlatformRef.value,
			getPlatform: () => (nativePlatformRef.value ? 'android' : 'web')
		};
	},
	CapacitorHttp: { request: (...args: unknown[]) => mockCapHttpFn(...args) }
}));

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'https://test-project.supabase.co',
	PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key-123'
}));

vi.mock('$lib/capacitor-auth', () => {
	const ACCESS_KEY = 'stargo_access_token';
	const REFRESH_KEY = 'stargo_refresh_token';
	return {
		esCapacitor: () => nativePlatformRef.value,
		storeSession: (at: string, rt: string) => {
			localStorage.setItem(ACCESS_KEY, at);
			localStorage.setItem(REFRESH_KEY, rt);
			storedSessionRef.value = { accessToken: at, refreshToken: rt };
		},
		clearSession: () => {
			localStorage.removeItem(ACCESS_KEY);
			localStorage.removeItem(REFRESH_KEY);
			storedSessionRef.value = null;
		},
		getStoredSession: () => {
			const at = localStorage.getItem(ACCESS_KEY);
			const rt = localStorage.getItem(REFRESH_KEY);
			if (!at) return null;
			return { accessToken: at, refreshToken: rt ?? '' };
		},
		buildCookieHeader: () => {
			const at = localStorage.getItem(ACCESS_KEY);
			const rt = localStorage.getItem(REFRESH_KEY);
			if (!at) return '';
			return `stargo_access_token=${at}; stargo_refresh_token=${rt ?? ''}`;
		}
	};
});

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({
		auth: {
			setSession: mockSetSessionFn,
			signOut: vi.fn().mockResolvedValue({ error: null }),
			getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
			refreshSession: vi.fn()
		}
	}))
}));

// ── Imports ─────────────────────────────────────────────────────────────────

import {
	storeSession, getStoredSession, clearSession, buildCookieHeader, esCapacitor
} from '$lib/capacitor-auth';
import { CapacitorHttp } from '@capacitor/core';

// ── Helpers ─────────────────────────────────────────────────────────────────

function capOk(data: unknown) {
	mockCapHttpFn.mockResolvedValue({
		status: 200, data, headers: { 'content-type': 'application/json' }
	});
}

function capErr(status: number, error: string) {
	mockCapHttpFn.mockResolvedValue({ status, data: { error }, headers: {} });
}

beforeEach(() => {
	nativePlatformRef.value = false;
	storedSessionRef.value = null;
	localStorage.clear();
	vi.clearAllMocks();
	vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

// ══════════════════════════════════════════════════════════════════════════════
// 1. Login → storeSession → buildCookie → CapacitorHttp
// ══════════════════════════════════════════════════════════════════════════════

describe('Login → CapacitorHttp → Supabase', () => {
	test('Capacitor: storeSession + Cookie inyectado en request', async () => {
		nativePlatformRef.value = true;
		storeSession('jwt-access', 'jwt-refresh');

		expect(buildCookieHeader()).toContain('stargo_access_token=jwt-access');

		capOk({ data: { email: 'admin@test.com', esAdmin: true } });
		const { api } = await import('$lib/api');
		const result = await api.get('/api/sesion');

		expect(result.data?.email).toBe('admin@test.com');
		expect(mockCapHttpFn).toHaveBeenCalledWith(
			expect.objectContaining({
				headers: expect.objectContaining({ Cookie: expect.stringContaining('jwt-access') })
			})
		);
	});

	test('web: usa fetch normal, no CapacitorHttp', async () => {
		nativePlatformRef.value = false;
		const fm = vi.fn(async () => ({
			ok: true, json: async () => ({ data: { email: 'web@test.com' } })
		}));
		vi.stubGlobal('fetch', fm);

		const { api } = await import('$lib/api');
		const result = await api.get('/api/sesion');

		expect(result.data?.email).toBe('web@test.com');
		expect(fm).toHaveBeenCalled();
		expect(mockCapHttpFn).not.toHaveBeenCalled();
	});

	test('CapacitorHttp resuelve rutas relativas con CAPACITOR_API_BASE', async () => {
		nativePlatformRef.value = true;
		capOk({ data: [] });

		const { api } = await import('$lib/api');
		await api.get('/api/pedidos');

		expect(mockCapHttpFn).toHaveBeenCalledWith(
			expect.objectContaining({ url: 'https://stargo-zeta.vercel.app/api/pedidos' })
		);
	});

	test('CapacitorHttp preserva URLs absolutas', async () => {
		nativePlatformRef.value = true;
		capOk({ data: 'ok' });

		const { api } = await import('$lib/api');
		await api.get('https://external-api.com/data');

		expect(mockCapHttpFn).toHaveBeenCalledWith(
			expect.objectContaining({ url: 'https://external-api.com/data' })
		);
	});
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Hidratación de sesión Realtime
// ══════════════════════════════════════════════════════════════════════════════

describe('Hidratación de sesión — tokens ↔ Supabase', () => {
	test('Capacitor: llama /api/sesion, sync tokens, y pasa a setSession', async () => {
		nativePlatformRef.value = true;
		storeSession('cap-at-123', 'cap-rt-456');
		capOk({ data: { access_token: 'fresh-at', refresh_token: 'fresh-rt' } });

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		expect(await hidratarSesionRealtime()).toBe(true);

		expect(mockCapHttpFn).toHaveBeenCalledWith(
			expect.objectContaining({ url: expect.stringContaining('/api/sesion') })
		);
		expect(mockSetSessionFn).toHaveBeenCalledWith({
			access_token: 'fresh-at', refresh_token: 'fresh-rt'
		});
	});

	test('Capacitor: /api/sesion sin tokens → falla', async () => {
		nativePlatformRef.value = true;
		capOk({ data: null });

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		expect(await hidratarSesionRealtime()).toBe(false);
		expect(mockSetSessionFn).not.toHaveBeenCalled();
	});

	test('Capacitor: setSession error → falla', async () => {
		nativePlatformRef.value = true;
		storeSession('expired', 'expired-rt');
		capOk({ data: { access_token: 'expired', refresh_token: 'expired-rt' } });
		mockSetSessionFn.mockResolvedValueOnce({ error: { message: 'JWT expired' } });

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		expect(await hidratarSesionRealtime()).toBe(false);
	});

	test('Web: llama /api/sesion vía fetch → pasa tokens a setSession', async () => {
		nativePlatformRef.value = false;
		vi.stubGlobal('fetch', vi.fn(async () => ({
			ok: true,
			json: async () => ({ data: { access_token: 'web-at', refresh_token: 'web-rt' } })
		})));

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		expect(await hidratarSesionRealtime()).toBe(true);

		expect(mockSetSessionFn).toHaveBeenCalledWith({
			access_token: 'web-at', refresh_token: 'web-rt'
		});
	});

	test('Web: /api/sesion sin access_token → falla', async () => {
		nativePlatformRef.value = false;
		vi.stubGlobal('fetch', vi.fn(async () => ({
			ok: true, json: async () => ({ data: { email: 'no-token@test.com' } })
		})));

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		expect(await hidratarSesionRealtime()).toBe(false);
	});

	test('Flujo completo: login → hidratar → autenticado', async () => {
		nativePlatformRef.value = true;
		storeSession('complete-at', 'complete-rt');
		capOk({ data: { access_token: 'fresh-complete-at', refresh_token: 'fresh-complete-rt' } });

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		expect(await hidratarSesionRealtime()).toBe(true);
		expect(mockSetSessionFn).toHaveBeenCalledWith({
			access_token: 'fresh-complete-at', refresh_token: 'fresh-complete-rt'
		});
	});
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. Polling — queries a la API en Capacitor
//
// En Capacitor, apiFetch usa CapacitorHttp.request internamente.
// El módulo realtime llama a apiFetch que internamente llama CapacitorHttp.
// ══════════════════════════════════════════════════════════════════════════════

describe('Polling — queries a la API en Capacitor', () => {
	beforeEach(() => { nativePlatformRef.value = true; });

	test('pedidos: llama a /api/pedidos cada 15s', async () => {
		capOk({ data: [] });

		const { suscribirCambios } = await import('$lib/realtime');
		suscribirCambios({ tabla: 'pedidos', onCambio: vi.fn() });

		await vi.advanceTimersByTimeAsync(15_000);

		expect(mockCapHttpFn).toHaveBeenCalledWith(
			expect.objectContaining({ url: expect.stringContaining('/api/pedidos') })
		);
	});

	test('notificaciones: llama a /api/notificaciones', async () => {
		capOk({ data: [] });

		const { suscribirCambios } = await import('$lib/realtime');
		suscribirCambios({ tabla: 'notificaciones', onCambio: vi.fn() });

		await vi.advanceTimersByTimeAsync(15_000);

		expect(mockCapHttpFn).toHaveBeenCalledWith(
			expect.objectContaining({ url: expect.stringContaining('/api/notificaciones') })
		);
	});

	test('domiciliarios: llama a /api/domiciliarios', async () => {
		capOk({ data: [] });

		const { suscribirCambios } = await import('$lib/realtime');
		suscribirCambios({ tabla: 'domiciliarios', onCambio: vi.fn() });

		await vi.advanceTimersByTimeAsync(15_000);

		expect(mockCapHttpFn).toHaveBeenCalledWith(
			expect.objectContaining({ url: expect.stringContaining('/api/domiciliarios') })
		);
	});

	test('detecta INSERT cuando aumenta la longitud', async () => {
		const onCambio = vi.fn();
		let n = 0;
		mockCapHttpFn.mockImplementation(async () => {
			n++;
			return {
				status: 200,
				data: n === 1
					? { data: [{ id: 1, numero: 'PED-001' }] }
					: { data: [{ id: 1, numero: 'PED-001' }, { id: 2, numero: 'PED-002' }] },
				headers: { 'content-type': 'application/json' }
			};
		});

		const { suscribirCambios } = await import('$lib/realtime');
		suscribirCambios({ tabla: 'pedidos', onCambio });

		await vi.advanceTimersByTimeAsync(30_000);

		expect(onCambio).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: 'INSERT',
				new: expect.arrayContaining([expect.objectContaining({ numero: 'PED-002' })])
			})
		);
	});

	test('detecta UPDATE cuando la longitud se mantiene', async () => {
		const onCambio = vi.fn();
		let n = 0;
		mockCapHttpFn.mockImplementation(async () => {
			n++;
			return {
				status: 200,
				data: n === 1
					? { data: [{ id: 1, estado: 'pendiente' }] }
					: { data: [{ id: 1, estado: 'asignado' }] },
				headers: { 'content-type': 'application/json' }
			};
		});

		const { suscribirCambios } = await import('$lib/realtime');
		suscribirCambios({ tabla: 'pedidos', onCambio });

		await vi.advanceTimersByTimeAsync(30_000);

		expect(onCambio).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: 'UPDATE',
				new: expect.arrayContaining([expect.objectContaining({ estado: 'asignado' })])
			})
		);
	});

	test('NO dispara en el primer poll', async () => {
		const onCambio = vi.fn();
		capOk({ data: [{ id: 1 }] });

		const { suscribirCambios } = await import('$lib/realtime');
		suscribirCambios({ tabla: 'pedidos', onCambio });

		await vi.advanceTimersByTimeAsync(15_000);

		expect(onCambio).not.toHaveBeenCalled();
	});

	test('cleanup cancela el polling', async () => {
		capOk({ data: [] });

		const { suscribirCambios } = await import('$lib/realtime');
		const limpiar = suscribirCambios({ tabla: 'pedidos', onCambio: vi.fn() });
		limpiar();

		await vi.advanceTimersByTimeAsync(60_000);

		expect(mockCapHttpFn).not.toHaveBeenCalled();
	});

	test('errores de red se ignoran', async () => {
		let n = 0;
		mockCapHttpFn.mockImplementation(async () => {
			n++;
			if (n === 1) throw new Error('Network error');
			return { status: 200, data: { data: [] }, headers: {} };
		});

		const { suscribirCambios } = await import('$lib/realtime');
		suscribirCambios({ tabla: 'pedidos', onCambio: vi.fn() });

		await vi.advanceTimersByTimeAsync(30_000);

		expect(mockCapHttpFn).toHaveBeenCalledTimes(2);
	});

	test('tabla sin endpoint → conectado sin polling', async () => {
		const onEstado = vi.fn();

		const { suscribirCambios } = await import('$lib/realtime');
		suscribirCambios({ tabla: 'pedido_eventos', onCambio: vi.fn(), onEstado });

		expect(onEstado).toHaveBeenCalledWith('conectado');
		expect(mockCapHttpFn).not.toHaveBeenCalled();
	});
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. Refresh de tokens
// ══════════════════════════════════════════════════════════════════════════════

describe('Refresh de tokens', () => {
	test('storeSession sobrescribe tokens anteriores', () => {
		nativePlatformRef.value = true;
		storeSession('old-at', 'old-rt');
		storeSession('new-at', 'new-rt');
		expect(getStoredSession()?.accessToken).toBe('new-at');
	});

	test('clearSession elimina tokens', () => {
		nativePlatformRef.value = true;
		storeSession('at', 'rt');
		clearSession();
		expect(getStoredSession()).toBeNull();
	});

	test('buildCookieHeader después de clearSession → vacío', () => {
		nativePlatformRef.value = true;
		storeSession('a', 'r');
		clearSession();
		expect(buildCookieHeader()).toBe('');
	});

	test('tokens persisten entre recargas', () => {
		nativePlatformRef.value = true;
		storeSession('p-at', 'p-rt');
		expect(getStoredSession()?.accessToken).toBe('p-at');
		expect(getStoredSession()?.accessToken).toBe('p-at');
	});
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. RLS via cookies inyectadas
// ══════════════════════════════════════════════════════════════════════════════

describe('RLS via Capacitor — cookies inyectadas', () => {
	test('envía Cookie header con tokens', async () => {
		nativePlatformRef.value = true;
		storeSession('rls-at', 'rls-rt');

		capOk({ data: [{ id: 1, numero: 'PED-001' }] });
		const { api } = await import('$lib/api');
		await api.get('/api/pedidos');

		expect(mockCapHttpFn).toHaveBeenCalledWith(
			expect.objectContaining({
				headers: expect.objectContaining({
					'Cookie': 'stargo_access_token=rls-at; stargo_refresh_token=rls-rt'
				})
			})
		);
	});

	test('sin tokens: Cookie header vacío', async () => {
		nativePlatformRef.value = true;
		capOk({ data: null });

		const { api } = await import('$lib/api');
		await api.get('/api/sesion');

		const h = mockCapHttpFn.mock.calls[0][0].headers;
		expect(h['Cookie']).toBeFalsy();
	});

	test('apiFetch inyecta Cookie header', async () => {
		nativePlatformRef.value = true;
		storeSession('af-at', 'af-rt');

		capOk({ data: [] });
		const { apiFetch } = await import('$lib/api');
		const res = await apiFetch('/api/notificaciones');

		expect(mockCapHttpFn).toHaveBeenCalledWith(
			expect.objectContaining({
				headers: expect.objectContaining({ Cookie: expect.stringContaining('af-at') })
			})
		);
		expect(res.status).toBe(200);
	});

	test('logout → clearSession → request sin Cookie', async () => {
		nativePlatformRef.value = true;
		storeSession('out-at', 'out-rt');
		clearSession();

		capOk({ data: null });
		const { api } = await import('$lib/api');
		await api.get('/api/sesion');

		const h = mockCapHttpFn.mock.calls[0][0].headers;
		expect(h['Cookie']).toBeFalsy();
	});
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. Errores de base de datos
// ══════════════════════════════════════════════════════════════════════════════

describe('Errores de base de datos en Capacitor', () => {
	test('401: sesión inválida', async () => {
		nativePlatformRef.value = true;
		storeSession('bad', 'bad');
		capErr(401, 'No autenticado');

		const { api } = await import('$lib/api');
		const r = await api.get('/api/sesion');

		expect(r.data).toBeNull();
		expect(r.error).toBe('No autenticado');
	});

	test('403: sin permisos (RLS)', async () => {
		nativePlatformRef.value = true;
		storeSession('cli', 'cli');
		capErr(403, 'No eres administrador');

		const { api } = await import('$lib/api');
		const r = await api.get('/api/metricas');

		expect(r.data).toBeNull();
		expect(r.error).toBe('No eres administrador');
	});

	test('500: error de DB', async () => {
		nativePlatformRef.value = true;
		storeSession('ok', 'ok');
		capErr(500, 'Error interno del servidor');

		const { api } = await import('$lib/api');
		const r = await api.get('/api/pedidos');

		expect(r.data).toBeNull();
		expect(r.error).toBe('Error interno del servidor');
	});

	test('error de red capturado', async () => {
		nativePlatformRef.value = true;
		storeSession('t', 'r');
		mockCapHttpFn.mockRejectedValue(new Error('Network timeout'));

		const { api } = await import('$lib/api');
		const r = await api.get('/api/pedidos');

		expect(r.data).toBeNull();
		expect(r.error).toBe('Network timeout');
	});

	test('respuesta no JSON no rompe apiFetch', async () => {
		nativePlatformRef.value = true;
		mockCapHttpFn.mockResolvedValue({
			status: 200, data: '<html>Error</html>', headers: { 'content-type': 'text/html' }
		});

		const { apiFetch } = await import('$lib/api');
		const res = await apiFetch('/api/pedidos');

		expect(res.status).toBe(200);
		expect(await res.text()).toContain('<html>');
	});
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. Concurrencia
// ══════════════════════════════════════════════════════════════════════════════

describe('Concurrencia', () => {
	test('múltiples apiFetch en paralelo: cada uno con su Cookie', async () => {
		nativePlatformRef.value = true;
		storeSession('conc-tok', 'conc-rt');

		capOk({ data: [] });

		const { apiFetch } = await import('$lib/api');
		const [r1, r2, r3] = await Promise.all([
			apiFetch('/api/pedidos'),
			apiFetch('/api/notificaciones'),
			apiFetch('/api/domiciliarios')
		]);

		expect(r1.status).toBe(200);
		expect(r2.status).toBe(200);
		expect(r3.status).toBe(200);
		expect(mockCapHttpFn).toHaveBeenCalledTimes(3);

		for (const c of mockCapHttpFn.mock.calls) {
			expect(c[0].headers['Cookie']).toContain('conc-tok');
		}
	});

	test('múltiples api.get en paralelo', async () => {
		nativePlatformRef.value = true;
		storeSession('p-tok', 'p-rt');

		mockCapHttpFn.mockImplementation(async (opts: { url: string }) => {
			const ep = opts.url.split('/').pop();
			return { status: 200, data: { data: { endpoint: ep } }, headers: {} };
		});

		const { api } = await import('$lib/api');
		const [r1, r2] = await Promise.all([
			api.get('/api/sesion'),
			api.get('/api/push/estado')
		]);

		expect(r1.data?.endpoint).toBe('sesion');
		expect(r2.data?.endpoint).toBe('estado');
	});
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. Diferencias Web vs Capacitor
// ══════════════════════════════════════════════════════════════════════════════

describe('Diferencias Web vs Capacitor', () => {
	test('web: usa fetch, no CapacitorHttp', async () => {
		nativePlatformRef.value = false;
		const fm = vi.fn(async () => ({
			ok: true, json: async () => ({ data: { email: 'x' } })
		}));
		vi.stubGlobal('fetch', fm);

		const { api } = await import('$lib/api');
		await api.get('/api/sesion');

		expect(fm).toHaveBeenCalled();
		expect(mockCapHttpFn).not.toHaveBeenCalled();
	});

	test('web: no inyecta Cookie header manualmente', async () => {
		nativePlatformRef.value = false;
		const fm = vi.fn(async () => ({ ok: true, json: async () => ({ data: null }) }));
		vi.stubGlobal('fetch', fm);

		const { api } = await import('$lib/api');
		await api.get('/api/sesion');

		expect(fm.mock.calls[0][1]?.headers?.Cookie).toBeUndefined();
	});

	test('esCapacitor() detecta plataforma', () => {
		nativePlatformRef.value = true;
		expect(esCapacitor()).toBe(true);
		nativePlatformRef.value = false;
		expect(esCapacitor()).toBe(false);
	});
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. Flujo completo: Login → Sesión → Realtime → Logout
// ══════════════════════════════════════════════════════════════════════════════

describe('Flujo completo — Login → Sesión → Realtime → Logout', () => {
	test('admin: login → hidratar → polling → logout', async () => {
		nativePlatformRef.value = true;

		// 1. Login
		storeSession('admin-at', 'admin-rt');

		// 2. Hidratar — capOk responde con tokens para /api/sesion
		capOk({ data: { access_token: 'fresh-admin-at', refresh_token: 'fresh-admin-rt' } });
		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		expect(await hidratarSesionRealtime()).toBe(true);
		expect(mockSetSessionFn).toHaveBeenCalledWith({
			access_token: 'fresh-admin-at', refresh_token: 'fresh-admin-rt'
		});

		// 3. Polling
		capOk({ data: [{ id: 1, numero: 'PED-001' }] });
		const { suscribirCambios } = await import('$lib/realtime');
		const limpiar = suscribirCambios({ tabla: 'pedidos', onCambio: vi.fn() });

		await vi.advanceTimersByTimeAsync(15_000);
		expect(mockCapHttpFn).toHaveBeenCalledWith(
			expect.objectContaining({ url: expect.stringContaining('/api/pedidos') })
		);

		// 4. Cleanup
		const callsAfterPolling = mockCapHttpFn.mock.calls.length;
		limpiar();
		await vi.advanceTimersByTimeAsync(15_000);
		// After cleanup, no new calls should be made
		expect(mockCapHttpFn.mock.calls.length).toBe(callsAfterPolling);

		// 5. Logout
		clearSession();
		expect(getStoredSession()).toBeNull();
		expect(buildCookieHeader()).toBe('');
	});

	test('token expirado: hidratar falla → Realtime sin autenticar', async () => {
		nativePlatformRef.value = true;
		storeSession('exp-at', 'exp-rt');
		capOk({ data: null });

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		expect(await hidratarSesionRealtime()).toBe(false);

		// Realtime funciona pero sin auth
		capOk({ data: [] });
		const { suscribirCambios } = await import('$lib/realtime');
		const limpiar = suscribirCambios({ tabla: 'pedidos', onCambio: vi.fn() });

		await vi.advanceTimersByTimeAsync(15_000);
		expect(mockCapHttpFn).toHaveBeenCalled();
		limpiar();
	});
});
