/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests de supabase-browser.ts — hidratación de sesión para Realtime.
 *
 * Verifica:
 *  - El cliente Supabase se crea con la config correcta según plataforma
 *  - hidratarSesionRealtime() en Capacitor: lee tokens de localStorage
 *  - hidratarSesionRealtime() en web: llama a /api/sesion vía apiFetch
 *  - Manejo de errores en ambos caminos
 */

// ── Mocks (vi.hoisted) ──────────────────────────────────────────────────────

const {
	nativePlatformRef,
	storedSessionRef,
	mockSetSessionFn,
	mockApiFetchFn,
	mockCreateClientFn
} = vi.hoisted(() => ({
	nativePlatformRef: { value: false },
	storedSessionRef: { value: null as { accessToken: string; refreshToken: string } | null },
	mockSetSessionFn: vi.fn().mockResolvedValue({ error: null }),
	mockApiFetchFn: vi.fn(),
	mockCreateClientFn: vi.fn(() => ({
		auth: {
			setSession: mockSetSessionFn
		}
	}))
}));

vi.mock('@supabase/supabase-js', () => ({
	createClient: mockCreateClientFn
}));

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'https://test-project.supabase.co',
	PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key'
}));

vi.mock('@capacitor/core', () => ({
	get Capacitor() {
		return {
			isNativePlatform: () => nativePlatformRef.value,
			getPlatform: () => (nativePlatformRef.value ? 'android' : 'web')
		};
	}
}));

vi.mock('$lib/capacitor-auth', () => ({
	esCapacitor: () => nativePlatformRef.value,
	getStoredSession: () => storedSessionRef.value,
	storeSession: (at: string, rt: string) => {
		storedSessionRef.value = { accessToken: at, refreshToken: rt };
	}
}));

vi.mock('$lib/api', () => ({
	apiFetch: (...args: unknown[]) => mockApiFetchFn(...args)
}));

