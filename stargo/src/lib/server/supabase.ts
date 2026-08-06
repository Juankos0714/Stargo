import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

let anon: SupabaseClient | null = null;

/**
 * Cliente Supabase del servidor para lecturas públicas (RLS: SELECT público).
 * Nunca tiene permisos de escritura si el usuario no está autenticado.
 */
export function getSupabaseAnon(): SupabaseClient {
	if (!anon) {
		anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
			auth: { persistSession: false, autoRefreshToken: false }
		});
	}
	return anon;
}

/**
 * Cliente Supabase que actúa como un usuario autenticado: envía su JWT en
 * cada petición, de modo que RLS aplica con `auth.uid()` = ese usuario.
 */
export function getSupabaseAsUser(accessToken: string): SupabaseClient {
	return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		auth: { persistSession: false, autoRefreshToken: false },
		global: { headers: { Authorization: `Bearer ${accessToken}` } }
	});
}
