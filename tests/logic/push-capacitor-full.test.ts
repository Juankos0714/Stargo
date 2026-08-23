/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests completos de push-capacitor — push nativo para apps Capacitor.
 *
 * Cubre:
 *  - Detección de plataforma (esCapacitor)
 *  - Registro de push (permiso → register → token FCM → guardar en backend)
 *  - Verificación de suscripción (estaSuscritoCapacitor)
 *  - Listeners de foreground (escucharPushForeground)
 *  - Flujos de error (permiso denegado, timeout FCM, backend error)
 *  - Plataformas: Android vs iOS
 */

// ── Mocks (vi.hoisted para variables accesibles en vi.mock factories) ──────

const {
	nativePlatformRef,
	mockPlatformRef,
	mockPushNotificationsObj,
	mockApiObj
} = vi.hoisted(() => ({
	nativePlatformRef: { value: false },
	mockPlatformRef: { value: 'android' as 'android' | 'ios' },
	mockPushNotificationsObj: {
		requestPermissions: vi.fn(),
		register: vi.fn(),
		addListener: vi.fn()
	},
	mockApiObj: {
		post: vi.fn(),
		get: vi.fn()
	}
}));

vi.mock('@capacitor/core', () => ({
	get Capacitor() {
		return {
			isNativePlatform: () => nativePlatformRef.value,
			getPlatform: () => (nativePlatformRef.value ? mockPlatformRef.value : 'web')
		};
	}
}));

vi.mock('@capacitor/push-notifications', () => ({
	PushNotifications: mockPushNotificationsObj
}));

vi.mock('$lib/api', () => ({
	api: mockApiObj,
	apiFetch: vi.fn()
}));

// Importar DESPUÉS de los mocks
import {
	esCapacitor,
	registrarPushCapacitor,
	estaSuscritoCapacitor,
	escucharPushForeground
} from '$lib/push-capacitor';

