import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { INTEGRACION_DISPONIBLE, peticion, CookieJar } from './http';
import {
	PASSWORD_TEST,
	loginEnApp,
	limpiarIntegracion,
	clienteService,
	crearAdmin,
	crearCliente,
	type SesionApp,
	type UsuarioRol
} from './helpers';

/**
 * Parte 9 — Endpoints de monitoreo contra la app REAL (request → Supabase →
 * response): /api/metricas (solo admin), /api/errores (público), el cron de
 * alertas (secret) y la ruta de prueba que provoca un 500 a propósito.
 */

const CRON_SECRET = process.env.CRON_SECRET ?? '';

describe.skipIf(!INTEGRACION_DISPONIBLE)('Monitoreo (SvelteKit ↔ Supabase real)', () => {
	let admin: UsuarioRol;
	let cliente: UsuarioRol;
	let sesionAdmin: SesionApp;

	beforeAll(async () => {
		[admin, cliente] = await Promise.all([crearAdmin(), crearCliente()]);
		sesionAdmin = await loginEnApp(admin.email, PASSWORD_TEST);
	});

	afterAll(async () => {
		// Limpieza de las filas de monitoreo que esta suite crea (errores_app,
		// alertas) para que re-corridas sobre el mismo Supabase local no acumulen.
		const s = clienteService();
		await s.from('errores_app').delete().like('mensaje', '%integraci%');
		await s.from('errores_app').delete().like('mensaje', '%provocado a propósito%');
		await s.from('alertas').delete().eq('evento', 'alerta_prueba');
		await limpiarIntegracion();
	});

	describe('GET /api/metricas — solo admin', () => {
		test('anon → 401; cliente sin rol → 403', async () => {
			const rAnon = await peticion('/api/metricas');
			expect(rAnon.status).toBe(401);

			const jar = new CookieJar();
			jar.poner('stargo_access_token', cliente.token);
			const rCliente = await peticion('/api/metricas', { jar });
			expect(rCliente.status).toBe(403);
		});

		test('admin → 200 con la forma esperada', async () => {
			const r = await peticion<{
				data?: {
					pedidos_activos: number;
					tiempo_asignacion_prom_min: number | null;
					tiempo_entrega_prom_min: number | null;
					errores_por_minuto: number;
					errores_ultima_hora: number;
					alertas_recientes: unknown[];
					historial_tarifas: unknown[];
				};
				error?: string;
			}>('/api/metricas', { jar: sesionAdmin.jar });

			expect(r.status, r.data?.error).toBe(200);
			const d = r.data!.data!;
			expect(typeof d.pedidos_activos).toBe('number');
			expect(typeof d.errores_por_minuto).toBe('number');
			expect(Array.isArray(d.alertas_recientes)).toBe(true);
			expect(Array.isArray(d.historial_tarifas)).toBe(true);
		});
	});

	describe('POST /api/errores — público (reporte de frontend)', () => {
		test('anon reporta un error y queda en errores_app (verificado en BD)', async () => {
			const r = await peticion('/api/errores', {
				metodo: 'POST',
				cuerpo: { origen: 'cliente', tipo: 'unhandled', mensaje: 'Error integración', ruta: '/test' }
			});
			expect(r.status).toBe(200);

			const { data, error } = await clienteService()
				.from('errores_app')
				.select('origen, tipo, mensaje')
				.eq('mensaje', 'Error integración')
				.order('id', { ascending: false })
				.limit(1)
				.single();
			expect(error).toBeNull();
			expect(data).toMatchObject({ origen: 'cliente', tipo: 'unhandled' });
		});

		test('payload inválido no rompe (best-effort, 200)', async () => {
			const r = await peticion('/api/errores', {
				metodo: 'POST',
				cuerpo: { tipo: 123 }
			});
			expect(r.status).toBe(200);
		});
	});

	describe('POST /api/alertas/probar — provoca un 500 a propósito', () => {
		test('admin → 500 y el error queda en errores_app (verificado en BD)', async () => {
			const r = await peticion<{ error?: string }>('/api/alertas/probar', {
				metodo: 'POST',
				jar: sesionAdmin.jar
			});
			expect(r.status).toBe(500);
			expect(r.data?.error).toMatch(/provocado a propósito/);

			const { data } = await clienteService()
				.from('errores_app')
				.select('tipo, origen')
				.like('mensaje', '%provocado a propósito%')
				.order('id', { ascending: false })
				.limit(1)
				.single();
			expect(data).toMatchObject({ tipo: 'test', origen: 'servidor' });
		});

		test('anon → 401', async () => {
			const r = await peticion('/api/alertas/probar', { metodo: 'POST' });
			expect(r.status).toBe(401);
		});
	});

	describe('GET /api/cron/alertas — cron protegido por CRON_SECRET', () => {
		test('sin secret → 401; con secret inválido → 401', async () => {
			const rSin = await peticion('/api/cron/alertas');
			// Sin CRON_SECRET configurado el cron responde 503 (desactivado);
			// con secret configurado y sin credencial → 401.
			expect([401, 503]).toContain(rSin.status);

			if (CRON_SECRET) {
				const rMal = await peticion('/api/cron/alertas', {
					headers: { 'x-cron-secret': 'incorrecto' }
				});
				expect(rMal.status).toBe(401);
			}
		});

		test.skipIf(!CRON_SECRET)('con secret correcto → 200 y ejecuta los chequeos', async () => {
			const r = await peticion<{
				data?: { alertas: { evento: string }[]; webhook_configurado: boolean };
			}>('/api/cron/alertas', {
				headers: { 'x-cron-secret': CRON_SECRET }
			});
			expect(r.status).toBe(200);
			expect(Array.isArray(r.data?.data?.alertas)).toBe(true);
			expect(typeof r.data?.data?.webhook_configurado).toBe('boolean');
		});

		test.skipIf(!CRON_SECRET)('?prueba=1 registra la alerta de prueba en la bitácora', async () => {
			const r = await peticion<{ data?: { alertas: { evento: string; registrada: boolean }[] } }>(
				'/api/cron/alertas?prueba=1',
				{ headers: { 'x-cron-secret': CRON_SECRET } }
			);
			expect(r.status).toBe(200);
			const prueba = (r.data?.data?.alertas ?? []).find((a) => a.evento === 'alerta_prueba');
			expect(prueba, 'debería existir la alerta_prueba').toBeTruthy();
			expect(prueba!.registrada).toBe(true);

			// Verificado en la BD: la alerta quedó en la bitácora.
			const { data } = await clienteService()
				.from('alertas')
				.select('evento, nivel')
				.eq('evento', 'alerta_prueba')
				.order('id', { ascending: false })
				.limit(1)
				.single();
			expect(data?.nivel).toBe('info');
		});
	});
});
