import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAnon } from '$lib/server/supabase';
import { validarMotivoCancelacion } from '$lib/logic/validacion';

/**
 * POST /api/pedidos/cancelar — cancela un pedido PENDIENTE por código
 * (público, sin autenticación: el código es la credencial del cliente).
 *
 * La validación (pedido existe, sigue en 'pendiente', motivo opcional) y
 * el registro en historial_estados ocurren en el RPC cancelar_pedido_cliente
 * (SECURITY DEFINER) dentro de la BD.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const numero = String(body?.numero ?? '').trim().toUpperCase();
	const motivo = String(body?.motivo ?? '').trim() || null;

	if (!numero) {
		return json({ error: 'Falta el código del pedido.' }, { status: 400 });
	}
	if (motivo) {
		const errMotivo = validarMotivoCancelacion(motivo);
		if (errMotivo) return json({ error: errMotivo }, { status: 400 });
	}

	const { data, error: err } = await getSupabaseAnon().rpc('cancelar_pedido_cliente', {
		p_numero: numero,
		p_motivo: motivo
	});
	if (err) return json({ error: err.message }, { status: 400 });
	return json({ data });
};
