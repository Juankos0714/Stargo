import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getSesion, miDomiciliarioId, esDomiciliario } from '$lib/server/auth';

export const load: LayoutServerLoad = async (event) => {
	const sesion = await getSesion(event);
	if (!sesion || !(await esDomiciliario(sesion))) {
		throw redirect(303, '/login');
	}
	const domiciliarioId = await miDomiciliarioId(sesion);
	return { email: sesion.user.email ?? '', domiciliarioId };
};