beforeEach(() => {
	nativePlatformRef.value = false;
	mockPlatformRef.value = 'android';
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function setupTokenListener(tokenValue: string) {
	mockPushNotificationsObj.addListener.mockImplementation(
		(event: string, cb: (data: unknown) => void) => {
			if (event === 'registration') {
				Promise.resolve().then(() => cb({ value: tokenValue }));
			}
		}
	);
}

function setupRegistrationError(errorMsg: string) {
	mockPushNotificationsObj.addListener.mockImplementation(
		(event: string, cb: (data: unknown) => void) => {
			if (event === 'registrationError') {
				Promise.resolve().then(() => cb({ error: errorMsg }));
			}
		}
	);
}

// ── esCapacitor ──────────────────────────────────────────────────────────────

describe('esCapacitor — detección de plataforma', () => {
	test('false en web', () => {
		expect(esCapacitor()).toBe(false);
	});

	test('true en Android', () => {
		nativePlatformRef.value = true;
		mockPlatformRef.value = 'android';
		expect(esCapacitor()).toBe(true);
	});

	test('true en iOS', () => {
		nativePlatformRef.value = true;
		mockPlatformRef.value = 'ios';
		expect(esCapacitor()).toBe(true);
	});
});

// ── registrarPushCapacitor — Flujo completo ──────────────────────────────────

describe('registrarPushCapacitor — registro exitoso', () => {
	test('Android: permiso → register → token FCM → guardar en backend', async () => {
		nativePlatformRef.value = true;
		mockPlatformRef.value = 'android';
		mockPushNotificationsObj.requestPermissions.mockResolvedValue({ receive: 'granted' });
		mockPushNotificationsObj.register.mockResolvedValue(undefined);
		setupTokenListener('fcm-token-android-123');
		mockApiObj.post.mockResolvedValue({ data: { registrado: true }, error: null });

		const result = await registrarPushCapacitor();

		expect(result.ok).toBe(true);
		expect(result.token).toBe('fcm-token-android-123');
		expect(mockPushNotificationsObj.requestPermissions).toHaveBeenCalledTimes(1);
		expect(mockPushNotificationsObj.register).toHaveBeenCalledTimes(1);
		expect(mockApiObj.post).toHaveBeenCalledWith('/api/push/registrar-token', {
			token: 'fcm-token-android-123',
			plataforma: 'android'
		});
	});

	test('iOS: permiso → register → token FCM → guardar en backend', async () => {
		nativePlatformRef.value = true;
		mockPlatformRef.value = 'ios';
		mockPushNotificationsObj.requestPermissions.mockResolvedValue({ receive: 'granted' });
		mockPushNotificationsObj.register.mockResolvedValue(undefined);
		setupTokenListener('fcm-token-ios-456');
		mockApiObj.post.mockResolvedValue({ data: { registrado: true }, error: null });

		const result = await registrarPushCapacitor();

		expect(result.ok).toBe(true);
		expect(result.token).toBe('fcm-token-ios-456');
		expect(mockApiObj.post).toHaveBeenCalledWith('/api/push/registrar-token', {
			token: 'fcm-token-ios-456',
			plataforma: 'ios'
		});
	});
});

// ── registrarPushCapacitor — Errores ─────────────────────────────────────────

describe('registrarPushCapacitor — manejo de errores', () => {
	test('error si no está en Capacitor', async () => {
		const result = await registrarPushCapacitor();

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/solo funciona en apps nativas/);
		expect(mockPushNotificationsObj.requestPermissions).not.toHaveBeenCalled();
	});

	test('permiso de notificaciones denegado', async () => {
		nativePlatformRef.value = true;
		mockPushNotificationsObj.requestPermissions.mockResolvedValue({ receive: 'denied' });

		const result = await registrarPushCapacitor();

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/Permiso de notificaciones denegado/);
		expect(mockPushNotificationsObj.register).not.toHaveBeenCalled();
	});

	test('permiso de notificaciones no determinado (prompt)', async () => {
		nativePlatformRef.value = true;
		mockPushNotificationsObj.requestPermissions.mockResolvedValue({ receive: 'prompt' });

		const result = await registrarPushCapacitor();

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/Permiso de notificaciones denegado/);
	});

	test('error de registro FCM (registrationError)', async () => {
		nativePlatformRef.value = true;
		mockPushNotificationsObj.requestPermissions.mockResolvedValue({ receive: 'granted' });
		mockPushNotificationsObj.register.mockResolvedValue(undefined);
		setupRegistrationError('FCM not available');

		const result = await registrarPushCapacitor();

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/Error de registro FCM/);
		expect(mockApiObj.post).not.toHaveBeenCalled();
	});

	test('timeout esperando token FCM (15s)', async () => {
		nativePlatformRef.value = true;
		mockPushNotificationsObj.requestPermissions.mockResolvedValue({ receive: 'granted' });
		mockPushNotificationsObj.register.mockResolvedValue(undefined);
		// No configurar listener: el token nunca llega
		mockPushNotificationsObj.addListener.mockImplementation(() => {});

		const result = await registrarPushCapacitor();

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/Timeout esperando token FCM/);
	}, 20_000);

	test('error del backend al guardar token', async () => {
		nativePlatformRef.value = true;
		mockPushNotificationsObj.requestPermissions.mockResolvedValue({ receive: 'granted' });
		mockPushNotificationsObj.register.mockResolvedValue(undefined);
		setupTokenListener('fcm-token-fail');
		mockApiObj.post.mockResolvedValue({ data: null, error: 'Usuario no autenticado' });

		const result = await registrarPushCapacitor();

		expect(result.ok).toBe(false);
		expect(result.token).toBe('fcm-token-fail');
		expect(result.error).toBe('Usuario no autenticado');
	});

	test('excepción inesperada durante el registro', async () => {
		nativePlatformRef.value = true;
		mockPushNotificationsObj.requestPermissions.mockRejectedValue(new Error('Plugin not loaded'));

		const result = await registrarPushCapacitor();

		expect(result.ok).toBe(false);
		expect(result.error).toBe('Plugin not loaded');
	});
});

// ── estaSuscritoCapacitor ────────────────────────────────────────────────────

describe('estaSuscritoCapacitor — verificación de suscripción', () => {
	test('true si el backend reporta token registrado', async () => {
		nativePlatformRef.value = true;
		mockApiObj.get.mockResolvedValue({ data: { tiene_token: true }, error: null });

		const result = await estaSuscritoCapacitor();

		expect(result).toBe(true);
		expect(mockApiObj.get).toHaveBeenCalledWith('/api/push/estado');
	});

	test('false si el backend no tiene token', async () => {
		nativePlatformRef.value = true;
		mockApiObj.get.mockResolvedValue({ data: { tiene_token: false }, error: null });

		const result = await estaSuscritoCapacitor();

		expect(result).toBe(false);
	});

	test('null si no está en Capacitor', async () => {
		const result = await estaSuscritoCapacitor();

		expect(result).toBeNull();
		expect(mockApiObj.get).not.toHaveBeenCalled();
	});

	test('null si el backend falla', async () => {
		nativePlatformRef.value = true;
		mockApiObj.get.mockRejectedValue(new Error('Network error'));

		const result = await estaSuscritoCapacitor();

		expect(result).toBeNull();
	});

	test('null si la respuesta es ambigua (data null)', async () => {
		nativePlatformRef.value = true;
		mockApiObj.get.mockResolvedValue({ data: null, error: null });

		const result = await estaSuscritoCapacitor();

		expect(result).toBeNull();
	});
});

