import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser } from '$lib/server/supabase';
import { requireAdmin } from '$lib/server/auth';
import { registrarError } from '$lib/server/errores';

/**
 * POST /api/alertas/probar — solo admin.
 *
 * Parte del entregable de la Parte 9: «provocar un error a propósito en
 * staging y confirmar que la alerta llega». Este endpoint:
 *   1. registra un error tipo `test` en errores_app (visible en el dashboard
 *      de métricas);
 *   2. responde 500 a propósito → hooks.server lo captura (Sentry + rate de
 *      5xx para las alertas).
 *
 * Tras llamarlo: el error debe aparecer en Sentry (Issues) y la tasa de 5xx
 * del dashboard debe subir. Si además corres /api/cron/alertas?prueba=1, el
 * webhook recibe la alerta de prueba.
 */
export const POST: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const mensaje = 'Error provocado a propósito desde /api/alertas/probar (verificación de alertas).';
	await registrarError({ origen: 'servidor', tipo: 'test', mensaje, ruta: '/api/alertas/probar' }, db);

	// 500 a propósito: lo captura hooks.server.handleError → Sentry + 5xx.
	return json(
		{ error: mensaje, data: null },
		{ status: 500, headers: { 'Cache-Control': 'no-store' } }
	);
};
