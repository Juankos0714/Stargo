/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests de realtime.ts — polling fallback en Capacitor.
 *
 * En Capacitor, los WebSockets de Supabase Realtime no funcionan de forma
 * confiable. El módulo usa polling HTTP como alternativa.
 *
 * Verifica:
 *  - En Capacitor: usa polling HTTP (setInterval + apiFetch)
 *  - En web: usa Supabase Realtime (WebSocket via canal)
 *  - Detección de INSERT vs UPDATE por diferencia de longitud
 *  - Cleanup: cancelar polling al desuscribirse
 *  - Tablas sin endpoint de polling conocido
 */

// ── Mocks (vi.hoisted) ──────────────────────────────────────────────────────

const {
	nativePlatformRef,
	mockApiFetchFn,
	mockSupabaseBrowserObj,
	mockSupabaseChannelObj
} = vi.hoisted(() => ({
	nativePlatformRef: { value: false },
	mockApiFetchFn: vi.fn(),
	mockSupabaseChannelObj: {
		on: vi.fn().mockReturnThis(),
		subscribe: vi.fn().mockImplementation(function () { return mockSupabaseChannelObj; }),
		unsubscribe: vi.fn()
	},
	mockSupabaseBrowserObj: {
		channel: vi.fn(() => mockSupabaseChannelObj),
		removeChannel: vi.fn()
	}
}));

vi.mock('@capacitor/core', () => ({
	get Capacitor() {
		return { isNativePlatform: () => nativePlatformRef.value };
	}
}));

vi.mock('$lib/capacitor-auth', () => ({
	esCapacitor: () => nativePlatformRef.value
}));

vi.mock('$lib/api', () => ({
	apiFetch: (...args: unknown[]) => mockApiFetchFn(...args)
}));

vi.mock('$lib/supabase-browser', () => ({
	supabaseBrowser: mockSupabaseBrowserObj
}));

// Importar después de mocks
import { suscribirCambios } from '$lib/realtime';

beforeEach(() => {
	nativePlatformRef.value = false;
	vi.clearAllMocks();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

// ── Capacitor: polling fallback ──────────────────────────────────────────────

describe('suscribirCambios — Capacitor (polling HTTP)', () => {
	beforeEach(() => {
		nativePlatformRef.value = true;
	});

	test('marca estado como conectado inmediatamente', () => {
		const onEstado = vi.fn();
		mockApiFetchFn.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });

		suscribirCambios({
			tabla: 'pedidos',
			onCambio: vi.fn(),
			onEstado
		});

		expect(onEstado).toHaveBeenCalledWith('conectado');
	});

	test('usa apiFetch para pollear /api/pedidos cada 15s', async () => {
		const onCambio = vi.fn();
		mockApiFetchFn.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });

		suscribirCambios({
			tabla: 'pedidos',
			onCambio
		});

		await vi.advanceTimersByTimeAsync(15_000);

		expect(mockApiFetchFn).toHaveBeenCalledWith('/api/pedidos', {
			headers: { Accept: 'application/json' }
		});
	});

	test('detecta INSERT cuando aumenta la longitud', async () => {
		const onCambio = vi.fn();
		let callCount = 0;
		mockApiFetchFn.mockImplementation(async () => ({
			ok: true,
			json: async () => {
				callCount++;
				return callCount === 1
					? { data: [{ id: 1 }] }
					: { data: [{ id: 1 }, { id: 2 }] };
			}
		}));

		suscribirCambios({
			tabla: 'pedidos',
			onCambio
		});

		await vi.advanceTimersByTimeAsync(30_000);

		expect(onCambio).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'INSERT' })
		);
	});

	test('detecta UPDATE cuando la longitud no cambia', async () => {
		const onCambio = vi.fn();
		let callCount = 0;
		mockApiFetchFn.mockImplementation(async () => ({
			ok: true,
			json: async () => {
				callCount++;
				return callCount === 1
					? { data: [{ id: 1, estado: 'pendiente' }] }
					: { data: [{ id: 1, estado: 'asignado' }] };
			}
		}));

		suscribirCambios({
			tabla: 'pedidos',
			onCambio
		});

		await vi.advanceTimersByTimeAsync(30_000);

		expect(onCambio).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: 'UPDATE' })
		);
	});

	test('NO dispara onCambio en el primer poll (no hay datos previos)', async () => {
		const onCambio = vi.fn();
		mockApiFetchFn.mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: 1 }] }) });

		suscribirCambios({
			tabla: 'pedidos',
			onCambio
		});

		await vi.advanceTimersByTimeAsync(15_000);

		expect(onCambio).not.toHaveBeenCalled();
	});

	test('cleanup cancela el polling', async () => {
		const onCambio = vi.fn();
		mockApiFetchFn.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });

		const limpiar = suscribirCambios({
			tabla: 'pedidos',
			onCambio
		});

		limpiar();

		await vi.advanceTimersByTimeAsync(60_000);
		expect(mockApiFetchFn).not.toHaveBeenCalled();
	});

	test('errores de red se ignoran silenciosamente', async () => {
		mockApiFetchFn.mockRejectedValue(new Error('Network error'));

		expect(() => {
			suscribirCambios({
				tabla: 'pedidos',
				onCambio: vi.fn()
			});
		}).not.toThrow();

		await vi.advanceTimersByTimeAsync(15_000);
	});

	test('polling fallido no rompe el siguiente intento', async () => {
		let callCount = 0;
		mockApiFetchFn.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) throw new Error('Timeout');
			return { ok: true, json: async () => ({ data: [] }) };
		});

		suscribirCambios({
			tabla: 'pedidos',
			onCambio: vi.fn()
		});

		await vi.advanceTimersByTimeAsync(30_000);

		expect(mockApiFetchFn).toHaveBeenCalledTimes(2);
	});
});