beforeEach(() => {
	nativePlatformRef.value = false;
	storedSessionRef.value = null;
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// ── supabaseBrowser — configuración del cliente ─────────────────────────────

describe('supabaseBrowser — configuración del cliente', () => {
	test('web: persistSession activado, autoRefreshToken desactivado (el server maneja el refresh)', async () => {
		nativePlatformRef.value = false;
		vi.resetModules();
		const { supabaseBrowser } = await import('$lib/supabase-browser');

		expect(mockCreateClientFn).toHaveBeenCalledWith(
			'https://test-project.supabase.co',
			'test-anon-key',
			expect.objectContaining({
				auth: {
					persistSession: true,
					autoRefreshToken: false
				}
			})
		);
	});

	test('Capacitor: persistSession y autoRefreshToken desactivados', async () => {
		nativePlatformRef.value = true;
		vi.resetModules();
		const { supabaseBrowser } = await import('$lib/supabase-browser');

		expect(mockCreateClientFn).toHaveBeenCalledWith(
			'https://test-project.supabase.co',
			'test-anon-key',
			expect.objectContaining({
				auth: {
					persistSession: false,
					autoRefreshToken: false
				}
			})
		);
	});

	test('el cliente tiene auth.setSession disponible', async () => {
		vi.resetModules();
		const { supabaseBrowser } = await import('$lib/supabase-browser');
		expect(supabaseBrowser.auth.setSession).toBeDefined();
		expect(typeof supabaseBrowser.auth.setSession).toBe('function');
	});
});

// ── hidratarSesionRealtime — Capacitor ───────────────────────────────────────

describe('hidratarSesionRealtime — Capacitor (llama /api/sesion y sincroniza tokens)', () => {
	beforeEach(() => {
		nativePlatformRef.value = true;
	});

	test('éxito: llama /api/sesion, guarda tokens en localStorage y pasa a setSession', async () => {
		storedSessionRef.value = {
			accessToken: 'jwt-cap-access-token',
			refreshToken: 'jwt-cap-refresh-token'
		};
		mockApiFetchFn.mockResolvedValue({
			ok: true,
			json: async () => ({
				data: {
					access_token: 'fresh-cap-access',
					refresh_token: 'fresh-cap-refresh'
				}
			})
		});
		mockSetSessionFn.mockResolvedValue({ error: null });

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		const result = await hidratarSesionRealtime();

		expect(result).toBe(true);
		// Debe llamar a /api/sesion en Capacitor (ya no lee localStorage directamente)
		expect(mockApiFetchFn).toHaveBeenCalledWith('/api/sesion', {
			headers: { Accept: 'application/json' }
		});
		expect(mockSetSessionFn).toHaveBeenCalledWith({
			access_token: 'fresh-cap-access',
			refresh_token: 'fresh-cap-refresh'
		});
	});

	test('fallo: /api/sesion retorna no-OK', async () => {
		mockApiFetchFn.mockResolvedValue({ ok: false, status: 401 });

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		const result = await hidratarSesionRealtime();

		expect(result).toBe(false);
		expect(mockSetSessionFn).not.toHaveBeenCalled();
	});

	test('fallo: /api/sesion retorna sin access_token', async () => {
		mockApiFetchFn.mockResolvedValue({
			ok: true,
			json: async () => ({ data: { email: 'anon@test.com' } })
		});

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		const result = await hidratarSesionRealtime();

		expect(result).toBe(false);
		expect(mockSetSessionFn).not.toHaveBeenCalled();
	});

	test('fallo: setSession retorna error', async () => {
		mockApiFetchFn.mockResolvedValue({
			ok: true,
			json: async () => ({
				data: {
					access_token: 'expired-token',
					refresh_token: 'expired-refresh'
				}
			})
		});
		mockSetSessionFn.mockResolvedValue({ error: { message: 'Invalid token' } });

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		const result = await hidratarSesionRealtime();

		expect(result).toBe(false);
		expect(mockSetSessionFn).toHaveBeenCalled();
	});

	test('fallo: setSession lanza excepción', async () => {
		mockApiFetchFn.mockResolvedValue({
			ok: true,
			json: async () => ({
				data: {
					access_token: 'bad-token',
					refresh_token: 'bad-refresh'
				}
			})
		});
		mockSetSessionFn.mockRejectedValue(new Error('Network error'));

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		const result = await hidratarSesionRealtime();		expect(result).toBe(false);
	});
});

// ── hidratarSesionRealtime — Web ────────────────────────────────────────────

describe('hidratarSesionRealtime — Web (apiFetch /api/sesion)', () => {
	beforeEach(() => {
		nativePlatformRef.value = false;
	});

	test('éxito: llama a /api/sesion y pasa tokens a setSession', async () => {
		mockApiFetchFn.mockResolvedValue({
			ok: true,
			json: async () => ({
				data: {
					access_token: 'jwt-web-access-token',
					refresh_token: 'jwt-web-refresh-token'
				}
			})
		});
		mockSetSessionFn.mockResolvedValue({ error: null });

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		const result = await hidratarSesionRealtime();

		expect(result).toBe(true);
		expect(mockApiFetchFn).toHaveBeenCalledWith('/api/sesion', {
			headers: { Accept: 'application/json' }
		});
		expect(mockSetSessionFn).toHaveBeenCalledWith({
			access_token: 'jwt-web-access-token',
			refresh_token: 'jwt-web-refresh-token'
		});
	});

	test('fallo: apiFetch retorna error HTTP', async () => {
		mockApiFetchFn.mockResolvedValue({ ok: false, status: 401 });

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		const result = await hidratarSesionRealtime();

		expect(result).toBe(false);
		expect(mockSetSessionFn).not.toHaveBeenCalled();
	});

	test('fallo: respuesta sin access_token', async () => {
		mockApiFetchFn.mockResolvedValue({
			ok: true,
			json: async () => ({ data: { email: 'user@test.com' } }) // sin access_token
		});

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		const result = await hidratarSesionRealtime();

		expect(result).toBe(false);
		expect(mockSetSessionFn).not.toHaveBeenCalled();
	});

	test('fallo: respuesta con data null', async () => {
		mockApiFetchFn.mockResolvedValue({
			ok: true,
			json: async () => ({ data: null })
		});

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		const result = await hidratarSesionRealtime();

		expect(result).toBe(false);
	});

	test('fallo: setSession retorna error', async () => {
		mockApiFetchFn.mockResolvedValue({
			ok: true,
			json: async () => ({
				data: {
					access_token: 'web-token',
					refresh_token: 'web-refresh'
				}
			})
		});
		mockSetSessionFn.mockResolvedValue({ error: { message: 'Session error' } });

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		const result = await hidratarSesionRealtime();

		expect(result).toBe(false);
		expect(mockSetSessionFn).toHaveBeenCalled();
	});

	test('fallo: apiFetch lanza excepción de red', async () => {
		mockApiFetchFn.mockRejectedValue(new Error('Failed to fetch'));

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		const result = await hidratarSesionRealtime();

		expect(result).toBe(false);
	});

	test('fallo: json() lanza excepción (respuesta no JSON)', async () => {
		mockApiFetchFn.mockResolvedValue({
			ok: true,
			json: async () => { throw new Error('Unexpected token'); }
		});

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		const result = await hidratarSesionRealtime();

		expect(result).toBe(false);
	});

	test('éxito: respuesta con data vacío pero con access_token', async () => {
		mockApiFetchFn.mockResolvedValue({
			ok: true,
			json: async () => ({
				data: {
					access_token: 'minimal-token',
					refresh_token: ''
				}
			})
		});
		mockSetSessionFn.mockResolvedValue({ error: null });

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');
		const result = await hidratarSesionRealtime();

		expect(result).toBe(true);
		expect(mockSetSessionFn).toHaveBeenCalledWith({
			access_token: 'minimal-token',
			refresh_token: ''
		});
	});
});

// ── Flujo completo de sesión ────────────────────────────────────────────────

describe('Flujo completo — hidratación de sesión para Realtime', () => {
	test('Capacitor: login → hidratar → Realtime con datos del usuario', async () => {
		nativePlatformRef.value = true;
		storedSessionRef.value = {
			accessToken: 'jwt-realtime-access',
			refreshToken: 'jwt-realtime-refresh'
		};
		mockApiFetchFn.mockResolvedValue({
			ok: true,
			json: async () => ({
				data: {
					access_token: 'fresh-realtime-access',
					refresh_token: 'fresh-realtime-refresh'
				}
			})
		});
		mockSetSessionFn.mockResolvedValue({ error: null });

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');

		// Hidratar sesión
		const ok = await hidratarSesionRealtime();
		expect(ok).toBe(true);

		// Capacitor ahora también llama a /api/sesion para obtener tokens frescos
		expect(mockApiFetchFn).toHaveBeenCalledWith('/api/sesion', {
			headers: { Accept: 'application/json' }
		});

		// Verificar que setSession fue llamado con los tokens de la respuesta
		expect(mockSetSessionFn).toHaveBeenCalledWith({
			access_token: 'fresh-realtime-access',
			refresh_token: 'fresh-realtime-refresh'
		});
	});

	test('Web: login → hidratar → Realtime con datos del usuario', async () => {
		nativePlatformRef.value = false;
		mockApiFetchFn.mockResolvedValue({
			ok: true,
			json: async () => ({
				data: {
					access_token: 'jwt-web-realtime-access',
					refresh_token: 'jwt-web-realtime-refresh'
				}
			})
		});
		mockSetSessionFn.mockResolvedValue({ error: null });

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');

		// Hidratar sesión
		const ok = await hidratarSesionRealtime();
		expect(ok).toBe(true);

		// Verificar que se llamó a /api/sesion
		expect(mockApiFetchFn).toHaveBeenCalledWith('/api/sesion', {
			headers: { Accept: 'application/json' }
		});

		// Verificar que setSession fue llamado con los tokens de la respuesta
		expect(mockSetSessionFn).toHaveBeenCalledWith({
			access_token: 'jwt-web-realtime-access',
			refresh_token: 'jwt-web-realtime-refresh'
		});
	});

	test('Capacitor: sesión expirada → /api/sesion retorna sin tokens → hidratar falla', async () => {
		nativePlatformRef.value = true;
		mockApiFetchFn.mockResolvedValue({ ok: true, json: async () => ({ data: null }) });

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');

		const ok = await hidratarSesionRealtime();
		expect(ok).toBe(false);

		// El cliente queda como anónimo (sin sesión)
		// Realtime funcionará pero sin datos RLS protegidos
	});

	test('Web: usuario no logueado → /api/sesion retorna 401 → hidratar falla', async () => {
		nativePlatformRef.value = false;
		mockApiFetchFn.mockResolvedValue({ ok: false, status: 401 });

		const { hidratarSesionRealtime } = await import('$lib/supabase-browser');

		const ok = await hidratarSesionRealtime();
		expect(ok).toBe(false);

		// El cliente queda como anónimo
	});
});
