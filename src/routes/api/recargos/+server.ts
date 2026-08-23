import { json, type RequestHandler } from '@sveltejs/kit';
import { manejarTabla } from '$lib/server/crud';
import { getSupabaseAnon } from '$lib/server/supabase';

/**
 * CRUD de recargos (Fase 7):
 *   GET    /api/recargos             → lectura pública (?select=, ?orden=, ?filtro=col=val)
 *   POST   /api/recargos             → solo admin ({ op:'insert'|'upsert', filas:[...] })
 *   PUT    /api/recargos?filtro=codigo=x → solo admin ({ datos:{...} })
 *   DELETE /api/recargos?filtro=codigo=x → solo admin
 *
 * GET excluye recargos con valor negativo o nombre vacío (datos corruptos
 * de pruebas anteriores; la migración CHECK puede no haberse ejecutado).
 */
export const GET: RequestHandler = async (event) => {
	const url = new URL(event.request.url);
	const select = url.searchParams.get('select') ?? '*';
	const orden = url.searchParams.get('orden');
	let q: any = getSupabaseAnon().from('recargos').select(select).gte('valor', 0);
	if (orden) q = q.order(orden);
	const { data, error: err } = await q;
	if (err) return json({ error: err.message }, { status: 500 });
	// Excluir entradas con nombre vacío o solo espacios.
	const filtrados = (data ?? []).filter((r: any) => r.nombre?.trim());
	return json({ data: filtrados });
};
export const POST: RequestHandler = (event) => manejarTabla('recargos', event);
export const PUT: RequestHandler = (event) => manejarTabla('recargos', event);
export const DELETE: RequestHandler = (event) => manejarTabla('recargos', event);
