import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAnon } from '$lib/server/supabase';
import { clearSessionCookies, esSecure, rolesDe, setSessionCookies, type SesionInfo } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, cookies, url }) => {
	const body = await request.json().catch(() => ({}));
	const email = String(body?.email ?? '').trim();
	const password = String(body?.password ?? '');
	if (!email || !password) {
		return json({ error: 'Faltan email o password' }, { status: 400 });
	}

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
	return json({ data: { email: data.user.email, ...roles } });
};
