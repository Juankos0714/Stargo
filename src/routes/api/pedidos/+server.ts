import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAnon, getSupabaseAsUser } from '$lib/server/supabase';
import { getSesion, miDomiciliarioId, requireAdmin, rolesDe } from '$lib/server/auth';
import type { Domiciliario, HistorialEstado, Pedido } from '$lib/types';

// ---------- POST: crear pedido (público) ----------
// La tarifa se recalcula en la BD dentro de crear_pedido() (SECURITY DEFINER).
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const barrioOrigen = String(body?.barrio_origen ?? '').trim();
	const direccionOrigen = String(body?.direccion_origen ?? '').trim();
	const barrioDestino = String(body?.barrio_destino ?? '').trim();
	const direccionDestino = String(body?.direccion_destino ?? '').trim();
	const observaciones = String(body?.observaciones ?? '').trim() || null;
	// Recargos elegidos por el cliente (códigos). El total real lo recalcula la BD.
	const recargos = Array.isArray(body?.recargos)
		? (body.recargos as unknown[])
				.map((c) => String(c).trim())
				.filter((c) => c.length > 0 && c.length <= 40)
		: [];
	if (recargos.length > 15) {
		return json({ error: 'Demasiados recargos (máx. 15).' }, { status: 400 });
	}

	if (!barrioOrigen || !barrioDestino) {
		return json({ error: 'Faltan el barrio de origen o destino.' }, { status: 400 });
	}
	if (!direccionOrigen || !direccionDestino) {
		return json({ error: 'Las direcciones de origen y destino son obligatorias.' }, { status: 400 });
	}
	if (direccionOrigen.length > 300 || direccionDestino.length > 300) {
		return json({ error: 'Las direcciones son demasiado largas (máx. 300 caracteres).' }, { status: 400 });
	}
	if (observaciones && observaciones.length > 1000) {
		return json({ error: 'Las observaciones son demasiado largas (máx. 1000 caracteres).' }, { status: 400 });
	}

	const { data, error: err } = await getSupabaseAnon().rpc('crear_pedido', {
		p_barrio_origen_id: barrioOrigen,
		p_direccion_origen: direccionOrigen,
		p_barrio_destino_id: barrioDestino,
		p_direccion_destino: direccionDestino,
		p_observaciones: observaciones,
		p_recargos: recargos.length > 0 ? recargos : null
	});

	if (err) {
		return json({ error: err.message }, { status: 400 });
	}
	if (!data) {
		return json({ error: 'No hay tarifa disponible para este trayecto.' }, { status: 400 });
	}
	return json({ data });
};

// ---------- DELETE: eliminar pedido (solo admin) ----------
// Borra en cascada su historial_estados (política RLS pedidos_admin_delete).
export const DELETE: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const url = new URL(event.request.url);
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'Falta el id del pedido.' }, { status: 400 });

	const { data, error: err } = await db.from('pedidos').delete().eq('id', id).select('id, numero');
	if (err) return json({ error: err.message }, { status: 500 });
	if (!data || data.length === 0) return json({ error: 'Pedido no encontrado.' }, { status: 404 });
	return json({ data: data[0] });
};

// ---------- GET: listar pedidos (admin: todos; domiciliario: los suyos) ----------
// RLS restringe las filas según el rol: el domiciliario solo ve los
// pedidos que le fueron asignados.
export const GET: RequestHandler = async (event) => {
	const url = new URL(event.request.url);
	const estado = url.searchParams.get('estado') ?? null;
	const select = url.searchParams.get('select') ?? null;

	const sesion = await getSesion(event);
	if (!sesion) return json({ error: 'No autenticado' }, { status: 401 });
	const roles = await rolesDe(sesion);
	const db = getSupabaseAsUser(sesion.accessToken);

	let q = db.from('pedidos').select('*');
	if (roles.esDomiciliario && !roles.esAdmin) {
		const domId = await miDomiciliarioId(sesion);
		if (!domId) return json({ error: 'Domiciliario inactivo.' }, { status: 403 });
		q = q.eq('domiciliario_id', domId);
	} else if (!roles.esAdmin && !roles.esDomiciliario) {
		return json({ error: 'No tienes un rol registrado' }, { status: 403 });
	}
	if (estado) q = q.eq('estado', estado);
	const { data: pedidos, error: err } = await q.order('created_at', { ascending: false }).limit(300);
	if (err) return json({ error: err.message }, { status: 500 });
	const filas = (pedidos ?? []) as Pedido[];

	// Fast-path para conteos (p. ej. ?select=id en el resumen)
	if (select === 'id') {
		return json({ data: filas.map((p) => ({ id: p.id })) });
	}

	// Historial de estados para cada pedido (RLS: admin o el domiciliario asignado)
	const ids = filas.map((p) => p.id);
	let historiales: HistorialEstado[] = [];
	if (ids.length > 0) {
		const r = await db.from('historial_estados').select('*').in('pedido_id', ids).order('created_at');
		if (r.error) return json({ error: r.error.message }, { status: 500 });
		historiales = r.data ?? [];
	}
	const historialPorPedido = new Map<string, HistorialEstado[]>();
	for (const h of historiales) {
		const arr = historialPorPedido.get(h.pedido_id) ?? [];
		arr.push(h);
		historialPorPedido.set(h.pedido_id, arr);
	}

	// Nombres de barrios (lectura pública)
	const nombres = new Map<string, string>();
	const idsBarrios = [...new Set([...filas.map((p) => p.barrio_origen_id), ...filas.map((p) => p.barrio_destino_id)])];
	if (idsBarrios.length > 0) {
		const r = await getSupabaseAnon().from('barrios').select('id, nombre').in('id', idsBarrios);
		for (const b of r.data ?? []) nombres.set(b.id, b.nombre);
	}

	// Nombres de domiciliarios (admin los ve todos; el domiciliario su propia fila)
	const nombresDom = new Map<string, string>();
	const idsDom = [...new Set(filas.map((p) => p.domiciliario_id).filter(Boolean))] as string[];
	if (idsDom.length > 0) {
		const r = await db.from('domiciliarios').select('id, nombre').in('id', idsDom);
		for (const d of (r.data ?? []) as Pick<Domiciliario, 'id' | 'nombre'>[]) nombresDom.set(d.id, d.nombre);
	}

	return json({
		data: filas.map((p) => ({
			...p,
			barrio_origen_nombre: nombres.get(p.barrio_origen_id) ?? null,
			barrio_destino_nombre: nombres.get(p.barrio_destino_id) ?? null,
			domiciliario_nombre: p.domiciliario_id ? (nombresDom.get(p.domiciliario_id) ?? null) : null,
			historial: historialPorPedido.get(p.id) ?? []
		}))
	});
};
