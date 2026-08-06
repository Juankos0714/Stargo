import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser } from '$lib/server/supabase';
import { requireAdmin } from '$lib/server/auth';
import { obtenerMetricas } from '$lib/server/metricas';
import type { MetricasDashboard } from '$lib/server/metricas';

/**
 * GET /api/metricas — solo admin.
 *
 * Métricas operativas en tiempo real para el dashboard (Parte 9):
 * pedidos activos, tiempos promedio de asignación/entrega, errores por
 * minuto, últimas alertas y auditoría reciente de tarifas.
 */
export const GET: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	try {
		const metricas: MetricasDashboard = await obtenerMetricas(db);
		return json({ data: metricas });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Error al calcular las métricas.';
		return json({ error: msg }, { status: 400 });
	}
};
