import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { calcularTarifa } from '$lib/server/tarifas';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const barrioOrigen = String(body?.barrio_origen ?? '').trim();
	const barrioDestino = String(body?.barrio_destino ?? '').trim();
	if (!barrioOrigen || !barrioDestino) {
		return json({ error: 'Faltan barrio_origen o barrio_destino' }, { status: 400 });
	}

	const resultado = await calcularTarifa(barrioOrigen, barrioDestino);
	return json({ data: resultado.valor, meta: resultado.meta });
};
