import type { RequestHandler } from './$types';
import { getSupabaseAnon, getSupabaseAsUser } from '$lib/server/supabase';
import { requireAdmin } from '$lib/server/auth';
import { obtenerPedidosReporte, pedidosACsv } from '$lib/server/reportes';

/**
 * GET /api/reportes/csv?desde=YYYY-MM-DD&hasta=YYYY-MM-DD — solo admin.
 *
 * Descarga los pedidos del rango como CSV (BOM UTF-8 para Excel). La
 * autenticación viaja en las cookies de la sesión, igual que en el resto
 * de la API.
 */
export const GET: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const url = new URL(event.request.url);
	const desde = url.searchParams.get('desde');
	const hasta = url.searchParams.get('hasta');

	let resultado: Awaited<ReturnType<typeof obtenerPedidosReporte>>;
	try {
		resultado = await obtenerPedidosReporte(db, getSupabaseAnon(), desde, hasta);
	} catch (e) {
		return new Response(e instanceof Error ? e.message : 'Rango inválido.', { status: 400 });
	}

	const csv = `\uFEFF${pedidosACsv(resultado.pedidos)}`;
	const nombre = `reporte_pedidos_${resultado.rango.desde ?? 'inicio'}_${resultado.rango.hasta ?? 'hoy'}.csv`;

	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${nombre}"`
		}
	});
};
