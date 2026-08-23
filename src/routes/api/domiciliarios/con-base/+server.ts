import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser } from '$lib/server/supabase';
import { requireAdmin } from '$lib/server/auth';

/**
 * GET /api/domiciliarios/con-base — lista domiciliarios activos con su
 * turno activo y base disponible. Solo admin.
 */
export const GET: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const { data, error: err } = await db.rpc('domiciliarios_con_base');
	if (err) return json({ error: err.message }, { status: 500 });
	return json({ data: data ?? [] });
};
