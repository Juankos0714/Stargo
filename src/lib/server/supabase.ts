import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { env } from '$env/dynamic/private';

let anon: SupabaseClient | null = null;
let service: SupabaseClient | null = null;

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

/**
 * Cliente service-role (SOLO servidor) para tareas privilegiadas que el
 * usuario no puede hacer con su JWT: p. ej. crear la cuenta de Supabase
 * Auth de un domiciliario cuando el admin lo registra desde el panel.
 *
 * Devuelve null si falta SUPABASE_SERVICE_ROLE_KEY (se lee en runtime con
 * $env/dynamic/private porque es opcional): los llamadores deben responder
 * un error claro en ese caso, nunca romper.
 */
export function getSupabaseService(): SupabaseClient | null {
	const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
	if (!serviceKey) return null;
	if (!service) {
		service = createClient(PUBLIC_SUPABASE_URL, serviceKey, {
			auth: { persistSession: false, autoRefreshToken: false }
		});
	}
	return service;
}
