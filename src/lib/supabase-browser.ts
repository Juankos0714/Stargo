import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { apiFetch } from '$lib/api';
import { esCapacitor } from '$lib/capacitor-auth';
import { storeSession } from '$lib/capacitor-auth';

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
		// autoRefreshToken DESACTIVADO: el refresh lo maneja el server
		// (hooks.server.ts → handleSession). Si el browser client juga a
		// refrescar, invalida el refresh_token que el server necesita,
		// causando el race condition que cierra la sesión.
		autoRefreshToken: false
		}
	}
);

/**
 * Hidrata el cliente del navegador con la sesión del usuario actual.
 * Debe llamarse una vez en cada página que use Realtime con datos privados.
 *
 * Todos los caminos llaman a /api/sesion vía apiFetch: el endpoint
 * hace el refresh server-side si el access token expiró y devuelve
 * el par access_token/refresh_token fresco.  En Capacitor, apiFetch
 * usa CapacitorHttp con Cookie inyectado; el servidor responde con
 * Set-Cookie, pero CapacitorHttp no mantiene cookie jar, así que
 * re-sincronizamos localStorage con los tokens nuevos.
 */
export async function hidratarSesionRealtime(): Promise<boolean> {
	try {
		const res = await apiFetch('/api/sesion', { headers: { Accept: 'application/json' } });
		if (!res.ok) return false;
		const body = await res.json();
		const data = body?.data;
		if (!data?.access_token) return false;

		// En Capacitor, re-sincronizar localStorage con los tokens frescos
		// que el servidor devolvió (puede haber roto el refresh_token).
		if (esCapacitor()) {
			storeSession(data.access_token, data.refresh_token ?? '');
		}

		const { error } = await supabaseBrowser.auth.setSession({
			access_token: data.access_token,
			refresh_token: data.refresh_token
		});
		return !error;
	} catch {
		return false;
	}
}