// ── Tablas con endpoint de polling ──────────────────────────────────────────

describe('suscribirCambios — endpoints de polling por tabla', () => {
	beforeEach(() => {
		nativePlatformRef.value = true;
	});

	test('pedidos → /api/pedidos', async () => {
		mockApiFetchFn.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });

		suscribirCambios({ tabla: 'pedidos', onCambio: vi.fn() });
		await vi.advanceTimersByTimeAsync(15_000);

		expect(mockApiFetchFn).toHaveBeenCalledWith('/api/pedidos', expect.anything());
	});

	test('domiciliarios → /api/domiciliarios', async () => {
		mockApiFetchFn.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });

		suscribirCambios({ tabla: 'domiciliarios', onCambio: vi.fn() });
		await vi.advanceTimersByTimeAsync(15_000);

		expect(mockApiFetchFn).toHaveBeenCalledWith('/api/domiciliarios', expect.anything());
	});

	test('notificaciones → /api/notificaciones', async () => {
		mockApiFetchFn.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });

		suscribirCambios({ tabla: 'notificaciones', onCambio: vi.fn() });
		await vi.advanceTimersByTimeAsync(15_000);

		expect(mockApiFetchFn).toHaveBeenCalledWith('/api/notificaciones', expect.anything());
	});

	test('tabla sin endpoint conocido → marca conectado sin polling', () => {
		const onEstado = vi.fn();

		suscribirCambios({
			tabla: 'pedido_eventos',
			onCambio: vi.fn(),
			onEstado
		});

		expect(onEstado).toHaveBeenCalledWith('conectado');
		expect(mockApiFetchFn).not.toHaveBeenCalled();
	});
});

// ── Web: Supabase Realtime (WebSocket) ──────────────────────────────────────

describe('suscribirCambios — Web (Supabase Realtime WebSocket)', () => {
	beforeEach(() => {
		nativePlatformRef.value = false;
	});

	test('crea un canal y se suscribe', () => {
		suscribirCambios({
			tabla: 'pedidos',
			onCambio: vi.fn()
		});

		expect(mockSupabaseBrowserObj.channel).toHaveBeenCalledWith(
			expect.stringMatching(/^cambios-pedidos-/)
		);
		expect(mockSupabaseChannelObj.on).toHaveBeenCalledWith(
			'postgres_changes',
			expect.objectContaining({
				event: '*',
				schema: 'public',
				table: 'pedidos'
			}),
			expect.any(Function)
		);
		expect(mockSupabaseChannelObj.subscribe).toHaveBeenCalled();
	});

	test('cleanup remueve el canal', () => {
		const limpiar = suscribirCambios({
			tabla: 'pedidos',
			onCambio: vi.fn()
		});

		limpiar();

		expect(mockSupabaseBrowserObj.removeChannel).toHaveBeenCalledWith(mockSupabaseChannelObj);
	});

	test('filtro se aplica correctamente', () => {
		suscribirCambios({
			tabla: 'pedidos',
			filtro: { domiciliario_id: 'uuid-123' },
			onCambio: vi.fn()
		});

		expect(mockSupabaseChannelObj.on).toHaveBeenCalledWith(
			'postgres_changes',
			expect.objectContaining({
				filter: 'domiciliario_id=eq.uuid-123'
			}),
			expect.any(Function)
		);
	});

	test('evento específico se pasa al canal', () => {
		suscribirCambios({
			tabla: 'pedidos',
			evento: 'INSERT',
			onCambio: vi.fn()
		});

		expect(mockSupabaseChannelObj.on).toHaveBeenCalledWith(
			'postgres_changes',
			expect.objectContaining({ event: 'INSERT' }),
			expect.any(Function)
		);
	});

	test('onEstado se llama con los estados correctos', () => {
		const onEstado = vi.fn();

		suscribirCambios({
			tabla: 'pedidos',
			onCambio: vi.fn(),
			onEstado
		});

		const subscribeCb = mockSupabaseChannelObj.subscribe.mock.calls[0][0];

		subscribeCb('SUBSCRIBED');
		expect(onEstado).toHaveBeenCalledWith('conectado');

		subscribeCb('CHANNEL_ERROR');
		expect(onEstado).toHaveBeenCalledWith('desconectado');

		subscribeCb('TIMED_OUT');
		expect(onEstado).toHaveBeenCalledWith('desconectado');

		subscribeCb('JOINING');
		expect(onEstado).toHaveBeenCalledWith('conectando');
	});

	test('NO usa apiFetch (no polling en web)', async () => {
		suscribirCambios({
			tabla: 'pedidos',
			onCambio: vi.fn()
		});

		expect(mockApiFetchFn).not.toHaveBeenCalled();
	});
});

// ── Debounce ─────────────────────────────────────────────────────────────────

describe('debounce — utilidad de retraso', () => {
	test('retrasa la llamada', async () => {
		const { debounce } = await import('$lib/realtime');
		const fn = vi.fn();
		const debounced = debounce(fn, 300);

		debounced();
		expect(fn).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(300);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	test('múltiples llamadas rápidas solo ejecutan la última', async () => {
		const { debounce } = await import('$lib/realtime');
		const fn = vi.fn();
		const debounced = debounce(fn, 300);

		debounced('a');
		debounced('b');
		debounced('c');

		await vi.advanceTimersByTimeAsync(300);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith('c');
	});
});
