import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSesion, rolesDe, type SesionInfo } from '$lib/server/auth';

/**
 * GET /api/sesion — rol y sesión del usuario autenticado.
 *
 * Devuelve también los tokens de acceso/refresco SOLO cuando el usuario
 * tiene un rol registrado (admin o domiciliario). La app los usa para
 * hidratar el cliente de Supabase en el navegador y suscribirse a
 * Realtime (que respeta RLS con el JWT del usuario). Son los tokens
 * propios del usuario, el mismo patrón que una SPA normal de Supabase.
 */
export const GET: RequestHandler = async (event) => {
	const sesion = await getSesion(event);
	if (!sesion) {
		// 200 con data:null para visitantes anónimos: evita errores 401 en la
		// consola del navegador. Todos los consumidores ya contemplan data nulo.
		return json({ data: null });
	}
	const roles = await rolesDe(sesion);
	if (!roles.esAdmin && !roles.esDomiciliario) {
		return json({ error: 'Tu usuario no tiene un rol registrado' }, { status: 403 });
	}
	const info: SesionInfo = sesion;
	return json({
		data: {
			email: sesion.user.email,
			...roles,
			access_token: info.accessToken,
			refresh_token: info.refreshToken
		}
	});
};
