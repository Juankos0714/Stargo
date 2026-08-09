import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getSesion, miDomiciliarioId, esDomiciliario } from '$lib/server/auth';
import { getSupabaseAsUser } from '$lib/server/supabase';

export const load: LayoutServerLoad = async (event) => {
	const sesion = await getSesion(event);
	if (!sesion || !(await esDomiciliario(sesion))) {
		throw redirect(303, '/login');
	}
	const domiciliarioId = await miDomiciliarioId(sesion);
	// Identidad visible: el NOMBRE y el USUARIO (el email sintético interno
	// nunca se muestra al repartidor). RLS permite leer su propia fila.
	let nombre = sesion.user.user_metadata?.nombre ?? '';
	let username: string | null = null;
	if (domiciliarioId) {
		const db = getSupabaseAsUser(sesion.accessToken);
		const { data } = await db
			.from('domiciliarios')
			.select('nombre, username')
			.eq('id', domiciliarioId)
			.maybeSingle();
		nombre = data?.nombre ?? nombre;
		username = data?.username ?? null;
	}
	return { nombre, username, domiciliarioId };
};
