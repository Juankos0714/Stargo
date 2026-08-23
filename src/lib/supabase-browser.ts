import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { apiFetch } from '$lib/api';
import { esCapacitor, getStoredSession } from '$lib/capacitor-auth';

/**
 * Cliente de Supabase para el navegador, usado únicamente para Realtime.
 *
 * Se hidrata con el JWT del usuario (vía setSession) en los paneles de
 * admin y domiciliario para que Realtime respete las políticas RLS;
 * en las páginas públicas (cliente) se usa como anónimo.
 *
 * persistSession + autoRefreshToken quedan activos para que el canal se
 * re-suscriba con tokens renovados durante sesiones largas.
 */
export const supabaseBrowser: SupabaseClient = createClient(
	PUBLIC_SUPABASE_URL,
	PUBLIC_SUPABASE_ANON_KEY,
	{
		auth: {
			persistSession: !esCapacitor(),
			autoRefreshToken: !esCapacitor()
		}
	}
);

/**
 * Hidrata el cliente del navegador con la sesión del usuario actual.
 * Debe llamarse una vez en cada página que use Realtime con datos privados.
 *
 * En Capacitor, usa tokens de localStorage directamente (sin fetch).
 * En web, llama a /api/sesion vía apiFetch (resuelve URLs para Capacitor).
 */
export async function hidratarSesionRealtime(): Promise<boolean> {
	try {
		// En Capacitor, obtener tokens directamente de localStorage
		if (esCapacitor()) {
			const session = getStoredSession();
			if (!session?.accessToken) return false;
			const { error } = await supabaseBrowser.auth.setSession({
				access_token: session.accessToken,
				refresh_token: session.refreshToken
			});
			return !error;
		}

		// En web, usar apiFetch normal
		const res = await apiFetch('/api/sesion', { headers: { Accept: 'application/json' } });
		if (!res.ok) return false;
		const body = await res.json();
		const data = body?.data;
		if (!data?.access_token) return false;
		const { error } = await supabaseBrowser.auth.setSession({
			access_token: data.access_token,
			refresh_token: data.refresh_token
		});
		return !error;
	} catch {
		return false;
	}
}
