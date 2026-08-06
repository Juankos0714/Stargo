import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { esAdmin, getSesion } from '$lib/server/auth';	export const load: LayoutServerLoad = async (event) => {
	const sesion = await getSesion(event);
	if (!sesion || !(await esAdmin(sesion))) {
		throw redirect(303, '/login');
	}
	return { email: sesion.user.email ?? '' };
};
