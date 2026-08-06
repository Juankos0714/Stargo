import { sequence } from '@sveltejs/kit/hooks';
import * as Sentry from '@sentry/sveltekit';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { registrarError } from '$lib/server/errores';

/**
 * Sentry (Parte 9 — observabilidad). Se activa solo si PUBLIC_SENTRY_DSN
 * está configurado: sin DSN la app funciona exactamente igual (cero envíos),
 * por lo que los tests/CI y los despliegues sin Sentry no se ven afectados.
 * Se lee con $env/dynamic (no static) porque la variable es OPCIONAL: si no
 * está en el .env, el typecheck y el build no fallan.
 */
const SENTRY_DSN = env.PUBLIC_SENTRY_DSN ?? '';
const SENTRY_ACTIVO = Boolean(SENTRY_DSN);
if (SENTRY_ACTIVO) {
	Sentry.init({
		dsn: SENTRY_DSN,
		tracesSampleRate: 0.1,
		environment: process.env.VERCEL_ENV ?? 'development'
	});
}

/**
 * Headers de seguridad básicos.
 *
 * La Content-Security-Policy se configura en vite.config.ts (csp), donde
 * SvelteKit genera un nonce para sus scripts inline de hidratación.
 */
const handleSeguridad: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

	return response;
};

export const handle: Handle = SENTRY_ACTIVO
	? sequence(Sentry.sentryHandle(), handleSeguridad)
	: handleSeguridad;

/**
 * Manejo de errores del servidor:
 *   1. registra en errores_app los 5xx y rate limits (alimenta las alertas
 *      de tasa de errores — Parte 9);
 *   2. si Sentry está activo, captura el error y devuelve su resultado.
 * Nunca lanza: un fallo en el reporte no puede romper la respuesta.
 */
export const handleError: HandleServerError = Sentry.handleErrorWithSentry(
	async ({ error: e, event, status, message }) => {
		const msj = message ?? (e instanceof Error ? e.message : String(e));
		// Detección de rate limit: Supabase responde 429 / mensajes con
		// "rate limit"; el resto de 5xx se cuenta para la tasa de errores.
		const esRateLimit =
			status === 429 ||
			msj.toLowerCase().includes('rate limit') ||
			msj.toLowerCase().includes('429');

		if (status >= 500 || esRateLimit) {
			// Fire-and-forget: registrar el error nunca debe retrasar la
			// respuesta del error (si Supabase está caído, esa llamada
			// fallaría tras su timeout y retrasaría el 500 original).
			void registrarError(
				{
					origen: 'servidor',
					tipo: esRateLimit ? 'rate_limit' : '5xx',
					mensaje: msj,
					ruta: event.url.pathname
				},
				undefined
			);
		}
		return { message: msj };
	}
);
