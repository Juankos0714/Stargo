import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests unitarios del módulo push-capacitor.
 *
 * Solo funciones puras: esCapacitor() detecta el entorno nativo.
 * Los tests mockean Capacitor.isNativePlatform() para simular
 * ambos entornos (navegador web vs app nativa).
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

// Mock de @capacitor/push-notifications
vi.mock('@capacitor/push-notifications', () => ({
	PushNotifications: {
		requestPermissions: vi.fn(),
		register: vi.fn(),
		addListener: vi.fn()
	}
}));

// Mock de $lib/api
vi.mock('$lib/api', () => ({
	api: {
		post: vi.fn(),
		get: vi.fn()
	},
	apiFetch: vi.fn()
}));

describe('esCapacitor', () => {
	beforeEach(() => {
		nativePlatform = false;
	});

	test('devuelve false en entorno web (no nativo)', async () => {
		const { esCapacitor } = await import('$lib/push-capacitor');
		expect(esCapacitor()).toBe(false);
	});

	test('devuelve true en entorno nativo (Capacitor)', async () => {
		nativePlatform = true;
		const { esCapacitor } = await import('$lib/push-capacitor');
		expect(esCapacitor()).toBe(true);
	});
});

describe('registrarPushCapacitor', () => {
	beforeEach(() => {
		nativePlatform = false;
		vi.clearAllMocks();
	});

	test('devuelve error si no está en Capacitor', async () => {
		const { registrarPushCapacitor } = await import('$lib/push-capacitor');
		const result = await registrarPushCapacitor();
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/solo funciona en apps nativas/);
	});
});

describe('estaSuscritoCapacitor', () => {
	beforeEach(() => {
		nativePlatform = false;
		vi.clearAllMocks();
	});

	test('devuelve null si no está en Capacitor', async () => {
		const { estaSuscritoCapacitor } = await import('$lib/push-capacitor');
		const result = await estaSuscritoCapacitor();
		expect(result).toBeNull();
	});
});
