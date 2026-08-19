import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser } from '$lib/server/supabase';
import { requireRol } from '$lib/server/auth';

/**
 * GET /api/push/estado — requiere sesión con rol.
 *
 * Devuelve si el usuario tiene un token de push nativo registrado.
 */
export const GET: RequestHandler = async (event) => {
	const { sesion } = await requireRol(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const { data, error: err } = await db
		.from('push_subscriptions')
		.select('id')
		.eq('usuario_id', sesion.user.id)
		.limit(1);

	if (err) return json({ error: err.message }, { status: 500 });
	return json({ data: { tiene_token: (data?.length ?? 0) > 0 } });
};
