import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser } from '$lib/server/supabase';
import { requireAdmin } from '$lib/server/auth';

export const POST: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const { id } = event.params;
	const body = await event.request.json().catch(() => ({}));
	const domiciliarioId = String(body?.domiciliario_id ?? '').trim();
	if (!domiciliarioId) {
		return json({ error: 'Falta el domiciliario.' }, { status: 400 });
	}

	// La validación (rol admin, domiciliario activo, pedido pendiente y el
	// registro en historial_estados) ocurre dentro del RPC en la BD.
	const { data, error: err } = await db.rpc('asignar_domiciliario', {
		p_pedido_id: id,
		p_domiciliario_id: domiciliarioId
	});
	if (err) return json({ error: err.message }, { status: 400 });
	return json({ data });
};
