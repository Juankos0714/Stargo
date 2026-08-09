/**
 * Sonido de notificación en primer plano (Web Audio API).
 *
 * Cuando la app está abierta, Chrome/Android silencian el sonido del sistema
 * de las notificaciones push de pestañas con foco. Este helper sintetiza una
 * CAMPANA «ding-dong» (Mi5 → La5) con la misma firma sonora que
 * static/sonidos/notificacion.wav (el sonido del push del sistema), para que
 * la app suene igual abierta o cerrada.
 *
 * Timbre de campana: fundamental + parciales inharmónicas con decaimiento
 * exponencial — las agudas se apagan antes que la fundamental. Ataque rápido
 * (~3 ms) y normalización al 92 % del pico: FUERTE pero sin recorte.
 *
 * Se llama desde CentroNotificaciones cuando Realtime detecta un INSERT en
 * `notificaciones`. Al ser un gesto indirecto (no un clic), el AudioContext
 * puede nacer en estado `suspended`; por eso se intenta `resume()`.
 *
 * Uso responsable:
 *  - Un ÚNICO AudioContext compartido (los navegadores limitan los contextos
 *    activos; crear uno por llamada agotaría el cupo en ráfagas).
 *  - Cooldown de 2 s: la campana tiene cola larga (1.6 s); una ráfaga de
 *    pedidos no debe solapar campanas.
 */

let contexto: AudioContext | null = null;
let ultimoToque = 0;

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

/** Reproduce la campana ding-dong. No lanza: falla silencioso. */
export function sonarNotificacion(): void {
	try {
		// Cooldown: evita que una ráfaga de notificaciones solape campanas.
		const ahora = Date.now();
		if (ahora - ultimoToque < COOLDOWN) return;
		ultimoToque = ahora;

		const ctx = obtenerContexto();
		if (!ctx) return;
		void ctx.resume();

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
	} catch {
		// Sin soporte de audio o bloqueado por el navegador: silencio.
	}
}
