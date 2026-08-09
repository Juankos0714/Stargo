import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { desbloquearAudio, resetearSonido, sonarNotificacion } from '../../src/lib/sonido';

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
	// Limpia el contexto compartido del módulo y el cooldown entre tests.
	resetearSonido();
	FakeAudioContext.instancias = [];
});

afterEach(() => {
	vi.unstubAllGlobals();
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
