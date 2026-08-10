/**
 * Verificación del fix: DELETE /api/pedidos (GRANT de la Fase 8).
 *
 * Flujo:
 *   1. Login admin real (misma sesión que usa el endpoint).
 *   2. Crea un pedido de prueba por la API pública.
 *   3. Lo borra con DELETE /api/pedidos?id=... (endpoint exacto que fallaba).
 *   4. Confirma que NO devuelve "permission denied" y que el pedido ya no existe.
 *
 * Uso: ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/verificar-delete-pedidos.mjs
 * Necesita el dev server en http://localhost:5173 (usa el Supabase remoto).
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

async function main() {
	// ---- Login admin -----------------------------------------------------
	console.log('→ Login admin…');
	await page.goto('/login', { waitUntil: 'networkidle' });
	await page.fill('#email', EMAIL);
	await page.fill('#password', PASSWORD);
	await page.getByRole('button', { name: 'Iniciar sesión' }).click();
	await page.waitForURL('**/admin**', { timeout: 25_000 });
	console.log('  login OK');

	// ---- Crear pedido de prueba -------------------------------------------
	console.log('→ Creando pedido de prueba…');
	const creado = await page.evaluate(async () => {
		const r = await fetch('/api/barrios');
		const b = await r.json();
		const ids = (b.data ?? []).slice(0, 2).map((x) => x.id);
		if (ids.length < 2) return { error: 'no hay 2 barrios', barrios: b };
		const p = await fetch('/api/pedidos', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				barrio_origen: ids[0],
				direccion_origen: 'Verif delete origen',
				barrio_destino: ids[1],
				direccion_destino: 'Verif delete destino',
				observaciones: 'Verificacion fix DELETE pedidos',
				recargos: [],
				recargos_confirmados_no_aplica: true,
				// Fase 19: el teléfono es obligatorio al crear el pedido.
				telefono: '3001234567'
			})
		});
		const pd = await p.json();
		return { status: p.status, data: pd.data ?? pd, err: pd.error ?? null };
	});
	console.log(`  POST /api/pedidos → ${JSON.stringify(creado).slice(0, 250)}`);
	const idPedido = creado.data?.pedido_id ?? creado.data?.id ?? null;
	if (!idPedido) {
		console.log('  ⚠ No se pudo crear el pedido de prueba. ¿El remoto sigue OK?');
		process.exitCode = 2;
		return;
	}

	// ---- DELETE /api/pedidos (el endpoint que fallaba) --------------------
	console.log(`→ DELETE /api/pedidos?id=${idPedido}…`);
	const borrado = await page.evaluate(async (id) => {
		const r = await fetch('/api/pedidos?id=' + id, { method: 'DELETE' });
		const body = await r.json().catch(() => ({}));
		return { status: r.status, body };
	}, idPedido);
	console.log(`  DELETE → status=${borrado.status} body=${JSON.stringify(borrado.body)}`);

	// ---- Confirmar que el pedido ya no existe -----------------------------
	console.log('→ Verificando que el pedido ya no existe…');
	const existe = await page.evaluate(async (id) => {
		const r = await fetch('/api/pedidos?select=id');
		const b = await r.json();
		const pedidos = b.data ?? [];
		const encontrado = pedidos.find((p) => p.id === id);
		return { total: pedidos.length, existe: Boolean(encontrado) };
	}, idPedido);
	console.log(`  pedidos visibles para el admin: ${existe.total}, el de prueba existe? ${existe.existe}`);

	// ---- Veredicto ---------------------------------------------------------
	console.log('--- RESULTADO ---');
	const ok = borrado.status === 200 && !existe.existe;
	if (borrado.body?.error === 'permission denied for table pedidos') {
		console.log('  ❌ SIGUE FALLANDO: permission denied. El GRANT no se aplicó (¿lo ejecutaste como rol POSTGRES?).');
		process.exitCode = 1;
	} else if (ok) {
		console.log('  ✅ FIX CONFIRMADO: DELETE /api/pedidos funcionó y el pedido ya no existe.');
	} else {
		console.log(`  ⚠ Resultado inesperado: status=${borrado.status} body=${JSON.stringify(borrado.body)}`);
		process.exitCode = 1;
	}
}

try {
	await main();
} catch (e) {
	console.error('Fallo de la verificación:', e);
	process.exitCode = 1;
} finally {
	await context.close();
	await browser.close();
}
