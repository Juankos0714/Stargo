import type { PageServerLoad } from './$types';
import { getSupabaseAnon } from '$lib/server/supabase';
import type { Barrio, HorarioHoy, Recargo, Zona } from '$lib/types';

/**
 * Catálogo del formulario de pedido (barrios, zonas, recargos y estado de
 * horario de hoy) resuelto en el servidor.
 *
 * Antes, el formulario se renderizaba solo después de 4 llamadas /api
 * encadenadas desde el cliente; en mobile lento eso retrasaba el render del
 * LCP (el aviso de horario) ~5 s. Con el catálogo en el HTML inicial, el
 * formulario y el aviso ya vienen pintados desde el primer render.
 *
 * La consulta es espejo de GET /api/barrios|zonas|recargos + /api/horario
 * (select y orden idénticos). Si algo falla se degrada a catálogo vacío con
 * mensaje (página pública): el formulario nunca rompe por un fallo de BD.
 */
export const load: PageServerLoad = async () => {
	try {
		const db = getSupabaseAnon();
		const [rBarrios, rZonas, rRecargos, rHorario] = await Promise.all([
			db.from('barrios').select('id,nombre,zona_id').order('nombre'),
			db.from('zonas').select('id,nombre,tipo'),
			db.from('recargos').select('*').gte('valor', 0),
			db.rpc('horario_hoy')
		]);
		return {
			barrios: (rBarrios.data as Barrio[]) ?? [],
			zonas: (rZonas.data as Zona[]) ?? [],
			recargos: (rRecargos.data as Recargo[]) ?? [],
			horario: (rHorario.data as HorarioHoy | null) ?? null,
			error: rBarrios.error ? rBarrios.error.message : null
		};
	} catch {
		return {
			barrios: [],
			zonas: [],
			recargos: [],
			horario: null,
			error: 'No se pudieron cargar los datos. Intenta de nuevo.'
		};
	}
};
