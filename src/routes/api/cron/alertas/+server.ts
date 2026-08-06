import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { ejecutarChequeos, type ResultadoChequeos } from '$lib/server/alertas';

/**
 * GET /api/cron/alertas — cron de Vercel (vercel.json).
 *
 * Ejecuta los chequeos de alertas (pedidos sin asignar, tasa 5xx, rate
 * limits, Supabase caído) y notifica por webhook + Sentry + bitácora.
 *
 * Autenticación: Vercel envía `Authorization: Bearer <CRON_SECRET>` a los
 * crons (ver docs). Para compatibilidad también se acepta el header
 * `x-cron-secret` o el query `?secret=...`. Sin CRON_SECRET configurado el
 * endpoint responde 503 (la app sigue funcionando, solo se desactiva el cron).
 *
 * ?prueba=1 — fuerza una alerta de prueba (verifica el entregable sin
 * esperar a que ocurra un fallo real).
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const secretEsperado = env.CRON_SECRET;
	if (!secretEsperado) {
		return json({ error: 'CRON_SECRET no configurado; cron desactivado.' }, { status: 503 });
	}

	const autorizacion = request.headers.get('authorization') ?? '';
	const headerSecret = request.headers.get('x-cron-secret') ?? '';
	const querySecret = url.searchParams.get('secret') ?? '';
	const dado =
		headerSecret ||
		(autorizacion.startsWith('Bearer ') ? autorizacion.slice(7) : '') ||
		querySecret;

	if (!dado || dado !== secretEsperado) {
		throw error(401, 'Secreto de cron inválido.');
	}

	const prueba = url.searchParams.get('prueba') === '1';
	const resultado: ResultadoChequeos = await ejecutarChequeos({ prueba });
	return json({ data: resultado });
};
