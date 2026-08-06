import * as Sentry from '@sentry/sveltekit';
import type { HandleClientError } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { browser } from '$app/environment';

/**
 * Sentry del lado del cliente (Parte 9). Se activa solo con PUBLIC_SENTRY_DSN.
 * Se lee con $env/dynamic/public (no static) porque la variable es OPCIONAL:
 * si no está en el .env, el typecheck y el build no fallan.
 */
const SENTRY_DSN = env.PUBLIC_SENTRY_DSN ?? '';
const SENTRY_ACTIVO = Boolean(SENTRY_DSN);
if (SENTRY_ACTIVO) {
	Sentry.init({
		dsn: SENTRY_DSN,
		tracesSampleRate: 0.1,
		environment: import.meta.env.MODE
	});
}

/**
 * Errores de JS no manejados y promesas rechazadas sin catch: se reportan a
 * /api/errores (errores_app) para el dashboard y las alertas, incluso sin
 * Sentry. Con throttle para no inundar la API en bucles de error.
 */
if (browser && !SENTRY_ACTIVO) {
	let ultimoEnvio = 0;
	const MIN_MS = 5000;

	function reportar(tipo: string, detalle: string) {
		const ahora = Date.now();
		if (ahora - ultimoEnvio < MIN_MS) return;
		ultimoEnvio = ahora;
		const mensaje = (detalle ?? '').slice(0, 900) || tipo;
		fetch('/api/errores', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ origen: 'cliente', tipo, mensaje, ruta: location.pathname })
		}).catch(() => {
			/* best-effort */
		});
	}

	window.addEventListener('error', (e) => {
		reportar('unhandled', e.message || 'Error de JS no manejado');
	});
	window.addEventListener('unhandledrejection', (e) => {
		reportar('promesa', e.reason instanceof Error ? e.reason.message : String(e.reason));
	});
}

/**
 * Errores de load/acciones de SvelteKit en el cliente: a Sentry (si está
 * activo) y, además, a errores_app vía /api/errores. `handleErrorWithSentry`
 * sin DSN se comporta como un passthrough del handler original, así que se
 * puede envolver siempre.
 */
export const handleError: HandleClientError = Sentry.handleErrorWithSentry(
	async ({ error, message, event }) => {
		const msj = message ?? (error instanceof Error ? error.message : String(error));
		await registrarCliente(msj, event.url.pathname);
		return { message: msj };
	}
);

async function registrarCliente(mensaje: string, ruta: string) {
	try {
		await fetch('/api/errores', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ origen: 'cliente', tipo: 'error', mensaje, ruta })
		});
	} catch {
		/* best-effort */
	}
}
