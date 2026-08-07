/**
 * Captura global del evento `beforeinstallprompt` (PWA).
 *
 * Chrome/Edge disparan el evento poco después de cargar la página, en cuanto
 * comprueban que la app es instalable (HTTPS + manifest + service worker
 * activo). El problema en SvelteKit: si la hidratación es lenta (móvil, red
 * mala), el evento llega ANTES de que <BotonInstalar> monte sus listeners y
 * se pierde para siempre → nunca aparece la opción de instalar.
 *
 * Este módulo registra el listener en cuanto se ejecuta el bundle del cliente
 * (antes de hidratar la app) y guarda el evento; el componente lo consume
 * después mediante `obtenerEventoInstalacion()` / `suscribirseInstalacion()`.
 */

export interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let evento: BeforeInstallPromptEvent | null = null;
let instalada = false;

type Listener = (evt: BeforeInstallPromptEvent | null) => void;
const listeners = new Set<Listener>();

function notificar() {
	listeners.forEach((fn) => fn(evento));
}

if (typeof window !== 'undefined') {
	window.addEventListener('beforeinstallprompt', (e) => {
		// Suprime el infobar automático de Chrome: el botón propio lo sustituye
		// (también en desktop, donde el evento también existe).
		e.preventDefault();
		evento = e as BeforeInstallPromptEvent;
		notificar();
	});

	window.addEventListener('appinstalled', () => {
		instalada = true;
		evento = null;
		notificar();
	});
}

/** Evento capturado (si Chrome/Edge lo ha disparado y aún no se ha usado). */
export function obtenerEventoInstalacion(): BeforeInstallPromptEvent | null {
	return evento;
}

/** ¿La app ya quedó instalada en este navegador? */
export function estaInstalada(): boolean {
	return instalada;
}

/**
 * Invalida el evento guardado: el diálogo nativo de instalación solo puede
 * abrirse una vez por evento (si el usuario lo descarta, volverá a aparecer
 * la opción en una visita posterior).
 */
export function limpiarEventoInstalacion(): void {
	evento = null;
	notificar();
}

/** Suscripción a cambios del evento/estado. Devuelve la función de cancelación. */
export function suscribirseInstalacion(fn: Listener): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

/**
 * Reinicia el estado capturado. Solo lo usan los tests para aislar cada caso;
 * en producción no hay nada que limpiar (el estado dura lo que la visita).
 */
export function resetearEstadoInstalacion(): void {
	evento = null;
	instalada = false;
	notificar();
}
