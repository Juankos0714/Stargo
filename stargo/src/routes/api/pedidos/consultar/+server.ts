import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAnon } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ url }) => {
	const numero = String(url.searchParams.get('numero') ?? '').trim().toUpperCase();
	if (!numero) {
		return json({ error: 'Falta el número del pedido.' }, { status: 400 });
	}

	const { data, error: err } = await getSupabaseAnon().rpc('consultar_pedido', { p_numero: numero });
	if (err) {
		return json({ error: err.message }, { status: 500 });
	}
	if (!data) {
		return json({ error: 'No se encontró ningún pedido con ese código.' }, { status: 404 });
	}

	// Resolver nombres de barrios para mostrar al cliente.
	const pedido = data.pedido;
	const ids = [pedido.barrio_origen_id, pedido.barrio_destino_id];
	const r = await getSupabaseAnon().from('barrios').select('id, nombre').in('id', ids);
	const nombres = new Map((r.data ?? []).map((b) => [b.id, b.nombre]));

	return json({
		data: {
			...data,
			pedido: {
				...pedido,
				barrio_origen_nombre: nombres.get(pedido.barrio_origen_id) ?? null,
				barrio_destino_nombre: nombres.get(pedido.barrio_destino_id) ?? null
			}
		}
	});
};
