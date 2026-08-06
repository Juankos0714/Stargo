import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser } from '$lib/server/supabase';
import { requireRol } from '$lib/server/auth';
import { ESTADOS_PEDIDO, type EstadoPedido } from '$lib/types';

/**
 * POST /api/pedidos/[id]/estado — cambia el estado de un pedido.
 *
 * Permite a administradores (cancelar) y al domiciliario asignado
 * (aceptar → recogido → en camino → entregado). Toda la validación
 * de rol, propiedad y transiciones ocurre en la BD dentro del RPC
 * transicionar_pedido (SECURITY DEFINER), que además registra cada
 * cambio en historial_estados.
 */
export const POST: RequestHandler = async (event) => {
	const { sesion } = await requireRol(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const { id } = event.params;
	const body = await event.request.json().catch(() => ({}));
	const nuevoEstado = String(body?.estado ?? '').trim() as EstadoPedido;
	const notas = String(body?.notas ?? '').trim() || null;

	if (!Object.hasOwn(ESTADOS_PEDIDO, nuevoEstado)) {
		return json({ error: 'Estado inválido.' }, { status: 400 });
	}
	if (notas && notas.length > 500) {
		return json({ error: 'La nota es demasiado larga (máx. 500 caracteres).' }, { status: 400 });
	}

	const { data, error: err } = await db.rpc('transicionar_pedido', {
		p_pedido_id: id,
		p_estado: nuevoEstado,
		p_nota: notas
	});
	if (err) return json({ error: err.message }, { status: 400 });
	return json({ data });
};
