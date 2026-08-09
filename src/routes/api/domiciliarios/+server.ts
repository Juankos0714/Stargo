import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser, getSupabaseService } from '$lib/server/supabase';
import { requireAdmin } from '$lib/server/auth';
import { obtenerResumenes } from '$lib/server/cuenta';
import { DOMINIO_EMAIL_SINTETICO, emailSinteticoDe, normalizarUsername, usernameValido } from '$lib/logic/usuario';
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

// ---------- POST: registrar un domiciliario (solo admin) ----------
// Dos modos, ambos desde el panel (sin tocar el dashboard de Supabase):
//
//   Con `password` → el servidor CREA la cuenta de Supabase Auth con
//   email_confirm: true (service role). El domiciliario entra de inmediato
//   con sus credenciales: NO necesita correo de confirmación ni invitación.
//   Sin `password` → la cuenta debe existir (creada en el dashboard de
//   Supabase) y solo se enlaza la fila del domiciliario.
//
// Identidad de acceso:
//   * Con `username` («movil1») → la cuenta se crea con un EMAIL SINTÉTICO
//     interno derivado del username (movil1@stargo.local); el repartidor
//     entra al panel con su usuario + contraseña, sin correo.
//   * Con `email` → flujo clásico: crea o enlaza la cuenta por ese correo.
//   * Ambos terminan en registrar_domiciliario (SECURITY DEFINER).
export const POST: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const body = await event.request.json().catch(() => ({}));
	const nombre = String(body?.nombre ?? '').trim();
	const email = String(body?.email ?? '').trim().toLowerCase();
	const telefono = String(body?.telefono ?? '').trim() || null;
	// Se recorta la contraseña: evita claves de solo espacios y espacios
	// accidentales alrededor.
	const password = String(body?.password ?? '').trim();
	const username = String(body?.username ?? '').trim();

	if (!nombre) return json({ error: 'El nombre es obligatorio.' }, { status: 400 });

	// Identidad: se exige username O email (alternativas, no combinables).
	// Con username la cuenta de Auth se crea con un email sintético interno
	// derivado del username (movil1@stargo.local): así el login por usuario es
	// determinista. Si se dieran ambos, el login por usuario derivaría el
	// sintético pero la cuenta estaría con el email real → no entraría.
	const tieneUsername = username.length > 0;
	const tieneEmail = email.length > 0;
	if (!tieneUsername && !tieneEmail) {
		return json({ error: 'Indica el usuario («movil1») o el email del domiciliario.' }, { status: 400 });
	}
	if (tieneUsername && tieneEmail) {
		return json({ error: 'Elige el usuario o el email, no ambos.' }, { status: 400 });
	}
	if (tieneUsername && !usernameValido(username)) {
		return json({ error: 'El usuario debe tener entre 2 y 30 caracteres (letras y números).' }, { status: 400 });
	}
	if (tieneEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return json({ error: 'El email no es válido.' }, { status: 400 });
	}
	// El dominio sintético es interno: no se acepta por la vía email-solo
	// (evita que un admin relinkee manualmente una cuenta de un username).
	if (tieneEmail && email.endsWith(`@${DOMINIO_EMAIL_SINTETICO}`)) {
		return json({ error: 'Ese email es interno del sistema: usa el usuario correspondiente.' }, { status: 400 });
	}
	// email final para la cuenta de Auth: el real si se dio, o el sintético.
	const emailCuenta = tieneEmail ? email : emailSinteticoDe(normalizarUsername(username));

	// 1) Si viene password, crea la cuenta de Auth (email confirmado: el domi
	//    entra sin correo de confirmación). Si el email ya existe, NO se toca
	//    su contraseña: solo se enlaza la fila.
	let cuentaCreada = false;
	if (password) {
		if (password.length < 6) {
			return json({ error: 'La contraseña debe tener al menos 6 caracteres.' }, { status: 400 });
		}
		const service = getSupabaseService();
		if (!service) {
			return json(
				{ error: 'Falta SUPABASE_SERVICE_ROLE_KEY en el entorno: no se puede crear la cuenta.' },
				{ status: 500 }
			);
		}
		const { error: errUser } = await service.auth.admin.createUser({
			email: emailCuenta,
			password,
			email_confirm: true,
			...(tieneUsername ? { user_metadata: { username: normalizarUsername(username) } } : {})
		});
		if (errUser) {
			// Si el email ya tiene cuenta, NO se resetea su contraseña: solo se enlaza.
			const yaExiste =
				errUser.code === 'email_exists' ||
				errUser.code === 'user_already_exists' ||
				/already (been )?(registered|invited)|already exists/i.test(errUser.message ?? '');
			if (!yaExiste) {
				return json({ error: `No se pudo crear la cuenta: ${errUser.message}` }, { status: 400 });
			}
		} else {
			cuentaCreada = true;
		}
	}

	// 2) Enlaza (o reactiva) la fila del domiciliario con ese email (y username).
	const { data, error: err } = await db.rpc('registrar_domiciliario', {
		p_nombre: nombre,
		p_telefono: telefono,
		p_email: emailCuenta,
		...(tieneUsername ? { p_username: normalizarUsername(username) } : {})
	});
	if (err) return json({ error: err.message }, { status: 400 });
	return json({ data, meta: { cuentaCreada } });
};

// ---------- PUT: actualizar (solo admin) ----------
// Soporta tres campos (pueden ir juntos o por separado):
//   activo    → activar/desactivar acceso (escritura directa con RLS admin)
//   bloqueado → bloqueo/desbloqueo por falta de pago (RPC, solo admin)
//   password  → reiniciar la contraseña del domiciliario (service role,
//               sin correo de confirmación: entra de inmediato con la nueva)
export const PUT: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const url = new URL(event.request.url);
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'Falta el id del domiciliario.' }, { status: 400 });

	const body = await event.request.json().catch(() => ({}));
	const tieneActivo = typeof body?.activo === 'boolean';
	const tieneBloqueado = typeof body?.bloqueado === 'boolean';
	const tienePassword = typeof body?.password === 'string' && body.password.trim().length > 0;
	if (!tieneActivo && !tieneBloqueado && !tienePassword) {
		return json({ error: 'Envía al menos un campo: activo, bloqueado o password.' }, { status: 400 });
	}

	// Reinicio de contraseña: service role, la cuenta queda confirmada (el domi
	// entra con la nueva clave, sin correo de confirmación).
	if (tienePassword) {
		const password = body.password.trim();
		if (password.length < 6) {
			return json({ error: 'La contraseña debe tener al menos 6 caracteres.' }, { status: 400 });
		}
		const { data: fila, error: errFila } = await db
			.from('domiciliarios')
			.select('user_id, nombre')
			.eq('id', id)
			.maybeSingle();
		if (errFila) return json({ error: errFila.message }, { status: 500 });
		if (!fila?.user_id) {
			return json(
				{ error: 'Este domiciliario no tiene una cuenta de Supabase vinculada.' },
				{ status: 400 }
			);
		}
		const service = getSupabaseService();
		if (!service) {
			return json(
				{ error: 'Falta SUPABASE_SERVICE_ROLE_KEY en el entorno: no se puede cambiar la contraseña.' },
				{ status: 500 }
			);
		}
		const { error: errClave } = await service.auth.admin.updateUserById(fila.user_id, {
			password,
			email_confirm: true
		});
		if (errClave) {
			return json({ error: `No se pudo cambiar la contraseña: ${errClave.message}` }, { status: 400 });
		}
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
