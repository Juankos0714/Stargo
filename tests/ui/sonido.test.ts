import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import {
	desbloquearAudio,
	fijarVolumenSonido,
	obtenerVolumenSonido,
	previsualizarSonido,
	registrarSonidoSW,
	resetearSonido,
	sonarNotificacion,
	MASTER
} from '../../src/lib/sonido';

/**
 * Sonido en primer plano — comportamiento iOS.
 *
 * jsdom no implementa AudioContext, así que se inyecta un FAKE que replica
 * el comportamiento de iOS Safari:
 *  - Nace en estado `suspended` y `resume()` «funciona» al llamarse dentro
 *    de un gesto (aquí resume siempre completa; lo que se verifica es
 *    CUÁNDO se llama y si la campana suena o queda pendiente).
 *  - Puede volver a `suspended` (iOS re-suspende el contexto al ir a segundo
 *    plano o bloquear la pantalla).
 *
 * El módulo crea el contexto de forma perezosa (obtenerContexto), así que el
 * fake se instala solo en window y los tests toman la instancia creada por el
 * propio módulo. Los gestos se disparan con eventos reales (touchstart) sobre
 * `window`, que es como el módulo los escucha en producción.
 */

class FakeAudioContext {
	static instancias: FakeAudioContext[] = [];
	static estadoInicial: AudioContextState = 'suspended';
	state: AudioContextState = FakeAudioContext.estadoInicial;
	currentTime = 0;
	destination = {};
	resume = vi.fn(() => {
		this.state = 'running';
		return Promise.resolve();
	});
	createGain = vi.fn(() => ({
		gain: {
			value: 0,
			setValueAtTime: vi.fn(),
			exponentialRampToValueAtTime: vi.fn(),
			setTargetAtTime: vi.fn()
		},
		connect: vi.fn(),
		disconnect: vi.fn()
	}));
	createOscillator = vi.fn(() => ({
		type: 'sine',
		frequency: { setValueAtTime: vi.fn() },
		// La campana encadena osc.connect(g).connect(master).
		connect: vi.fn(() => ({
			connect: vi.fn()
		})),
		start: vi.fn(),
		stop: vi.fn()
	}));
	constructor() {
		FakeAudioContext.instancias.push(this);
	}
}

/** Instala el fake en window (el módulo lo instancia de forma perezosa). */
function instalarFake(estadoInicial: AudioContextState = 'suspended') {
	FakeAudioContext.estadoInicial = estadoInicial;
	vi.stubGlobal('AudioContext', FakeAudioContext);
	vi.stubGlobal('webkitAudioContext', undefined);
}

/** La instancia creada por el módulo (siempre es la última del array). */
function obtenerInstancia(): FakeAudioContext {
	const inst = FakeAudioContext.instancias.at(-1);
	if (!inst) throw new Error('El módulo no creó ningún AudioContext');
	return inst;
}

beforeEach(() => {
	// Limpia el contexto compartido del módulo, el cooldown y el volumen.
	resetearSonido();
	fijarVolumenSonido(1);
	window.localStorage.clear();
	FakeAudioContext.instancias = [];
});

afterEach(() => {
	vi.unstubAllGlobals();
});

interface StubSW {
	/** Veces que se llamó a addEventListener (para probar idempotencia). */
	registros: number;
	listeners: Array<(e: MessageEvent) => void>;
	/** Emite un mensaje como si viniera del service worker. */
	emitir(data: unknown): void;
}

/** Stub determinista de navigator.serviceWorker (evita vi.fn anidado). */
function stubServiceWorker(): StubSW {
	const stub: StubSW = {
		registros: 0,
		listeners: [],
		emitir(data) {
			const e = { data } as MessageEvent;
			stub.listeners.forEach((fn) => fn(e));
		}
	};
	const sw = {
		addEventListener: (tipo: string, fn: (e: MessageEvent) => void) => {
			stub.registros++;
			if (tipo === 'message') stub.listeners.push(fn);
		}
	};
	Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
	return stub;
}

