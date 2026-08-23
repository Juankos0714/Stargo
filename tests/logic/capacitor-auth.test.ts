/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests de capacitor-auth — gestión de tokens y detección de plataforma.
 *
 * Verifica que:
 *  - esCapacitor() detecta correctamente el entorno nativo vs web
 *  - storeSession / getStoredSession / clearSession persisten en localStorage
 *  - buildCookieHeader genera el header Cookie correcto
 */

// Mock dinámico de @capacitor/core
let nativePlatform = false;
vi.mock('@capacitor/core', () => ({
	get Capacitor() {
		return {
			isNativePlatform: () => nativePlatform,
			getPlatform: () => (nativePlatform ? 'android' : 'web')
		};
	}
}));

// Importar DESPUÉS del mock
import {
	esCapacitor,
	storeSession,
	getStoredSession,
	clearSession,
	buildCookieHeader
} from '$lib/capacitor-auth';

beforeEach(() => {
	nativePlatform = false;
	window.localStorage.clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// ── esCapacitor ──────────────────────────────────────────────────────────────

describe('esCapacitor — detección de plataforma', () => {
	test('devuelve false en entorno web', () => {
		expect(esCapacitor()).toBe(false);
	});

	test('devuelve true en Capacitor (app nativa)', () => {
		nativePlatform = true;
		expect(esCapacitor()).toBe(true);
	});

	test('devuelve false si Capacitor no está disponible (entorno de test)', () => {
		expect(esCapacitor()).toBe(false);
	});
});

// ── storeSession / getStoredSession ──────────────────────────────────────────

describe('Session tokens — persistencia en localStorage', () => {
	test('storeSession guarda tokens en localStorage', () => {
		storeSession('access-123', 'refresh-456');

		expect(localStorage.getItem('stargo_access_token')).toBe('access-123');
		expect(localStorage.getItem('stargo_refresh_token')).toBe('refresh-456');
	});

	test('getStoredSession lee los tokens almacenados', () => {
		storeSession('at-ok', 'rt-ok');

		const session = getStoredSession();
		expect(session).toEqual({ accessToken: 'at-ok', refreshToken: 'rt-ok' });
	});

	test('getStoredSession devuelve null si no hay tokens', () => {
		expect(getStoredSession()).toBeNull();
	});

	test('getStoredSession devuelve null si solo falta el access token', () => {
		localStorage.setItem('stargo_refresh_token', 'rt-only');
		expect(getStoredSession()).toBeNull();
	});

	test('getStoredSession tolera refresh token ausente (devuelve vacío)', () => {
		localStorage.setItem('stargo_access_token', 'at-only');
		const session = getStoredSession();
		expect(session).toEqual({ accessToken: 'at-only', refreshToken: '' });
	});

	test('clearSession elimina ambos tokens', () => {
		storeSession('at', 'rt');
		expect(getStoredSession()).not.toBeNull();

		clearSession();
		expect(getStoredSession()).toBeNull();
		expect(localStorage.getItem('stargo_access_token')).toBeNull();
		expect(localStorage.getItem('stargo_refresh_token')).toBeNull();
	});

	test('clearSession es seguro si no había tokens', () => {
		expect(() => clearSession()).not.toThrow();
	});

	test('storeSession sobrescribe tokens anteriores', () => {
		storeSession('old-at', 'old-rt');
		storeSession('new-at', 'new-rt');

		const session = getStoredSession();
		expect(session?.accessToken).toBe('new-at');
		expect(session?.refreshToken).toBe('new-rt');
	});
});

// ── buildCookieHeader ────────────────────────────────────────────────────────

describe('buildCookieHeader — inyección de cookies para CapacitorHttp', () => {
	test('genera Cookie header con ambos tokens', () => {
		storeSession('abc', 'xyz');

		const header = buildCookieHeader();
		expect(header).toBe('stargo_access_token=abc; stargo_refresh_token=xyz');
	});

	test('devuelve string vacío si no hay tokens', () => {
		expect(buildCookieHeader()).toBe('');
	});

	test('devuelve string vacío si solo falta el access token', () => {
		localStorage.setItem('stargo_refresh_token', 'rt');
		expect(buildCookieHeader()).toBe('');
	});

	test('tolera tokens con caracteres especiales (URL-safe)', () => {
		storeSession('token+with/special=chars', 'refresh&more');

		const header = buildCookieHeader();
		expect(header).toContain('stargo_access_token=token+with/special=chars');
		expect(header).toContain('stargo_refresh_token=refresh&more');
	});
});

// ── Flujo completo de sesión ────────────────────────────────────────────────

describe('Flujo completo — login → uso → logout', () => {
	test('login guarda tokens, API los usa, logout limpia', () => {
		// 1. Login: store tokens
		storeSession('jwt-access-token', 'jwt-refresh-token');

		// 2. API request: build cookie header
		const cookie = buildCookieHeader();
		expect(cookie).toContain('stargo_access_token=jwt-access-token');
		expect(cookie).toContain('stargo_refresh_token=jwt-refresh-token');

		// 3. Verify session exists
		const session = getStoredSession();
		expect(session?.accessToken).toBe('jwt-access-token');

		// 4. Logout: clear
		clearSession();
		expect(getStoredSession()).toBeNull();
		expect(buildCookieHeader()).toBe('');
	});

	test('tokens se mantienen entre páginas (persistencia)', () => {
		storeSession('persistent-at', 'persistent-rt');

		// Simular recarga de página (localStorage persiste en jsdom)
		const session1 = getStoredSession();
		expect(session1?.accessToken).toBe('persistent-at');

		// Navegar a otra página (sigue disponible)
		const session2 = getStoredSession();
		expect(session2?.accessToken).toBe('persistent-at');
	});
});
