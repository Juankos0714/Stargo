import { describe, expect, test } from 'vitest';
import { INTEGRACION_DISPONIBLE, peticion } from './http';

/**
 * Parte 8 — Health check (/api/health).
 *
 * Verifica que el endpoint de salud responde 200 con ok:true contra el
 * Supabase real (local). Es el mismo endpoint que el smoke test post-deploy
 * y el monitor externo consumen en producción.
 */
describe.skipIf(!INTEGRACION_DISPONIBLE)('health', () => {
	test('/api/health responde 200 con Supabase conectado', async () => {
		const r = await peticion<{ ok: boolean; supabase: string; latencia_ms: number }>('/api/health');
		expect(r.status).toBe(200);
		expect(r.data?.ok).toBe(true);
		expect(r.data?.supabase).toBe('ok');
		expect(typeof r.data?.latencia_ms).toBe('number');
	});

	test('/api/health no se cachea (siempre estado real)', async () => {
		const r = await peticion('/api/health');
		expect(r.headers.get('cache-control')).toContain('no-store');
	});
});
