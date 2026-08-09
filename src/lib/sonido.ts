/**
 * Sonido de notificación en primer plano (Web Audio API).
 *
 * Cuando la app está abierta, Chrome/Android/iOS silencian el sonido del
 * sistema de las notificaciones push de pestañas con foco. Este helper
 * sintetiza una CAMPANA «ding-dong» (Mi5 → La5) con la misma firma sonora
 * que static/sonidos/notificacion.wav, para que la app suene igual abierta
 * o cerrada.
 *
 * Timbre de campana: fundamental + parciales inharmónicas con decaimiento
 * exponencial — las agudas se apagan antes que la fundamental. Ataque rápido
 * (~3 ms) y normalización al 92 % del pico: FUERTE pero sin recorte.
 *
 * Se llama desde CentroNotificaciones cuando Realtime detecta un INSERT en
 * `notificaciones`.
 *
 * iOS Safari (16.4+):
 *  - Crea el AudioContext en estado `suspended` y SOLO permite `resume()`
 *    dentro de un gesto (tap/touch/keydown).
 *  - Vuelve a suspender el contexto cuando la app pasa a segundo plano (o
 *    la pantalla se bloquea), así que un desbloqueo ÚNICO no basta.
 * Por eso aquí:
 *  - Los gestos intentan `resume()` SIEMPRE (no una sola vez): si iOS
 *    re-suspendió el contexto, el siguiente toque lo vuelve a desbloquear.
 *  - Si una notificación llega con el contexto suspendido (antes del primer
 *    gesto, o tras volver de segundo plano), la campana queda PENDIENTE y
 *    suena en cuanto el contexto se reanude.
 *  - Al volver la app a primer plano (visibilitychange) se reintenta.
 *
 * Uso responsable:
 *  - Un ÚNICO AudioContext compartido (los navegadores limitan los contextos
 *    activos; crear uno por llamada agotaría el cupo en ráfagas).
 *  - Cooldown de 2 s: la campana tiene cola larga (1.6 s); una ráfaga de
 *    pedidos no debe solapar campanas.
 */

let contexto: AudioContext | null = null;
let ultimoToque = 0;
/** Campana diferida: llegó con el contexto suspendido, suena al reanudar. */
let pendiente = false;

// Misma firma que scripts/generar_sonido_notificacion.py (mantener en sintonía).
// Se exportan para que tests/sonido.test.ts verifique la sintonía con el script.
export const NOTAS: [frecuencia: number, retraso: number][] = [
	[659.26, 0.0], // Mi5 — «ding»
	[880.0, 0.3] // La5 — «dong»
];
// (multiplicador de la fundamental, amplitud, constante de decaimiento en s)
export const PARCIALES: [multiplicador: number, amplitud: number, tau: number][] = [
	[1.0, 1.0, 0.55], // fundamental: la más larga y presente
	[2.0, 0.5, 0.28], // octava: cuerpo brillante
	[2.76, 0.22, 0.15], // parcial de campana (tercera menor)
	[4.9, 0.07, 0.08] // brillo metálico, muy corto
];
export const ATAQUE = 0.003; // s de rampa de entrada (golpe sin clic)
export const DURACION = 1.6; // s hasta apagar los osciladores (cola incluida)
// Normalización al 92 % del pico (igual que el WAV): pico crudo ≈ 2.11.
export const MASTER = 0.43;
// Cola larga: 2 s de cooldown evita que ráfagas solapen campanas.
export const COOLDOWN = 2000;

function obtenerContexto(): AudioContext | null {
	if (contexto) return contexto;
	const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!Ctx) return null;
	contexto = new Ctx();
	return contexto;
}

/**
 * Desbloquea el AudioContext y reproduce la campana pendiente si la había.
 *
 * iOS Safari crea el AudioContext en estado `suspended` y SOLO permite
 * `resume()` dentro de un gesto (tap/touch). Como las notificaciones llegan
 * por Realtime (sin gesto), sin este paso la campana nunca sonaría en el
 * móvil. Además, iOS re-suspende el contexto al pasar a segundo plano, así
 * que este desbloqueo se intenta en CADA gesto (idempotente) y al volver a
 * primer plano: si el contexto ya corre no hace nada; si está suspendido lo
 * reanuda y, si había una campana pendiente, suena en ese momento.
 */
