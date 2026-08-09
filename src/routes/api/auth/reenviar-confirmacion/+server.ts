import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAnon } from '$lib/server/supabase';

/**
 * POST /api/auth/reenviar-confirmacion — público.
 *
 * Reenvía el correo de confirmación de registro (type: 'signup') cuando el
 * usuario no lo recibió o expiró. No requiere sesión: el flujo de
 * confirmación de Supabase funciona contra el correo, no contra el token.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const email = String(body?.email ?? '').trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return json({ error: 'Ingresa un email válido.' }, { status: 400 });
	}

	const { error } = await getSupabaseAnon().auth.resend({ type: 'signup', email });
	if (error) {
		// No se revela si el correo existe o no: el mensaje sirve para ambos casos.
		return json(
			{
				error:
					'No se pudo reenviar el correo. Verifica la dirección o pídele a tu administrador que te invite de nuevo desde el panel.'
			},
			{ status: 400 }
		);
	}
	return json({ data: { enviado: true } });
};