describe('sonido.ts — respaldo del service worker (mensaje «sonar»)', () => {
	test('el mensaje del SW reproduce la campana local (respaldo si Realtime está caído)', async () => {
		instalarFake('running');

		const sw = stubServiceWorker();
		registrarSonidoSW();
		expect(sw.registros).toBe(1); // un solo addEventListener('message', …)

		// El SW envía { tipo: 'sonar' } cuando llega un push con la app abierta.
		sw.emitir({ tipo: 'sonar' });

		expect(obtenerInstancia().createOscillator).toHaveBeenCalledTimes(8);
	});

	test('otros mensajes del SW no reproducen sonido', async () => {
		instalarFake('running');
		const sw = stubServiceWorker();
		registrarSonidoSW();

		// Crea el contexto del módulo (un sonido real) y toma la referencia.
		sonarNotificacion();
		const ctx = obtenerInstancia();
		const trasPrimera = ctx.createOscillator.mock.calls.length;
		expect(trasPrimera).toBeGreaterThan(0);

		sw.emitir({ tipo: 'otro' });
		sw.emitir(null);

		expect(ctx.createOscillator.mock.calls.length).toBe(trasPrimera);
	});

	test('registrarSonidoSW es idempotente (un solo listener)', () => {
		instalarFake('running');
		const sw = stubServiceWorker();

		registrarSonidoSW();
		registrarSonidoSW();

		expect(sw.registros).toBe(1);
	});

	test('sin service worker no lanza', () => {
		instalarFake('running');
		// jsdom sin navigator.serviceWorker definido.
		delete (navigator as { serviceWorker?: unknown }).serviceWorker;
		expect(() => registrarSonidoSW()).not.toThrow();
	});
});

describe('sonido.ts — volumen y silencio de la campana local', () => {
	test('volumen 0 (silencio): sonarNotificacion NO crea osciladores', () => {
		instalarFake('running');
		// Crea el contexto del módulo con un sonido real y toma la referencia.
		sonarNotificacion();
		const ctx = obtenerInstancia();
		const trasPrimera = ctx.createOscillator.mock.calls.length;
		expect(trasPrimera).toBeGreaterThan(0);

		fijarVolumenSonido(0);
		sonarNotificacion();

		expect(ctx.createOscillator.mock.calls.length).toBe(trasPrimera);
	});

	test('volumen > 0: la ganancia maestra escala con el volumen (MASTER × volumen)', () => {
		instalarFake('running');
		fijarVolumenSonido(0.5);

		sonarNotificacion();

		const ctx = obtenerInstancia();
		expect(ctx.createOscillator).toHaveBeenCalledTimes(8);
		// El primer nodo creado es la ganancia maestra; su valor debe ser MASTER * 0.5.
		const master = ctx.createGain.mock.results[0]?.value as { gain: { value: number } };
		expect(master.gain.value).toBeCloseTo(MASTER * 0.5, 6);
	});

	test('volumen 1 (por defecto): la campana suena a pleno (MASTER)', () => {
		instalarFake('running');

		sonarNotificacion();

		const ctx = obtenerInstancia();
		const master = ctx.createGain.mock.results[0]?.value as { gain: { value: number } };
		expect(master.gain.value).toBeCloseTo(MASTER, 6);
	});

	test('fijarVolumenSonido persiste en localStorage y obtenerVolumenSonido lo lee', () => {
		fijarVolumenSonido(0.35);
		expect(obtenerVolumenSonido()).toBe(0.35);
		expect(window.localStorage.getItem('stargo_volumen_sonido')).toBe('0.35');
	});

	test('fijarVolumenSonido recorta valores fuera de rango (0..1)', () => {
		fijarVolumenSonido(-1);
		expect(obtenerVolumenSonido()).toBe(0);
		fijarVolumenSonido(2);
		expect(obtenerVolumenSonido()).toBe(1);
		fijarVolumenSonido(Number.NaN);
		expect(obtenerVolumenSonido()).toBe(1);
	});

	test('previsualizarSonido respeta el silencio (volumen 0)', () => {
		instalarFake('running');
		// Crea el contexto del módulo con un sonido real.
		sonarNotificacion();
		const ctx = obtenerInstancia();
		const trasPrimera = ctx.createOscillator.mock.calls.length;
		expect(trasPrimera).toBeGreaterThan(0);

		fijarVolumenSonido(0);
		previsualizarSonido();

		expect(ctx.createOscillator.mock.calls.length).toBe(trasPrimera);
	});

	test('previsualizarSonido con volumen activo reproduce la campana', () => {
		instalarFake('running');
		fijarVolumenSonido(0.8);

		previsualizarSonido();

		expect(obtenerInstancia().createOscillator).toHaveBeenCalledTimes(8);
	});

	test('una campana silenciada no marca el cooldown (la siguiente suena al subir el volumen)', () => {
		instalarFake('running');
		fijarVolumenSonido(0);
		sonarNotificacion();

		// Sube el volumen y suena de inmediato (sin esperar el cooldown).
		fijarVolumenSonido(1);
		sonarNotificacion();

		expect(obtenerInstancia().createOscillator).toHaveBeenCalledTimes(8);
	});
});

