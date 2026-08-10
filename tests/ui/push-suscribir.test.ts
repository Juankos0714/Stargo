import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { suscribirPush } from '$lib/push';
import { env } from '$env/dynamic/public';

// Clave VAPID válida (65 bytes) generada en el hoisted para el mock del env.
const { CLAVE_VALIDA, CLAVE_VALIDA_BYTES } = vi.hoisted(() => {
	const bytes = Array.from({ length: 65 }, (_, i) => (i * 7 + 3) % 256);
	const b64 = btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
	return { CLAVE_VALIDA: b64, CLAVE_VALIDA_BYTES: new Uint8Array(bytes) };
});

// $env/dynamic/public y $app/environment los cubren los aliases de
// vitest.ui.config.ts (mocks/env-dynamic-public.ts y app-environment.ts);
// aquí solo se muta env.PUBLIC_VAPID_PUBLIC_KEY por caso.

interface SubFake {
	options: { applicationServerKey?: ArrayBuffer | null };
	unsubscribe: ReturnType<typeof vi.fn>;
	toJSON: () => unknown;
}

function subFake(serverKey: ArrayBuffer | null | undefined): SubFake {
	return {
		options: { applicationServerKey: serverKey },
		unsubscribe: vi.fn(async () => true),
		toJSON: () => ({ endpoint: 'https://push.example/ep1', keys: { p256dh: 'x', auth: 'y' } })
	};
}

/** Monta los stubs de navegador necesarios (Notification, PushManager, SW, fetch). */
function instalarEntorno(entorno: { sub: SubFake | null }) {
	const subscribe = vi.fn(async () => subFake(CLAVE_VALIDA_BYTES.buffer));
	const getSubscription = vi.fn(async () => entorno.sub);
	Object.defineProperty(window, 'Notification', {
		value: { requestPermission: vi.fn(async () => 'granted') },
		configurable: true
	});
	Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true });
	Object.defineProperty(navigator, 'serviceWorker', {
		value: { ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }) },
		configurable: true
	});
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ ok: true, json: async () => ({ data: { suscrito: true } }) }))
	);
	return { subscribe, getSubscription };
}

beforeEach(() => {
	env.PUBLIC_VAPID_PUBLIC_KEY = CLAVE_VALIDA;
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('suscribirPush — regeneración tras cambiar la clave VAPID', () => {
	test('sin suscripción previa: subscribe con la clave actual', async () => {
		const { subscribe, getSubscription } = instalarEntorno({ sub: null });

		const r = await suscribirPush();

		expect(r.ok).toBe(true);
		expect(getSubscription).toHaveBeenCalledTimes(1);
		expect(subscribe).toHaveBeenCalledTimes(1);
		expect(subscribe).toHaveBeenCalledWith(
			expect.objectContaining({ userVisibleOnly: true, applicationServerKey: CLAVE_VALIDA })
		);
	});

	test('suscripción con clave ANTERIOR: se desuscribe y se vuelve a suscribir', async () => {
		const vieja = new Uint8Array(65).fill(7).buffer; // distinta a la actual
		const fake = subFake(vieja);
		const { subscribe } = instalarEntorno({ sub: fake });

		const r = await suscribirPush();

		expect(r.ok).toBe(true);
		expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
		expect(subscribe).toHaveBeenCalledTimes(1);
	});

	test('suscripción con la clave ACTUAL: se conserva (sin desuscribir ni resuscribir)', async () => {
		const fake = subFake(CLAVE_VALIDA_BYTES.buffer);
		const { subscribe } = instalarEntorno({ sub: fake });

		const r = await suscribirPush();

		expect(r.ok).toBe(true);
		expect(fake.unsubscribe).not.toHaveBeenCalled();
		expect(subscribe).not.toHaveBeenCalled();
	});

	test('suscripción sin options (navegador viejo): se conserva', async () => {
		const fake = subFake(undefined);
		const { subscribe } = instalarEntorno({ sub: fake });

		const r = await suscribirPush();

		expect(r.ok).toBe(true);
		expect(fake.unsubscribe).not.toHaveBeenCalled();
		expect(subscribe).not.toHaveBeenCalled();
	});

	test('clave VAPID inválida en el env: error claro y NO toca el pushManager', async () => {
		env.PUBLIC_VAPID_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----';
		const { subscribe, getSubscription } = instalarEntorno({ sub: null });

		const r = await suscribirPush();

		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/no tiene formato válido/);
		expect(getSubscription).not.toHaveBeenCalled();
		expect(subscribe).not.toHaveBeenCalled();
	});
});
