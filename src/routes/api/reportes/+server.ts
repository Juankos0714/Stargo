import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAnon, getSupabaseAsUser } from '$lib/server/supabase';
import { requireAdmin } from '$lib/server/auth';
import { obtenerReporte, validarRango } from '$lib/server/reportes';
import type { Reporte } from '$lib/types';

/**
 * GET /api/reportes?desde=YYYY-MM-DD&hasta=YYYY-MM-DD — solo admin.
 *
 * Devuelve el reporte consolidado del rango (fechas en hora de Bogotá):
 * resumen por estado, ingresos, domiciliarios disponibles, series diarias,
 * desglose por domiciliario y la lista de pedidos del rango.
 */
export const GET: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const url = new URL(event.request.url);
	const desde = url.searchParams.get('desde');
	const hasta = url.searchParams.get('hasta');

	// Solo el rango malformado es un error de cliente (400); los fallos de la
	// consulta (p. ej. una migración pendiente) son del servidor y se reportan
	// con 500 para que no se confundan con un rango inválido.
	if (!validarRango(desde, hasta)) {
		return json({ error: 'Rango de fechas inválido.' }, { status: 400 });
	}
	try {
		const reporte: Reporte = await obtenerReporte(db, getSupabaseAnon(), desde, hasta);
		return json({ data: reporte });
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Error al generar el reporte.';
		return json({ error: msg }, { status: 500 });
	}
};
