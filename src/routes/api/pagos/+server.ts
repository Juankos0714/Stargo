import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser } from '$lib/server/supabase';
import { requireAdmin } from '$lib/server/auth';
import { redondearComision } from '$lib/logic/comisiones';

/**
 * Abonos de domiciliarios (Fase 10):
 *   POST /api/pagos        → solo admin; { domiciliario_id, valor, nota? }
 *   GET  /api/pagos        → solo admin; ?domiciliario_id= para filtrar
 *
 * La escritura pasa por el RPC registrar_pago_domiciliario (SECURITY
 * DEFINER, valida es_admin) y el abono reduce la deuda del domiciliario.
 */
export const GET: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const url = new URL(event.request.url);
	const domiciliarioId = url.searchParams.get('domiciliario_id');

	let q = db.from('pagos_domiciliarios').select('*').order('created_at', { ascending: false }).limit(200);
	if (domiciliarioId) q = q.eq('domiciliario_id', domiciliarioId);
	const { data, error: err } = await q;
	if (err) return json({ error: err.message }, { status: 500 });
	return json({ data: data ?? [] });
};

export const POST: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const body = await event.request.json().catch(() => ({}));
	const domiciliarioId = String(body?.domiciliario_id ?? '').trim();
	const valor = Number(body?.valor);
	const nota = String(body?.nota ?? '').trim() || null;

	if (!domiciliarioId) {
		return json({ error: 'Falta el domiciliario.' }, { status: 400 });
	}
	if (!Number.isFinite(valor) || valor <= 0) {
		return json({ error: 'El valor del abono debe ser mayor que cero.' }, { status: 400 });
	}
	if (nota && nota.length > 300) {
		return json({ error: 'La nota es demasiado larga (máx. 300 caracteres).' }, { status: 400 });
	}

	const { data, error: err } = await db.rpc('registrar_pago_domiciliario', {
		p_domiciliario_id: domiciliarioId,
		p_valor: redondearComision(valor),
		p_nota: nota
	});
	if (err) return json({ error: err.message }, { status: 400 });
	return json({ data });
};
