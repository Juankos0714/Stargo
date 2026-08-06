import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser } from '$lib/server/supabase';
import { requireRol } from '$lib/server/auth';
import { transicionar } from '$lib/logic/estado-pedido';
import { ESTADOS_PEDIDO, type EstadoPedido } from '$lib/types';

/**
 * POST /api/pedidos/[id]/estado — cambia el estado de un pedido.
 *
 * Permite a administradores (cancelar) y al domiciliario asignado
 * (aceptar → recogido → en camino → entregado). Se pre-valida la transición
 * con la máquina de estados pura (fail-fast, mismos mensajes que la BD) y
 * la validación final de rol/propiedad/transiciones ocurre en el RPC
 * transicionar_pedido (SECURITY DEFINER), que además registra cada cambio
 * en historial_estados.
 */
export const POST: RequestHandler = async (event) => {
	const { sesion, esAdmin } = await requireRol(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const { id } = event.params;
	const body = await event.request.json().catch(() => ({}));
	const nuevoEstado = String(body?.estado ?? '').trim() as EstadoPedido;
	const notas = String(body?.notas ?? '').trim() || null;
	const motivo = String(body?.motivo ?? '').trim() || null;

	if (!Object.hasOwn(ESTADOS_PEDIDO, nuevoEstado)) {
		return json({ error: 'Estado inválido.' }, { status: 400 });
	}
	if (notas && notas.length > 500) {
		return json({ error: 'La nota es demasiado larga (máx. 500 caracteres).' }, { status: 400 });
	}
	if (motivo && motivo.length > 300) {
		return json({ error: 'El motivo es demasiado largo (máx. 300 caracteres).' }, { status: 400 });
	}

	// Pre-validación con la máquina de estados pura: falla rápido sin tocar
	// Postgres y con los mismos mensajes de la BD. La BD sigue siendo la
	// autoridad final (si el pedido no es visible para el rol, el RPC decide).
	const rol = esAdmin ? 'admin' : 'domiciliario';
	const { data: actual } = await db.from('pedidos').select('estado').eq('id', id).limit(1);
	const estadoActual = (actual?.[0]?.estado as EstadoPedido | undefined) ?? null;
	if (estadoActual) {
		try {
			transicionar(rol, estadoActual, nuevoEstado);
		} catch (e) {
			return json({ error: (e as Error).message }, { status: 400 });
		}
	}

	const { data, error: err } = await db.rpc('transicionar_pedido', {
		p_pedido_id: id,
		p_estado: nuevoEstado,
		p_nota: notas,
		p_motivo: nuevoEstado === 'cancelado' ? motivo : null
	});
	if (err) return json({ error: err.message }, { status: 400 });
	return json({ data });
};
