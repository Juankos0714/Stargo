import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// La URL histórica /admin/login redirige al login unificado de StarGo.
export const load: PageServerLoad = () => {
	throw redirect(307, '/login');
};