describe('sonido.ts — desbloqueo del AudioContext en iOS', () => {
	test('un gesto (touchstart) desbloquea el contexto suspendido y llama resume()', async () => {
		instalarFake();

		window.dispatchEvent(new Event('touchstart'));

		const ctx = obtenerInstancia();
		await vi.waitFor(() => expect(ctx.resume).toHaveBeenCalled());
		expect(ctx.state).toBe('running');
	});

	test('la campana suena de inmediato si el contexto ya estaba desbloqueado', async () => {
		instalarFake('running');

		sonarNotificacion();

		// 2 notas × 4 parciales = 8 osciladores.
		expect(obtenerInstancia().createOscillator).toHaveBeenCalledTimes(8);
	});

	test('una notificación antes del primer gesto queda PENDIENTE y suena al desbloquear', async () => {
		instalarFake();

		// La notificación llega sin gesto previo: no suena aún, solo intenta
		// reanudar (en iOS el resume sin gesto queda pendiente).
		sonarNotificacion();
		const ctx = obtenerInstancia();
		expect(ctx.resume).toHaveBeenCalled();
		expect(ctx.createOscillator).not.toHaveBeenCalled();

		// El primer gesto reanuda y reproduce la campana diferida.
		window.dispatchEvent(new Event('touchstart'));
		await vi.waitFor(() => expect(ctx.createOscillator).toHaveBeenCalled());
		expect(ctx.createOscillator).toHaveBeenCalledTimes(8);
	});

	test('iOS re-suspende al ir a segundo plano: un NUEVO gesto vuelve a desbloquear (regresión {once})', async () => {
		instalarFake();

		// Primer gesto desbloquea.
		window.dispatchEvent(new Event('touchstart'));
		const ctx = obtenerInstancia();
		await vi.waitFor(() => expect(ctx.state).toBe('running'));
		const resumesIniciales = ctx.resume.mock.calls.length;

		// iOS re-suspende el contexto (app en segundo plano, pantalla bloqueada).
		ctx.state = 'suspended';

		// Segundo gesto: con la implementación antigua ({once:true}) los
		// listeners ya estaban consumidos y la campana nunca volvía a sonar.
		window.dispatchEvent(new Event('touchstart'));
		await vi.waitFor(() => expect(ctx.resume.mock.calls.length).toBeGreaterThan(resumesIniciales));
		expect(ctx.state).toBe('running');
	});

	test('al volver a primer plano (visibilitychange) se reintenta reanudar el contexto', async () => {
		instalarFake();

		Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));

		const ctx = obtenerInstancia();
		await vi.waitFor(() => expect(ctx.resume).toHaveBeenCalled());
		expect(ctx.state).toBe('running');
	});

	test('el cooldown evita que una ráfaga de notificaciones solape campanas', async () => {
		instalarFake('running');

		sonarNotificacion();
		const trasPrimera = obtenerInstancia().createOscillator.mock.calls.length;
		expect(trasPrimera).toBeGreaterThan(0);

		// Segunda notificación inmediata: bloqueada por el cooldown.
		sonarNotificacion();
		expect(obtenerInstancia().createOscillator.mock.calls.length).toBe(trasPrimera);
	});

	test('sin soporte de audio no lanza (falla silencioso)', () => {
		// Sin AudioContext en window: obtenerContexto devuelve null y no pasa nada.
		vi.stubGlobal('AudioContext', undefined);
		expect(() => {
			sonarNotificacion();
			desbloquearAudio();
		}).not.toThrow();
	});
});
