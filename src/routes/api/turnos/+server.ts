import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser } from '$lib/server/supabase';
import { requireDomiciliario } from '$lib/server/auth';

/**
 * GET /api/turnos — turno activo del domiciliario actual.
 * POST /api/turnos — iniciar turno (body: { base_declarada }).
 * PUT /api/turnos — finalizar turno activo.
 */

// ---------- GET: turno activo ----------
export const GET: RequestHandler = async (event) => {
	const sesion = await requireDomiciliario(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const { data, error: err } = await db.rpc('turno_activo');
	if (err) return json({ error: err.message }, { status: 400 });
	return json({ data });
};

// ---------- POST: iniciar turno ----------
export const POST: RequestHandler = async (event) => {
	const sesion = await requireDomiciliario(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const body = await event.request.json().catch(() => ({}));
	const baseDeclarada = Number(body?.base_declarada);

	if (!Number.isFinite(baseDeclarada) || baseDeclarada < 0) {
		return json(
			{ error: 'La base declarada debe ser un número mayor o igual a 0.' },
			{ status: 400 }
		);
	}
	if (baseDeclarada > 10_000_000) {
		return json(
			{ error: 'La base declarada es demasiado alta (máx. $10.000.000).' },
			{ status: 400 }
		);
	}

	const { data, error: err } = await db.rpc('iniciar_turno', {
		p_base_declarada: baseDeclarada
	});
	if (err) return json({ error: err.message }, { status: 400 });
	return json({ data });
};

// ---------- PUT: finalizar turno ----------
export const PUT: RequestHandler = async (event) => {
	const sesion = await requireDomiciliario(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const { data, error: err } = await db.rpc('finalizar_turno');
	if (err) return json({ error: err.message }, { status: 400 });
	return json({ data });
};