export function desbloquearAudio(): void {
	try {
		const ctx = obtenerContexto();
		if (!ctx) return;
		if (ctx.state === 'running') {
			if (pendiente) {
				pendiente = false;
				reproducir(ctx);
			}
			return;
		}
		// Suspendido: reanudar DENTRO de este gesto (requisito de iOS). Al
		// completar, si llegó una campana mientras estaba suspendido, suena.
		void ctx
			.resume()
			.then(() => {
				if (ctx.state === 'running' && pendiente) {
					pendiente = false;
					reproducir(ctx);
				}
			})
			.catch(() => {
				// El navegador denegó la reanudación: se conserva la pendiente
				// para el siguiente gesto.
			});
	} catch {
		// Sin soporte de audio: silencio.
	}
}

// En el navegador, CADA gesto intenta desbloquear el audio (iOS re-suspende
// el contexto al ir a segundo plano; un desbloqueo único no alcanza). El
// guard de `window` permite importar el módulo en node (tests) sin efectos.
if (typeof window !== 'undefined') {
	const GESTOS = ['pointerdown', 'touchstart', 'keydown', 'pointerup'] as const;
	GESTOS.forEach((g) => window.addEventListener(g, () => desbloquearAudio(), { passive: true }));

	// Al volver de segundo plano (p. ej. tras leer una notificación) iOS
	// puede haber suspendido el contexto: se reintenta reanudar.
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') desbloquearAudio();
	});
}

/** Reproduce la campana. Requiere un contexto en estado `running`. */
function reproducir(ctx: AudioContext): void {
	// El cooldown mide el tiempo desde que la campana SONÓ (no desde que llegó
	// la notificación): si una campana quedó pendiente y suena minutos después,
	// una notificación nueva no debe solaparse con su cola. Es la única fuente
	// de verdad para `ultimoToque` (camino directo y diferido).
	ultimoToque = Date.now();

	// Refuerzo háptico SOLO en táctiles: la campana se acompaña de una
	// vibración corta (el usuario pidió un aviso fuerte; iOS no la soporta,
	// Android sí). En desktop es no-op, así que no molesta.
	if ('ontouchstart' in window && 'vibrate' in navigator) {
		navigator.vibrate(120);
	}

	// Ganancia maestra: normaliza la mezcla al pico del WAV (0.92).
	const master = ctx.createGain();
	master.gain.value = MASTER;
	master.connect(ctx.destination);
	// Cada llamada crea su propio subgrafo; se desconecta al terminar la
	// cola para no acumular nodos muertos en el contexto compartido.
	window.setTimeout(() => master.disconnect(), (DURACION + 0.5) * 1000);

	for (const [f, retraso] of NOTAS) {
		const inicio = ctx.currentTime + retraso;
		// La cola es la misma que en el WAV: cada nota decae DURACION - retraso
		// (la segunda nota no se alarga más que la primera).
		const fin = inicio + (DURACION - retraso);
		for (const [mult, amp, tau] of PARCIALES) {
			const osc = ctx.createOscillator();
			const g = ctx.createGain();
			osc.type = 'sine';
			osc.frequency.setValueAtTime(f * mult, inicio);
			// Ataque lineal rápido; después decaimiento exponencial (tau).
			g.gain.setValueAtTime(0.0001, inicio);
			g.gain.exponentialRampToValueAtTime(amp, inicio + ATAQUE);
			g.gain.setTargetAtTime(0.0001, inicio + ATAQUE, tau);
			osc.connect(g).connect(master);
			osc.start(inicio);
			osc.stop(fin);
		}
	}
}

/** Reproduce la campana ding-dong. No lanza: falla silencioso. */	export function sonarNotificacion(): void {
		try {
			// Cooldown: evita que una ráfaga de notificaciones solape campanas.
			// El marcado de tiempo se hace en reproducir() (cuando la campana
			// suena de verdad, no cuando llega la notificación).
			if (Date.now() - ultimoToque < COOLDOWN) return;

			const ctx = obtenerContexto();
		if (!ctx) return;
		// Si aún está suspendido (p. ej. la notificación llegó antes del primer
		// gesto, o iOS lo re-suspendió al ir a segundo plano), en iOS el resume
		// SOLO completa dentro de un gesto: se difiere la campana y se intenta
		// reanudar; sonará en cuanto el usuario toque la pantalla.
		if (ctx.state !== 'running') {
			pendiente = true;
			void ctx.resume().catch(() => {});
			return;
		}
		reproducir(ctx);
	} catch {
		// Sin soporte de audio o bloqueado por el navegador: silencio.
	}
}

/**
 * Limpia el estado compartido. Solo lo usan los tests para aislar cada caso;
 * en producción el contexto dura lo que la visita (reanudable en cada gesto).
 */
export function resetearSonido(): void {
	contexto = null;
	ultimoToque = 0;
	pendiente = false;
}
