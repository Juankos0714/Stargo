import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser } from '$lib/server/supabase';
import { requireAdmin } from '$lib/server/auth';

/**
 * PUT /api/comisiones/config — reacomoda TODA la escalera de comisiones.
 *
 * Llama al RPC reconfigurar_escalera (atómico y validado en SQL con es_admin):
 *   * deja exactamente `niveles` niveles (borra los que sobren, crea los
 *     faltantes con el valor del último nivel vigente),
 *   * el tope de cada nivel pasa a ser nivel × `paso`,
 *   * CONSERVA el valor de cada nivel por posición y nunca toca las
 *     comisiones ya congeladas en pedidos.comision.
 */
export const PUT: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const body = await event.request.json().catch(() => ({}));
	const paso = Math.round(Number(body?.paso));
	const niveles = Math.round(Number(body?.niveles));
	if (!Number.isFinite(paso) || !Number.isFinite(niveles)) {
		return json({ error: 'Envía «paso» y «niveles» como números.' }, { status: 400 });
	}

	// Congela el día con la escalera actual antes de reacomodarla (Fase 18):
	// hoy y los días anteriores conservan la escalera vigente hasta ahora y
	// la nueva configuración aplica desde mañana.
	const { error: errCongelar } = await db.rpc('congelar_comisiones_dia');
	if (errCongelar) return json({ error: errCongelar.message }, { status: 500 });

	const { data, error: err } = await db.rpc('reconfigurar_escalera', {
		p_paso: paso,
		p_niveles: niveles
	});
	if (err) return json({ error: err.message }, { status: 400 });
	return json({ data });
};
