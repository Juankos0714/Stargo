/**
 * Limpieza post-prueba: marca como leídas todas las notificaciones
 * pendientes del admin (las dejaron los pedidos de prueba del sonido).
 * Uso: ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/limpiar-notificaciones.mjs
 */
import { chromium } from '@playwright/test';
import { env } from 'node:process';

const BASE = 'http://localhost:5173';
const EMAIL = env.ADMIN_EMAIL ?? '';
const PASSWORD = env.ADMIN_PASSWORD ?? '';
if (!EMAIL || !PASSWORD) {
	console.error('Faltan ADMIN_EMAIL / ADMIN_PASSWORD');
	process.exit(2);
}

const browser = await chromium.launch();
const context = await browser.newContext({ baseURL: BASE });
const page = await context.newPage();

try {
	await page.goto('/login', { waitUntil: 'networkidle' });
	await page.fill('#email', EMAIL);
	await page.fill('#password', PASSWORD);
	await page.getByRole('button', { name: 'Iniciar sesión' }).click();
	await page.waitForURL('**/admin**', { timeout: 25_000 });
	console.log('login OK');

	const res = await page.evaluate(async () => {
		const r = await fetch('/api/notificaciones');
		const b = await r.json();
		const ids = (b.data ?? []).map((n) => n.id);
		if (ids.length === 0) return { pendientes: 0 };
		const u = await fetch('/api/notificaciones', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ids })
		});
		const ub = await u.json();
		return { pendientes: ids.length, marcadas: ub.data?.actualizadas ?? ub.error };
	});
	console.log('resultado:', JSON.stringify(res));
} catch (e) {
	console.error('Fallo:', e.message);
	process.exitCode = 1;
} finally {
	await context.close();
	await browser.close();
}
