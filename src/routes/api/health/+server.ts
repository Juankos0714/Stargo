import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAnon } from '$lib/server/supabase';

/**
 * Health check de la app (Parte 8 — smoke tests post-deploy).
 *
 * Verifica que la app responde y que la conexión a Supabase funciona, midiendo
 * la latencia. Lo usan:
 *   - el smoke test post-deploy (scripts/smoke-test.mjs) tras cada deploy;
 *   - el monitor externo de uptime (la Parte 9 lo referencia).
 *
 * Nunca lanza 500: si Supabase está caído responde 503 con un cuerpo
 * estructurado (ok: false) para que el monitor distinga "app abajo" de
 * "Supabase abajo". Sin cache para que el monitor vea siempre el estado real.
 */
export const GET: RequestHandler = async () => {
	const inicio = Date.now();
	try {
		const { error } = await getSupabaseAnon()
			.from('zonas')
			.select('id', { count: 'exact', head: true })
			.limit(1);
		const latenciaMs = Date.now() - inicio;
		const ok = !error;
		return json(
			{
				ok,
				supabase: ok ? 'ok' : 'error',
				latencia_ms: latenciaMs,
				timestamp: new Date().toISOString()
			},
			{
				status: ok ? 200 : 503,
				headers: { 'Cache-Control': 'no-store' }
			}
		);
	} catch {
		return json(
			{
				ok: false,
				supabase: 'error',
				latencia_ms: Date.now() - inicio,
				timestamp: new Date().toISOString()
			},
			{
				status: 503,
				headers: { 'Cache-Control': 'no-store' }
			}
		);
	}
};
