import type { PageServerLoad } from './$types';
import { getSupabaseAnon } from '$lib/server/supabase';
import { getSesion, rolesDe } from '$lib/server/auth';
import type { HorarioHoy } from '$lib/types';

/**
 * Datos iniciales de la página principal.
 *
 * El estado de HOY (calculado en la BD en hora de Bogotá por
 * public.horario_hoy()) y los roles del usuario se resuelven en el servidor:
 * así el banner de horario y los enlaces de navegación ya vienen en el HTML
 * inicial — cero layout shift por inserción tardía y fuera de la ruta crítica
 * del cliente (antes: GET /api/horario y GET /api/sesion en el critical path).
 *
 * Cualquier fallo degrada a valores seguros (página pública): si Supabase no
 * responde, la home se renderiza igual sin banner.
 */
export const load: PageServerLoad = async (event) => {
	const [horario, sesion] = await Promise.all([
		(async () => {
			try {
				const r = await getSupabaseAnon().rpc('horario_hoy');
				return (r.data as HorarioHoy | null) ?? null;
			} catch {
				return null;
			}
		})(),
		(async () => {
			try {
				const s = await getSesion(event);
				if (!s) return null;
				return await rolesDe(s);
			} catch {
				return null;
			}
		})()
	]);

	return {
		horario,
		esAdmin: sesion?.esAdmin ?? false,
		esDomiciliario: sesion?.esDomiciliario ?? false
	};
};
