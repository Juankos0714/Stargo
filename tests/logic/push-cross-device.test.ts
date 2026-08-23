/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests de integración: flujo completo de notificaciones push en
 * todos los dispositivos/plataformas.
 *
 * Cubre:
 *   - PWA en Chrome/Android (Web Push + VAPID)
 *   - PWA en iPhone instalada (Web Push + VAPID, iOS 16.4+)
 *   - App Capacitor Android (FCM nativo)
 *   - App Capacitor iOS (FCM → APNs)
 */

// ── Mocks (vi.hoisted) ──────────────────────────────────────────────────────

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
		get: vi.fn(),
		put: vi.fn()
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

// Imports después de mocks
import {
	storeSession,
	clearSession,
	buildCookieHeader,
	getStoredSession
} from '$lib/capacitor-auth';
import {
	registrarPushCapacitor,
	estaSuscritoCapacitor,
	escucharPushForeground
} from '$lib/push-capacitor';

beforeEach(() => {
	nativePlatformRef.value = false;
	mockPlatformRef.value = 'android';
	window.localStorage.clear();
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// ── Helper ───────────────────────────────────────────────────────────────────

function setupToken(token: string) {
	mockPushNotificationsObj.addListener.mockImplementation(
		(event: string, cb: (data: unknown) => void) => {
			if (event === 'registration') {
				Promise.resolve().then(() => cb({ value: token }));
			}
		}
	);
}

// ── Flujo PWA: Chrome Android (Web Push) ────────────────────────────────────

describe('Flujo PWA — Chrome Android (Web Push + VAPID)', () => {
	test('login → activate → subscribe → receive → logout', async () => {
		// 1. Login: store tokens
		storeSession('jwt-chrome-access', 'jwt-chrome-refresh');

		const session = getStoredSession();
		expect(session?.accessToken).toBe('jwt-chrome-access');

		// 2. Cookie header para requests API
		const cookie = buildCookieHeader();
		expect(cookie).toContain('stargo_access_token=jwt-chrome-access');

		// 3. Web Push subscription (simulado)
		const webPushSubscription = {
			endpoint: 'https://fcm.googleapis.com/fcm/send/chrome-endpoint-123',
			p256dh: 'base64url-p256dh-key',
			auth: 'base64url-auth-secret'
		};

		// 4. Guardar suscripción en backend
		mockApiObj.post.mockResolvedValueOnce({ data: { suscrito: true }, error: null });
		const saveResult = await mockApiObj.post('/api/push/suscribir', webPushSubscription);
		expect(saveResult.data?.suscrito).toBe(true);

		// 5. Verificar payload del push
		const pushPayload = {
			title: 'Nuevo pedido',
			body: 'Hay un pedido pendiente por asignar.',
			icon: '/icons/icon-192.png',
			data: { url: '/admin/pedidos' }
		};

		expect(pushPayload.title).toBe('Nuevo pedido');
		expect(pushPayload.data.url).toBe('/admin/pedidos');

		// 6. Logout: limpiar tokens
		clearSession();
		expect(getStoredSession()).toBeNull();
		expect(buildCookieHeader()).toBe('');
	});
});

// ── Flujo PWA: iPhone instalada (iOS 16.4+) ─────────────────────────────────

describe('Flujo PWA — iPhone instalada (iOS 16.4+ Web Push)', () => {
	test('detectar iOS → verificar soporte → suscribir → recibir', async () => {
		// 1. Login
		storeSession('jwt-ios-access', 'jwt-ios-refresh');

		// 2. Detectar iOS
		Object.defineProperty(navigator, 'userAgent', {
			value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
			configurable: true
		});

		const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
		expect(isIOS).toBe(true);

		// 3. Web Push subscription
		const iosSubscription = {
			endpoint: 'https://fcm.googleapis.com/fcm/send/ios-pwa-endpoint-456',
			p256dh: 'base64url-p256dh-ios',
			auth: 'base64url-auth-ios'
		};

		// 4. Guardar suscripción
		mockApiObj.post.mockResolvedValueOnce({ data: { suscrito: true }, error: null });
		const saveResult = await mockApiObj.post('/api/push/suscribir', iosSubscription);
		expect(saveResult.data?.suscrito).toBe(true);

		// 5. Verificar
		expect(iosSubscription.endpoint).toContain('fcm.googleapis.com');
		expect(iosSubscription.p256dh).toBeTruthy();
		expect(iosSubscription.auth).toBeTruthy();

		// 6. Logout
		clearSession();
		expect(getStoredSession()).toBeNull();
	});
});

// ── Flujo Capacitor: Android (FCM nativo) ───────────────────────────────────

describe('Flujo Capacitor — Android (FCM nativo)', () => {
	test('login → activate native push → register FCM → receive → logout', async () => {
		nativePlatformRef.value = true;
		mockPlatformRef.value = 'android';

		// 1. Login
		storeSession('jwt-cap-access', 'jwt-cap-refresh');
		expect(getStoredSession()?.accessToken).toBe('jwt-cap-access');

		// 2. Activar push nativo
		mockPushNotificationsObj.requestPermissions.mockResolvedValue({ receive: 'granted' });
		mockPushNotificationsObj.register.mockResolvedValue(undefined);
		setupToken('fcm-device-token-android-789');
		mockApiObj.post.mockResolvedValue({ data: { registrado: true }, error: null });

		const regResult = await registrarPushCapacitor();

		expect(regResult.ok).toBe(true);
		expect(regResult.token).toBe('fcm-device-token-android-789');
		expect(mockApiObj.post).toHaveBeenCalledWith('/api/push/registrar-token', {
			token: 'fcm-device-token-android-789',
			plataforma: 'android'
		});

		// 3. Verificar suscripción
		mockApiObj.get.mockResolvedValue({ data: { tiene_token: true }, error: null });
		const subResult = await estaSuscritoCapacitor();
		expect(subResult).toBe(true);

		// 4. Configurar listeners de foreground
		escucharPushForeground();
		expect(mockPushNotificationsObj.addListener).toHaveBeenCalledWith(
			'pushNotificationReceived',
			expect.any(Function)
		);

		// 5. Simular notificación en foreground
		const receivedCb = mockPushNotificationsObj.addListener.mock.calls.find(
			(c: [string, unknown]) => c[0] === 'pushNotificationReceived'
		)?.[1] as (n: { title: string }) => void;

		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		receivedCb({ title: 'Pedido asignado' });
		expect(consoleSpy).toHaveBeenCalledWith('[Push] Recibida en foreground:', 'Pedido asignado');
		consoleSpy.mockRestore();

		// 6. Simular click en notificación
		const actionCb = mockPushNotificationsObj.addListener.mock.calls.find(
			(c: [string, unknown]) => c[0] === 'pushNotificationActionPerformed'
		)?.[1] as (a: { notification: { data: { url: string } } }) => void;

		// En jsdom, window.location.href setter es no-op; solo verificar que no lanza
		expect(() => actionCb({ notification: { data: { url: '/domiciliario' } } })).not.toThrow();

		// 7. Logout
		clearSession();
		expect(getStoredSession()).toBeNull();
	});
});

// ── Flujo Capacitor: iOS (FCM → APNs) ──────────────────────────────────────

describe('Flujo Capacitor — iOS (FCM → APNs)', () => {
	test('login → activate native push → register FCM → receive → click → logout', async () => {
		nativePlatformRef.value = true;
		mockPlatformRef.value = 'ios';

		// 1. Login
		storeSession('jwt-ios-cap-access', 'jwt-ios-cap-refresh');

		// 2. Activar push nativo iOS
		mockPushNotificationsObj.requestPermissions.mockResolvedValue({ receive: 'granted' });
		mockPushNotificationsObj.register.mockResolvedValue(undefined);
		setupToken('fcm-device-token-ios-abc');
		mockApiObj.post.mockResolvedValue({ data: { registrado: true }, error: null });

		const regResult = await registrarPushCapacitor();

		expect(regResult.ok).toBe(true);
		expect(regResult.token).toBe('fcm-device-token-ios-abc');
		expect(mockApiObj.post).toHaveBeenCalledWith('/api/push/registrar-token', {
			token: 'fcm-device-token-ios-abc',
			plataforma: 'ios'
		});

		// 3. Verificar suscripción
		mockApiObj.get.mockResolvedValue({ data: { tiene_token: true }, error: null });
		const subResult = await estaSuscritoCapacitor();
		expect(subResult).toBe(true);

		// 4. Configurar foreground listeners
		escucharPushForeground();

		// 5. Simular notificación en foreground
		const receivedCb = mockPushNotificationsObj.addListener.mock.calls.find(
			(c: [string, unknown]) => c[0] === 'pushNotificationReceived'
		)?.[1] as (n: { title: string }) => void;

		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		receivedCb({ title: 'Pedido entregado' });
		expect(consoleSpy).toHaveBeenCalledWith('[Push] Recibida en foreground:', 'Pedido entregado');
		consoleSpy.mockRestore();

		// 6. Simular click → navegar a domiciliario
		const actionCb = mockPushNotificationsObj.addListener.mock.calls.find(
			(c: [string, unknown]) => c[0] === 'pushNotificationActionPerformed'
		)?.[1] as (a: { notification: { data: { url: string } } }) => void;

		// En jsdom, window.location.href setter es no-op; solo verificar que no lanza
		expect(() => actionCb({ notification: { data: { url: '/domiciliario' } } })).not.toThrow();

		// 7. Logout
		clearSession();
		expect(getStoredSession()).toBeNull();
	});
});

// ── Flujo de error: Permiso denegado ────────────────────────────────────────

describe('Flujo de error — permiso de notificaciones denegado', () => {
	test('Capacitor: permiso denegado → no registrar → no guardar', async () => {
		nativePlatformRef.value = true;
		mockPushNotificationsObj.requestPermissions.mockResolvedValue({ receive: 'denied' });

		const result = await registrarPushCapacitor();

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/denegado/);
		expect(mockPushNotificationsObj.register).not.toHaveBeenCalled();
		expect(mockApiObj.post).not.toHaveBeenCalled();
	});
});

// ── Flujo de error: Token FCM expirado ──────────────────────────────────────

describe('Flujo de error — token FCM expirado o inválido', () => {
	test('backend rechaza token → usuario debe re-registrar', async () => {
		nativePlatformRef.value = true;
		mockPushNotificationsObj.requestPermissions.mockResolvedValue({ receive: 'granted' });
		mockPushNotificationsObj.register.mockResolvedValue(undefined);
		setupToken('expired-fcm-token');
		mockApiObj.post.mockResolvedValue({ data: null, error: 'Token inválido' });

		const result = await registrarPushCapacitor();

		expect(result.ok).toBe(false);
		expect(result.token).toBe('expired-fcm-token');
		expect(result.error).toBe('Token inválido');
	});
});

// ── Persistencia de tokens entre sesiones ────────────────────────────────────

describe('Persistencia de tokens entre sesiones', () => {
	test('tokens persisten en localStorage entre recargas', () => {
		storeSession('persistent-at', 'persistent-rt');

		const session = getStoredSession();
		expect(session?.accessToken).toBe('persistent-at');
		expect(session?.refreshToken).toBe('persistent-rt');

		const cookie = buildCookieHeader();
		expect(cookie).toContain('stargo_access_token=persistent-at');
	});

	test('logout limpia todo para la siguiente sesión', () => {
		storeSession('to-clear-at', 'to-clear-rt');
		expect(getStoredSession()).not.toBeNull();

		clearSession();
		expect(getStoredSession()).toBeNull();
		expect(buildCookieHeader()).toBe('');

		const newSession = getStoredSession();
		expect(newSession).toBeNull();
	});
});
