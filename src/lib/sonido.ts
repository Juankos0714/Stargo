/**
 * Sonido de notificación en primer plano (Web Audio API).
 *
 * Cuando la app está abierta, Chrome/Android silencian el sonido del sistema
 * de las notificaciones push de pestañas con foco. Este helper genera un
 * «ding» con el oscilador del navegador — sin archivos de audio ni assets.
 *
 * Se llama desde CentroNotificaciones cuando Realtime detecta un INSERT en
 * `notificaciones`. Al ser un gesto indirecto (no un clic), el AudioContext
 * puede nacer en estado `suspended`; por eso se intenta `resume()`.
 *
 * Uso responsable:
 *  - Un ÚNICO AudioContext compartido (los navegadores limitan los contextos
 *    activos; crear uno por llamada agotaría el cupo en ráfagas).
 *  - Cooldown de 1 s: una ráfaga de pedidos no encola dings superpuestos.
 */

let contexto: AudioContext | null = null;
let ultimoToque = 0;

function obtenerContexto(): AudioContext | null {
	if (contexto) return contexto;
	const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!Ctx) return null;
	contexto = new Ctx();
	return contexto;
}

/** Reproduce un «ding» corto y audible. No lanza: falla silencioso. */
export function sonarNotificacion(): void {
	try {
		// Cooldown: evita que una ráfaga de notificaciones solape sonidos.
		const ahora = Date.now();
		if (ahora - ultimoToque < 1000) return;
		ultimoToque = ahora;

		const ctx = obtenerContexto();
		if (!ctx) return;
		void ctx.resume();

		const duracion = 0.45;
		const t0 = ctx.currentTime;
		// Fundido de entrada casi inmediato y cierre rápido: el pico de volumen
		// se mantiene más tiempo → suena MÁS FUERTE y claro.
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0.0001, t0);
		gain.gain.exponentialRampToValueAtTime(0.55, t0 + 0.005);
		gain.gain.setValueAtTime(0.55, t0 + duracion - 0.06);
		gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duracion);
		gain.connect(ctx.destination);

		// Tres osciladores en paralelo (acorde) dan un «ding-dong» potente:
		// la fundamental + un armónico (3×) con menos ganancia para dar cuerpo
		// sin saturar. Dos tonos consecutivos (mi → la) mejoran la percepción.
		const frecuencias: [number, number][] = [
			[660, t0],
			[880, t0 + 0.19]
		];
		for (const [f, inicio] of frecuencias) {
			const osc = ctx.createOscillator();
			const osc2 = ctx.createOscillator();
			const g2 = ctx.createGain();
			osc.type = 'sine';
			osc.frequency.setValueAtTime(f, inicio);
			osc2.type = 'sine';
			osc2.frequency.setValueAtTime(f * 3, inicio);
			g2.gain.value = 0.3; // armónico de apoyo, más bajo que la fundamental
			osc.connect(gain);
			osc2.connect(g2).connect(gain);
			osc.start(inicio);
			osc.stop(t0 + duracion);
			osc2.start(inicio);
			osc2.stop(t0 + duracion);
		}
	} catch {
		// Sin soporte de audio o bloqueado por el navegador: silencio.
	}
}
