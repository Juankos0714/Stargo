import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser } from '$lib/server/supabase';
import { requireAdmin } from '$lib/server/auth';
import type { Domiciliario } from '$lib/types';

// ---------- GET: listar domiciliarios (solo admin) ----------
export const GET: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const url = new URL(event.request.url);
	const soloActivos = url.searchParams.get('activos') === 'true';

	let q = db.from('domiciliarios').select('*').order('nombre');
	if (soloActivos) q = q.eq('activo', true);
	const { data, error: err } = await q;
	if (err) return json({ error: err.message }, { status: 500 });
	return json({ data: data ?? [] });
};

// ---------- POST: registrar (o reactivar) un domiciliario (solo admin) ----------
// El email debe pertenecer a un usuario existente en Supabase Auth; la
// verificación la hace el RPC registrar_domiciliario (SECURITY DEFINER).
export const POST: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const body = await event.request.json().catch(() => ({}));
	const op = String(body?.op ?? '').trim();
	if (op !== 'registrar') {
		return json({ error: 'Operación no soportada.' }, { status: 400 });
	}
	const nombre = String(body?.nombre ?? '').trim();
	const email = String(body?.email ?? '').trim().toLowerCase();
	const telefono = String(body?.telefono ?? '').trim() || null;

	if (!nombre) return json({ error: 'El nombre es obligatorio.' }, { status: 400 });
	if (!email) return json({ error: 'El email es obligatorio.' }, { status: 400 });
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return json({ error: 'El email no es válido.' }, { status: 400 });
	}

	const { data, error: err } = await db.rpc('registrar_domiciliario', {
		p_nombre: nombre,
		p_telefono: telefono,
		p_email: email
	});
	if (err) return json({ error: err.message }, { status: 400 });
	return json({ data });
};

// ---------- PUT: activar / desactivar (solo admin) ----------
export const PUT: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const url = new URL(event.request.url);
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'Falta el id del domiciliario.' }, { status: 400 });

	const body = await event.request.json().catch(() => ({}));
	if (typeof body?.activo !== 'boolean') {
		return json({ error: 'El campo «activo» es obligatorio (true/false).' }, { status: 400 });
	}

	const { data, error: err } = await db
		.from('domiciliarios')
		.update({ activo: body.activo })
		.eq('id', id)
		.select('id, nombre, email, activo')
		.maybeSingle();
	if (err) return json({ error: err.message }, { status: 500 });
	if (!data) return json({ error: 'Domiciliario no encontrado.' }, { status: 404 });
	return json({ data });
};

// ---------- DELETE: eliminar (solo admin) ----------
// Los pedidos que tenía asignados quedan con domiciliario_id NULL (SET NULL).
export const DELETE: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const url = new URL(event.request.url);
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'Falta el id del domiciliario.' }, { status: 400 });

	const { data, error: err } = await db
		.from('domiciliarios')
		.delete()
		.eq('id', id)
		.select('id, nombre');
	if (err) return json({ error: err.message }, { status: 500 });
	if (!data || data.length === 0) return json({ error: 'Domiciliario no encontrado.' }, { status: 404 });
	return json({ data: data[0] as Domiciliario });
};
