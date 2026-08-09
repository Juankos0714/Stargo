import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser } from '$lib/server/supabase';
import { requireRol } from '$lib/server/auth';

/**
 * GET /api/notificaciones — no leídas del usuario autenticado.
 * RLS (notificaciones_propias_select) limita la consulta a sus filas.
 */
export const GET: RequestHandler = async (event) => {
	const { sesion } = await requireRol(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const { data, error: err } = await db
		.from('notificaciones')
		.select('id, tipo, titulo, cuerpo, pedido_id, created_at')
		.eq('leida', false)
		.order('created_at', { ascending: false })
		.limit(30);
	if (err) return json({ error: err.message }, { status: 500 });
	return json({ data: data ?? [] });
};

/**
 * PUT /api/notificaciones — marca como leídas las ids enviadas.
 * Body: { ids: number[] }. RLS valida que sean del propio usuario.
 */
export const PUT: RequestHandler = async (event) => {
	const { sesion } = await requireRol(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const body = await event.request.json().catch(() => ({}));
	const ids = Array.isArray(body?.ids)
		? (body.ids as unknown[]).map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)
		: [];
	if (ids.length === 0) {
		return json({ error: 'Envía al menos un id de notificación.' }, { status: 400 });
	}
	if (ids.length > 100) {
		return json({ error: 'Demasiadas notificaciones a la vez (máx. 100).' }, { status: 400 });
	}

	const { error: err } = await db
		.from('notificaciones')
		.update({ leida: true })
		.in('id', ids);
	if (err) return json({ error: err.message }, { status: 500 });
	return json({ data: { actualizadas: ids.length } });
};
