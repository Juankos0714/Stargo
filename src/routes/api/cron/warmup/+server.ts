import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * GET /api/cron/warmup — cron de Vercel para mantener las funciones calientes.
 *
 * Ping ligero que toca las rutas críticas (health + sesion + barrios) para
 * evitar cold-starts. Ejecutar cada 5 min (Pro) o diariamente (Hobby).
 *
 * No requiere CRON_SECRET: es un endpoint público de solo lectura.
 * No hace escrituras ni llamadas pesadas — solo lecturas anónimas a Supabase.
 */
export const GET: RequestHandler = async ({ url }) => {
	const base = url.origin;
	const inicio = Date.now();

	// Pings internos a rutas públicas para mantener las funciones calientes.
	// Se ejecutan en paralelo y se reportan los resultados.
	const rutas = ['/api/health', '/api/sesion', '/api/barrios', '/api/zonas'];

	const resultados = await Promise.allSettled(
		rutas.map(async (ruta) => {
			const t0 = Date.now();
			try {
				const res = await fetch(`${base}${ruta}`, {
					headers: { Accept: 'application/json' },
					signal: AbortSignal.timeout(10_000)
				});
				return { ruta, status: res.status, ms: Date.now() - t0 };
			} catch (e) {
				return { ruta, status: 0, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
			}
		})
	);

	const ping = resultados.map((r) => (r.status === 'fulfilled' ? r.value : { ruta: '?', status: 0, ms: 0, error: 'rejected' }));
	const todosOk = ping.every((p) => p.status >= 200 && p.status < 400);

	return json(
		{
			ok: todosOk,
			rutas: ping,
			total_ms: Date.now() - inicio,
			timestamp: new Date().toISOString()
		},
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};