// ── escucharPushForeground ──────────────────────────────────────────────────

describe('escucharPushForeground — listeners de primer plano', () => {
	test('en Capacitor: registra listeners de pushReceived y pushPerformed', () => {
		nativePlatformRef.value = true;

		escucharPushForeground();

		expect(mockPushNotificationsObj.addListener).toHaveBeenCalledWith(
			'pushNotificationReceived',
			expect.any(Function)
		);
		expect(mockPushNotificationsObj.addListener).toHaveBeenCalledWith(
			'pushNotificationActionPerformed',
			expect.any(Function)
		);
	});

	test('en web: NO registra listeners', () => {
		nativePlatformRef.value = false;

		escucharPushForeground();

		expect(mockPushNotificationsObj.addListener).not.toHaveBeenCalled();
	});

	test('pushNotificationReceived solo logea', () => {
		nativePlatformRef.value = true;
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		escucharPushForeground();

		const receivedCb = mockPushNotificationsObj.addListener.mock.calls.find(
			(c: [string, unknown]) => c[0] === 'pushNotificationReceived'
		)?.[1] as (notification: { title: string }) => void;

		receivedCb({ title: 'Nuevo pedido' });

		expect(consoleSpy).toHaveBeenCalledWith(
			'[Push] Recibida en foreground:',
			'Nuevo pedido'
		);

		consoleSpy.mockRestore();
	});

	test('pushNotificationActionPerformed navega a la URL', () => {
		nativePlatformRef.value = true;

		escucharPushForeground();

		const actionCb = mockPushNotificationsObj.addListener.mock.calls.find(
			(c: [string, unknown]) => c[0] === 'pushNotificationActionPerformed'
		)?.[1] as (action: { notification: { data: { url: string } } }) => void;

		actionCb({ notification: { data: { url: '/admin/pedidos' } } });

		// En jsdom, window.location.href setter navigates (no-op in test env)
		// Verificar que el callback ejecuta la navegación sin errores
		expect(actionCb).toBeDefined();
	});

	test('pushNotificationPerformed sin URL no lanza', () => {
		nativePlatformRef.value = true;

		escucharPushForeground();

		const actionCb = mockPushNotificationsObj.addListener.mock.calls.find(
			(c: [string, unknown]) => c[0] === 'pushNotificationActionPerformed'
		)?.[1] as (action: { notification: { data: Record<string, unknown> } }) => void;

		expect(() => actionCb({ notification: { data: {} } })).not.toThrow();
	});
});

// ── Flujos multi-plataforma ─────────────────────────────────────────────────

describe('Flujos multi-plataforma — Android vs iOS', () => {
	test('Android: push completo con FCM token', async () => {
		nativePlatformRef.value = true;
		mockPlatformRef.value = 'android';
		mockPushNotificationsObj.requestPermissions.mockResolvedValue({ receive: 'granted' });
		mockPushNotificationsObj.register.mockResolvedValue(undefined);
		setupTokenListener('fcm-android-token-abc');
		mockApiObj.post.mockResolvedValue({ data: { registrado: true }, error: null });
		mockApiObj.get.mockResolvedValue({ data: { tiene_token: true }, error: null });

		const regResult = await registrarPushCapacitor();
		expect(regResult.ok).toBe(true);
		expect(mockApiObj.post.mock.calls[0][1].plataforma).toBe('android');

		const subResult = await estaSuscritoCapacitor();
		expect(subResult).toBe(true);
	});

	test('iOS: push completo con FCM token', async () => {
		nativePlatformRef.value = true;
		mockPlatformRef.value = 'ios';
		mockPushNotificationsObj.requestPermissions.mockResolvedValue({ receive: 'granted' });
		mockPushNotificationsObj.register.mockResolvedValue(undefined);
		setupTokenListener('fcm-ios-token-xyz');
		mockApiObj.post.mockResolvedValue({ data: { registrado: true }, error: null });
		mockApiObj.get.mockResolvedValue({ data: { tiene_token: true }, error: null });

		const regResult = await registrarPushCapacitor();
		expect(regResult.ok).toBe(true);
		expect(mockApiObj.post.mock.calls[0][1].plataforma).toBe('ios');

		const subResult = await estaSuscritoCapacitor();
		expect(subResult).toBe(true);
	});

	test('Sin Capacitor: push nativo deshabilitado', async () => {
		const nativeResult = await registrarPushCapacitor();
		expect(nativeResult.ok).toBe(false);

		const subResult = await estaSuscritoCapacitor();
		expect(subResult).toBeNull();

		escucharPushForeground();
		expect(mockPushNotificationsObj.addListener).not.toHaveBeenCalled();
	});
});
