import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ACCESS_COOKIE, clearSessionCookies } from '$lib/server/auth';
import { getSupabaseAsUser } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ cookies }) => {
	// Revoca la sesión en Supabase usando el access token del usuario
	// (invalida el refresh token) y luego limpia las cookies locales.
	const accessToken = cookies.get(ACCESS_COOKIE);
	if (accessToken) {
		try {
			await getSupabaseAsUser(accessToken).auth.signOut();
		} catch {
			// ignorar: el token pudo haber expirado; igual se limpian las cookies
		}
	}
	clearSessionCookies(cookies);
	return json({ data: { ok: true } });
};
