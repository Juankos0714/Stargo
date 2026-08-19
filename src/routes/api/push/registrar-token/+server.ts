import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser } from '$lib/server/supabase';
import { requireRol } from '$lib/server/auth';

/**
 * POST /api/push/registrar-token — requiere sesión con rol.
 *
 * Guarda (upsert) el device token nativo (FCM para Android, APNs para iOS)
 * en la tabla push_subscriptions. El campo `token` almacena el device token
 * FCM (FCM puede reenviar a APNs para iOS, así que un solo campo sirve
 * para ambas plataformas).
 *
 * Body: { token: string, plataforma: 'android' | 'ios' }
 */
export const POST: RequestHandler = async (event) => {
	const { sesion } = await requireRol(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const body = await event.request.json().catch(() => ({}));
	const token = String(body?.token ?? '').trim();
	const plataforma = String(body?.plataforma ?? '').trim();

	if (!token || token.length > 1024) {
		return json({ error: 'El token no es válido.' }, { status: 400 });
	}
	if (!['android', 'ios'].includes(plataforma)) {
		return json({ error: 'La plataforma debe ser "android" o "ios".' }, { status: 400 });
	}

	// Upsert: si ya existe un registro con el mismo usuario + token, actualiza.
	// Si el usuario tiene un token viejo, lo reemplaza.
	const { error: err } = await db
		.from('push_subscriptions')
		.upsert(
			{
				usuario_id: sesion.user.id,
				token,
				plataforma,
				// Limpiar campos de Web Push que ya no aplican
				endpoint: `native://${plataforma}/${token.slice(0, 20)}`,
				p256dh: '',
				auth: ''
			},
			{ onConflict: 'usuario_id,endpoint' }
		);

	if (err) return json({ error: err.message }, { status: 500 });
	return json({ data: { registrado: true } });
};
