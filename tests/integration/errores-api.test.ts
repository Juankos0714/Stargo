import { describe, expect, test, afterEach } from 'vitest';
import { api } from '../../src/lib/api';

/**
 * Contrato de errores del cliente HTTP de la app (src/lib/api.ts), que es la
 * capa por la que TODAS las páginas hablan con los endpoints.
 *
 * El resto de la suite de integración usa Supabase real; aquí solo se
 * simula la capa de red (error de conexión, timeout, 429, 500) porque contra
 * una base local sana es imposible forzar esos fallos. El contrato que se
 * verifica es el que protege la UI: api.* NUNCA lanza, devuelve {data:null,
 * error} con un mensaje claro, y la UI lo muestra y permite reintentar
 * (volver a llamar). Sin esto, un timeout de Supabase rompería la página.
 */
describe('api.ts — contrato de errores que protege la UI', () => {
	const fetchOriginal = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = fetchOriginal;
	});

	function fingirFetch(impl: (url: string, opts: RequestInit) => Promise<unknown> | unknown) {
		globalThis.fetch = impl as typeof fetch;
	}

	function jsonResponse(cuerpo: unknown, status = 200): Response {
		return new Response(JSON.stringify(cuerpo), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	test('error de red → {data:null, error} y NO lanza (la página sigue viva)', async () => {
		fingirFetch(async () => {
			throw new TypeError('Failed to fetch');
		});
		const r = await api.get('/api/cualquier-cosa');
		expect(r.data).toBeNull();
		expect(r.error).toContain('Failed to fetch');
	});

	test('timeout/abort → error legible y no lanza', async () => {
		fingirFetch(async () => {
			throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
		});
		const r = await api.get('/api/cualquier-cosa');
		expect(r.data).toBeNull();
		expect(r.error).toBeTruthy();
	});

	test('429 (rate limit) → expone el mensaje del servidor para mostrarlo en la UI', async () => {
		fingirFetch(async () => jsonResponse({ error: 'Demasiadas peticiones, intenta en un momento' }, 429));
		const r = await api.get('/api/cualquier-cosa');
		expect(r.data).toBeNull();
		expect(r.error).toBe('Demasiadas peticiones, intenta en un momento');
	});

	test('500 con cuerpo no-JSON → error controlado (no excepción de parseo)', async () => {
		fingirFetch(async () => new Response('<html>Internal Server Error</html>', { status: 500 }));
		const r = await api.post('/api/cualquier-cosa', { x: 1 });
		expect(r.data).toBeNull();
		expect(r.error).toContain('Error 500');
	});

	test('respuesta correcta → data y error null', async () => {
		fingirFetch(async () => jsonResponse({ data: { ok: true } }));
		const r = await api.get<{ ok: boolean }>('/api/ok');
		expect(r.error).toBeNull();
		expect(r.data).toEqual({ ok: true });
	});

	test('reintentar tras un error funciona (la UI solo vuelve a llamar)', async () => {
		let llamadas = 0;
		fingirFetch(async () => {
			llamadas++;
			if (llamadas === 1) throw new TypeError('Failed to fetch');
			return jsonResponse({ data: { ok: true } });
		});
		const r1 = await api.get('/api/transitorio');
		expect(r1.error).toContain('Failed to fetch');
		const r2 = await api.get('/api/transitorio');
		expect(r2.error).toBeNull();
		expect(r2.data).toEqual({ ok: true });
	});
});
