import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser, getSupabaseService } from '$lib/server/supabase';
import { requireAdmin } from '$lib/server/auth';
import { obtenerResumenes } from '$lib/server/cuenta';
import type { Domiciliario } from '$lib/types';

// ---------- GET: listar domiciliarios (solo admin) ----------
// Cada fila incluye bloqueo y el resumen de su deuda (total generado por
// pedidos entregados, abonos y saldo pendiente). La comisión ya NO es por
// domiciliario: es global por niveles (ver /api/comisiones).
export const GET: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const url = new URL(event.request.url);
	const soloActivos = url.searchParams.get('activos') === 'true';

	let q = db.from('domiciliarios').select('*').order('nombre');
	if (soloActivos) q = q.eq('activo', true);
	const { data, error: err } = await q;
	if (err) return json({ error: err.message }, { status: 500 });
	const domis = (data ?? []) as Domiciliario[];

	const resumenes = await obtenerResumenes(db, domis.map((d) => d.id));
	const filas = domis.map((d) => {
		const resumen = resumenes.get(d.id);
		return {
			...d,
			bloqueado: d.bloqueado === true,
			deuda: resumen?.deuda ?? 0,
			total_comision: resumen?.total_comision ?? 0,
			total_pagos: resumen?.total_pagos ?? 0,
			pagos: resumen?.pagos ?? []
		};
	});
	return json({ data: filas });
};

// ---------- POST: registrar o invitar un domiciliario (solo admin) ----------
// Dos operaciones, ninguna requiere tocar el dashboard de Supabase:
//
//   op: 'invitar'  → Envía un correo de invitación (inviteUserByEmail). El
//                    domiciliario define SU propia contraseña con el enlace
//                    del correo y luego inicia sesión. (Flujo recomendado.)
//   op: 'registrar' → El admin define la contraseña: el servidor crea la
//                    cuenta de Supabase Auth (service role, email confirmado)
//                    y enlaza la fila vía RPC. Sin password, el email debe
//                    pertenecer a una cuenta existente.
//
// Ambas terminan en registrar_domiciliario (SECURITY DEFINER) para crear o
// reactivar la fila de la tabla domiciliarios.
export const POST: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const body = await event.request.json().catch(() => ({}));
	const op = String(body?.op ?? '').trim();
	if (op !== 'registrar' && op !== 'invitar') {
		return json({ error: 'Operación no soportada.' }, { status: 400 });
	}
	const nombre = String(body?.nombre ?? '').trim();
	const email = String(body?.email ?? '').trim().toLowerCase();
	const telefono = String(body?.telefono ?? '').trim() || null;
	// Se recorta la contraseña: evita claves de solo espacios y espacios
	// accidentales alrededor.
	const password = String(body?.password ?? '').trim();

	if (!nombre) return json({ error: 'El nombre es obligatorio.' }, { status: 400 });
	if (!email) return json({ error: 'El email es obligatorio.' }, { status: 400 });
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return json({ error: 'El email no es válido.' }, { status: 400 });
	}

	const service = getSupabaseService();
	if (!service) {
		return json(
			{ error: 'Falta SUPABASE_SERVICE_ROLE_KEY en el entorno: no se puede gestionar la cuenta de Auth.' },
			{ status: 500 }
		);
	}

	let cuentaCreada = false;
	let invitacionEnviada = false;

	if (op === 'invitar') {
		// 1) Correo de invitación: el usuario define su propia contraseña.
		const { error: errInv } = await service.auth.admin.inviteUserByEmail(email, {
			redirectTo: `${event.url.origin}/login`
		});
		if (errInv) {
			// Si la cuenta YA existe (o ya fue invitada sin aceptar), no se reenvía
			// invitación: se enlaza/reactiva la fila igual (el domiciliario entra
			// con la contraseña que ya tiene o con la del enlace pendiente).
			const yaExiste =
				errInv.code === 'email_exists' ||
				errInv.code === 'user_already_exists' ||
				/already (been )?(registered|invited)|already exists/i.test(errInv.message);
			if (!yaExiste) {
				return json({ error: `No se pudo enviar la invitación: ${errInv.message}` }, { status: 400 });
			}
		} else {
			invitacionEnviada = true;
		}
	} else if (password) {
		// 2) op: 'registrar' con contraseña: crea la cuenta (no la resetea si ya existe).
		if (password.length < 6) {
			return json({ error: 'La contraseña debe tener al menos 6 caracteres.' }, { status: 400 });
		}
		const { error: errUser } = await service.auth.admin.createUser({
			email,
			password,
			email_confirm: true
		});
		if (errUser) {
			const yaExiste =
				errUser.code === 'email_exists' ||
				errUser.code === 'user_already_exists' ||
				/already (been )?registered|already exists/i.test(errUser.message);
			if (!yaExiste) {
				return json({ error: `No se pudo crear la cuenta: ${errUser.message}` }, { status: 400 });
			}
		} else {
			cuentaCreada = true;
		}
	}

	// 3) Enlaza (o reactiva) la fila del domiciliario con ese email.
	const { data, error: err } = await db.rpc('registrar_domiciliario', {
		p_nombre: nombre,
		p_telefono: telefono,
		p_email: email
	});
	if (err) return json({ error: err.message }, { status: 400 });
	return json({ data, meta: { cuentaCreada, invitacionEnviada } });
};

// ---------- PUT: actualizar (solo admin) ----------
// Soporta dos campos (pueden ir juntos o por separado):
//   activo    → activar/desactivar acceso (escritura directa con RLS admin)
//   bloqueado → bloqueo/desbloqueo por falta de pago (RPC, solo admin)
export const PUT: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const url = new URL(event.request.url);
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'Falta el id del domiciliario.' }, { status: 400 });

	const body = await event.request.json().catch(() => ({}));
	const tieneActivo = typeof body?.activo === 'boolean';
	const tieneBloqueado = typeof body?.bloqueado === 'boolean';
	if (!tieneActivo && !tieneBloqueado) {
		return json({ error: 'Envía al menos un campo: activo o bloqueado.' }, { status: 400 });
	}

	// Bloqueo: RPC SECURITY DEFINER (solo admin; desbloquear también).
	if (tieneBloqueado) {
		const { error: errBloq } = await db.rpc('bloquear_domiciliario', {
			p_domiciliario_id: id,
			p_bloqueado: body.bloqueado
		});
		if (errBloq) return json({ error: errBloq.message }, { status: 400 });
	}

	// Activo: escritura directa (la política domiciliarios_admin_all valida admin).
	if (tieneActivo) {
		const { error: errAct } = await db
			.from('domiciliarios')
			.update({ activo: body.activo })
			.eq('id', id);
		if (errAct) return json({ error: errAct.message }, { status: 500 });
	}

	const { data, error: err } = await db
		.from('domiciliarios')
		.select('id, nombre, email, activo, bloqueado')
		.eq('id', id)
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
