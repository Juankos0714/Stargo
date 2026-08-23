import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAnon } from '$lib/server/supabase';
import { clearSessionCookies, esSecure, rolesDe, setSessionCookies, type SesionInfo } from '$lib/server/auth';
import { emailSinteticoDe, esEmail, normalizarUsername } from '$lib/logic/usuario';

export const POST: RequestHandler = async ({ request, cookies, url }) => {
	const body = await request.json().catch(() => ({}));
	// El usuario puede entrar con su email O con su usuario («movil1»).
	// Los repartidores sin correo se crearon con un email sintético interno
	// (movil1@stargo.local): al recibir un identificador que no parece email
	// se deriva ese email sintético de forma determinista y se inicia sesión
	// contra la cuenta real de Supabase Auth.
	const identificador = String(body?.identificador ?? body?.email ?? '').trim();
	const password = String(body?.password ?? '');
	if (!identificador || !password) {
		return json({ error: 'Faltan usuario o password' }, { status: 400 });
	}
	const email = esEmail(identificador)
		? identificador
		: emailSinteticoDe(normalizarUsername(identificador));

	const supabase = getSupabaseAnon();
	const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
	if (err || !data.session) {
		const msg = err?.message ?? '';
		const errorMsg = msg.toLowerCase().includes('email not confirmed')
			? 'Confirma tu email antes de iniciar sesión.'
			: msg.includes('Invalid login credentials')
				? 'Credenciales incorrectas'
				: msg || 'Credenciales incorrectas';
		return json({ error: errorMsg }, { status: 401 });
	}

	const sesion: SesionInfo = {
		user: data.user,
		accessToken: data.session.access_token,
		refreshToken: data.session.refresh_token
	};

	const roles = await rolesDe(sesion);
	if (!roles.esAdmin && !roles.esDomiciliario) {
		// Cerrar la sesión de Supabase creada arriba para no dejar sesiones huérfanas.
		await supabase.auth.signOut();
		clearSessionCookies(cookies);
		return json(
			{ error: 'Tu usuario no está registrado como administrador ni domiciliario' },
			{ status: 403 }
		);
	}

	setSessionCookies(cookies, data.session, esSecure(url));
	return json({ data: { email: data.user.email, ...roles, access_token: data.session.access_token, refresh_token: data.session.refresh_token } });
};
