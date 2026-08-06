import { error, type Cookies, type RequestEvent } from '@sveltejs/kit';
import type { User } from '@supabase/supabase-js';
import { dev } from '$app/environment';
import { getSupabaseAnon, getSupabaseAsUser } from './supabase';

export const ACCESS_COOKIE = 'stargo_access_token';
export const REFRESH_COOKIE = 'stargo_refresh_token';

const COOKIE_OPTS = {
	httpOnly: true,
	sameSite: 'lax' as const,
	path: '/',
	secure: !dev
};

export function setSessionCookies(
	cookies: Cookies,
	session: { access_token: string; refresh_token: string },
	secure = !dev
) {
	cookies.set(ACCESS_COOKIE, session.access_token, { ...COOKIE_OPTS, secure, maxAge: 60 * 60 * 24 * 7 });
	cookies.set(REFRESH_COOKIE, session.refresh_token, { ...COOKIE_OPTS, secure, maxAge: 60 * 60 * 24 * 30 });
}

/** En producción solo cookies sobre HTTPS; en dev siempre permitidas (localhost). */
export function esSecure(url: URL): boolean {
	return !dev || url.protocol === 'https:';
}

export function clearSessionCookies(cookies: Cookies) {
	cookies.delete(ACCESS_COOKIE, { path: '/' });
	cookies.delete(REFRESH_COOKIE, { path: '/' });
}

export interface SesionInfo {
	user: User;
	accessToken: string;
	refreshToken: string;
}

/**
 * Valida la sesión desde cookies httpOnly. Si el access token expiró, lo
 * renueva con el refresh token y re-emite las cookies.
 */
export async function getSesion(event: RequestEvent): Promise<SesionInfo | null> {
	const accessToken = event.cookies.get(ACCESS_COOKIE);
	const refreshToken = event.cookies.get(REFRESH_COOKIE);
	if (!accessToken) return null;

	const supabase = getSupabaseAnon();
	const { data, error: err } = await supabase.auth.getUser(accessToken);
	if (!err && data.user) {
		return { user: data.user, accessToken, refreshToken: refreshToken ?? '' };
	}

	if (refreshToken) {
		const { data: rd, error: re } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
		if (!re && rd.session) {
			setSessionCookies(event.cookies, rd.session, esSecure(event.url));
			return {
				user: rd.session.user,
				accessToken: rd.session.access_token,
				refreshToken: rd.session.refresh_token
			};
		}
	}

	clearSessionCookies(event.cookies);
	return null;
}

/** ¿El usuario autenticado es administrador? (función RLS `es_admin()`) */
export async function esAdmin(sesion: SesionInfo): Promise<boolean> {
	const { data, error: err } = await getSupabaseAsUser(sesion.accessToken).rpc('es_admin');
	if (err) return false;
	return data === true;
}

/** ¿El usuario autenticado es un domiciliario activo? */
export async function esDomiciliario(sesion: SesionInfo): Promise<boolean> {
	const { data, error: err } = await getSupabaseAsUser(sesion.accessToken).rpc('es_domiciliario');
	if (err) return false;
	return data === true;
}

/** Id del domiciliario activo actual (null si no lo es). */
export async function miDomiciliarioId(sesion: SesionInfo): Promise<string | null> {
	const { data, error: err } = await getSupabaseAsUser(sesion.accessToken).rpc('mi_domiciliario_id');
	if (err || typeof data !== 'string') return null;
	return data;
}

/** Roles del usuario autenticado (admin / domiciliario). */
export async function rolesDe(sesion: SesionInfo): Promise<{ esAdmin: boolean; esDomiciliario: boolean }> {
	const [a, d] = await Promise.all([esAdmin(sesion), esDomiciliario(sesion)]);
	return { esAdmin: a, esDomiciliario: d };
}

/**
 * Exige sesión de administrador para escrituras.
 * Lanza 401 (no autenticado) o 403 (no es admin).
 */
export async function requireAdmin(event: RequestEvent): Promise<SesionInfo> {
	const sesion = await getSesion(event);
	if (!sesion) error(401, 'No autenticado');
	if (!(await esAdmin(sesion))) error(403, 'No eres administrador');
	return sesion;
}

/**
 * Exige sesión de domiciliario activo para su panel.
 * Lanza 401 (no autenticado) o 403 (no es domiciliario).
 */
export async function requireDomiciliario(event: RequestEvent): Promise<SesionInfo> {
	const sesion = await getSesion(event);
	if (!sesion) error(401, 'No autenticado');
	if (!(await esDomiciliario(sesion))) error(403, 'No eres domiciliario');
	return sesion;
}

/**
 * Exige sesión con algún rol registrado (admin o domiciliario).
 * Devuelve la sesión y los roles activos.
 */
export async function requireRol(
	event: RequestEvent
): Promise<{ sesion: SesionInfo; esAdmin: boolean; esDomiciliario: boolean }> {
	const sesion = await getSesion(event);
	if (!sesion) error(401, 'No autenticado');
	const roles = await rolesDe(sesion);
	if (!roles.esAdmin && !roles.esDomiciliario) error(403, 'No tienes un rol registrado');
	return { sesion, ...roles };
}
