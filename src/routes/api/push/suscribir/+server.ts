import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser } from '$lib/server/supabase';
import { requireRol } from '$lib/server/auth';

/**
 * POST /api/push/suscribir — requiere sesión con rol (admin o domiciliario).
 *
 * Guarda (upsert) la suscripción Web Push del usuario autenticado en
 * push_subscriptions. RLS limita la escritura a la fila propia
 * (usuario_id = auth.uid()); aquí se le pasa explícitamente el id para que
 * el upsert con ON CONFLICT no choque con la política.
 */
export const POST: RequestHandler = async (event) => {
	const { sesion } = await requireRol(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const body = await event.request.json().catch(() => ({}));
	const endpoint = String(body?.endpoint ?? '').trim();
	const p256dh = String(body?.p256dh ?? '').trim();
	const auth = String(body?.auth ?? '').trim();

	if (!/^https?:\/\//.test(endpoint) || endpoint.length > 2048) {
		return json({ error: 'El endpoint no es válido.' }, { status: 400 });
	}
	if (!p256dh || p256dh.length > 512) {
		return json({ error: 'Falta la clave pública (p256dh).' }, { status: 400 });
	}
	if (!auth || auth.length > 512) {
		return json({ error: 'Falta el secreto de autenticación (auth).' }, { status: 400 });
	}

	const { error: err } = await db.from('push_subscriptions').upsert(
		{ usuario_id: sesion.user.id, endpoint, p256dh, auth },
		{ onConflict: 'usuario_id,endpoint' }
	);
	if (err) return json({ error: err.message }, { status: 500 });
	return json({ data: { suscrito: true } });
};
