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

		const duracion = 0.35;
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = 'sine';
		// Dos tonos consecutivos (mi → sol) dan un «ding-dong» más perceptible
		// que un tono único y se distinguen de otras alertas del sistema.
		osc.frequency.setValueAtTime(660, ctx.currentTime);
		osc.frequency.setValueAtTime(880, ctx.currentTime + 0.16);
		gain.gain.setValueAtTime(0.0001, ctx.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duracion);

		osc.connect(gain).connect(ctx.destination);
		osc.start();
		osc.stop(ctx.currentTime + duracion);
	} catch {
		// Sin soporte de audio o bloqueado por el navegador: silencio.
	}
}
