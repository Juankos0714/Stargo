/**
 * Prueba real del sonido de notificaciones en MÓVIL EMULADO.
 *
 * Flujo (navegador Chromium con viewport de teléfono, touch habilitado):
 *   1. Hook de auditoría: instrumenta AudioContext para contar contextos,
 *      resume() y osciladores creados (la campana crea 8 osciladores).
 *   2. Login admin real.
 *   3. Gestos de desbloqueo (clics) → el AudioContext debe crear/resumir.
 *   4. Crear un pedido por la API pública → trigger → INSERT en notificaciones
 *      → Realtime → la campana debe SONAR (osciladores aumentan).
 *
 * Uso: node scripts/probar-sonido-movil.mjs
 * Necesita el dev server en http://localhost:5173 y credenciales en el env:
 *   ADMIN_EMAIL / ADMIN_PASSWORD
 */
import { chromium, devices } from '@playwright/test';
import { env } from 'node:process';

const BASE = 'http://localhost:5173';
const EMAIL = env.ADMIN_EMAIL ?? '';
const PASSWORD = env.ADMIN_PASSWORD ?? '';
if (!EMAIL || !PASSWORD) {
	console.error('Faltan ADMIN_EMAIL / ADMIN_PASSWORD');
	process.exit(2);
}

// Instrumentación: se inyecta ANTES de cualquier script de la página.
const PROBE = `
window.__probeAudio = { creados: 0, resumidos: 0, osciladores: 0 };
(() => {
	// Cuenta instancias creadas envolviendo el constructor.
	const envolver = (Ctor, key) => {
		if (!Ctor) return Ctor;
		const Wrapped = function (...a) {
			window.__probeAudio.creados++;
			return Reflect.construct(Ctor, a, new.target || Ctor);
		};
		Wrapped.prototype = Ctor.prototype;
		window[key] = Wrapped;
		return Wrapped;
	};
	const hook = (Ctor) => {
		if (!Ctor) return;
		const origOsc = Ctor.prototype.createOscillator;
		Ctor.prototype.createOscillator = function (...a) {
			window.__probeAudio.osciladores++;
			return origOsc.apply(this, a);
		};
		const origResume = Ctor.prototype.resume;
		Ctor.prototype.resume = function (...a) {
			window.__probeAudio.resumidos++;
			return origResume.apply(this, a);
		};
	};
	const AC = envolver(window.AudioContext, 'AudioContext');
	const WAC = envolver(window.webkitAudioContext, 'webkitAudioContext');
	hook(AC);
	hook(WAC);
})();
`;

const telefono = { ...devices['iPhone 12'] }; // 390x844, touch
const browser = await chromium.launch();
const context = await browser.newContext({ ...telefono, baseURL: BASE });
await context.addInitScript(PROBE);
const page = await context.newPage();

const errores = [];
const debugCampana = [];
page.on('console', (m) => {
	if (m.text().startsWith('[DEBUG-CAMPANA]')) debugCampana.push(m.text().replace('[DEBUG-CAMPANA] ', ''));
	if (m.type() === 'error') errores.push(`console.error: ${m.text()}`);
});
page.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));	const probe = () => page.evaluate(() => window.__probeAudio);

try {
	// ---- Login -------------------------------------------------------------
	console.log('→ Abriendo /login en móvil (390x844, touch)…');
	await page.goto('/login', { waitUntil: 'networkidle' });
	const ancho = await page.evaluate(() => window.innerWidth);
	console.log(`  viewport ancho: ${ancho}px (${ancho < 768 ? 'MÓVIL ✓' : 'no móvil ✗'})`);

	await page.fill('#email', EMAIL);
	await page.fill('#password', PASSWORD);
	await page.getByRole('button', { name: 'Iniciar sesión' }).click();
	try {
		await page.waitForURL('**/admin**', { timeout: 25_000 });
		console.log('  login admin OK → /admin');
	} catch {
		const url = page.url();
		const errText = await page
			.evaluate(() => document.querySelector('[class*=red]')?.textContent ?? document.body.innerText.slice(0, 200))
			.catch(() => 'no capturado');
		console.log(`  ⚠ login falló: url=${url}`);
		console.log(`  texto visible: ${errText}`);
		await page.screenshot({ path: '/tmp/sonido-login-error.png' }).catch(() => {});
		throw new Error('login fallido');
	}

	// ---- Gesto de desbloqueo -----------------------------------------------
	const base0 = await probe();
	console.log(`  probe ANTES del gesto: ${JSON.stringify(base0)}`);
	// Toca el topbar (área vacía) + la campana: gestos que deben desbloquear.
	await page.locator('header').click({ position: { x: 100, y: 20 } }).catch(() => {});
	// Puede haber 2 campanas (sidebar desktop + topbar móvil); tocamos la visible.
	const campana = page.locator('[aria-label="Notificaciones"]:visible').first();
	await campana.click();
	const base1 = await probe();
	console.log(`  probe TRAS el gesto (campana abierta): ${JSON.stringify(base1)}`);
	await page.keyboard.press('Escape').catch(() => {});
	await page.locator('body').click({ position: { x: 200, y: 600 } }).catch(() => {});

	// ---- Esperar a que Realtime esté suscrito (evita perder el INSERT) -----
	// Realtime NO reenvía eventos pasados: si el pedido se crea antes del
	// SUBSCRIBED, el INSERT se pierde y la campana nunca suena. En las
	// pruebas el canal quedó SUBSCRIBED en < 3 s tras el login; se espera
	// ese margen fijo antes de crear el pedido.
	console.log('  Esperando 3 s a que el canal Realtime quede suscrito…');
	await page.waitForTimeout(3000);

	// ---- Crear pedido real (dispara INSERT en notificaciones) --------------
	console.log('→ Creando pedido por API pública…');
	const pedido = await page.evaluate(async () => {
		const r = await fetch('/api/barrios');
		const b = await r.json();
		const ids = (b.data ?? []).slice(0, 2).map((x) => x.id);
		if (ids.length < 2) return { error: 'no hay 2 barrios', barrios: b };
		const p = await fetch('/api/pedidos', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				barrio_origen: ids[0],
				direccion_origen: 'Prueba sonido movil origen',
				barrio_destino: ids[1],
				direccion_destino: 'Prueba sonido movil destino',
				observaciones: 'Prueba automatica sonido movil',
				recargos: [],
				recargos_confirmados_no_aplica: true,
				// Fase 19: el teléfono es obligatorio al crear el pedido.
				telefono: '3001234567'
			})
		});
		const pd = await p.json();
		return { status: p.status, body: pd };
	});
	console.log(`  POST /api/pedidos → ${JSON.stringify(pedido).slice(0, 300)}`);

	const idPedido = pedido.body?.data?.pedido_id ?? pedido.body?.data?.id ?? null;
	if (!idPedido) {
		console.log('  ⚠ No se pudo crear el pedido de prueba; sin INSERT no hay campana.');
		await page.screenshot({ path: '/tmp/sonido-movil-error.png' }).catch(() => {});
		await context.close();
		await browser.close();
		process.exit(2);
	}

	// ---- Verificar que SONÓ -------------------------------------------------
	console.log('→ Esperando 10 s a que Realtime entregue la notificación…');
	await page.waitForTimeout(10_000);
	const base2 = await probe();
	console.log(`  probe FINAL: ${JSON.stringify(base2)}`);

	const badge = await page
		.evaluate(() => document.querySelector('[aria-label="Notificaciones"] span')?.textContent ?? 'sin badge')
		.catch(() => 'sin badge');
	const campanas = await page
		.evaluate(() => document.querySelectorAll('[aria-label="Notificaciones"]').length)
		.catch(() => -1);

	console.log('--- RESULTADO ---');
	console.log(`  campanas montadas: ${campanas}`);
	console.log(`  badge de la campana: ${badge}`);
	console.log(
		`  osciladores: base=${base0.osciladores} → tras gesto=${base1.osciladores} → final=${base2.osciladores}`
	);
	console.log(`  resume() llamados: ${base2.resumidos} | contextos creados: ${base2.creados}`);

	// ---- Limpieza: cancelar el pedido de prueba (público, por código) ----
	try {
		const numero = pedido.body?.data?.numero ?? null;
		if (numero) {
			const can = await page.evaluate(async (n) => {
				const r = await fetch('/api/pedidos/cancelar', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ numero: n, motivo: 'Prueba sonido movil' })
				});
				return r.status;
			}, numero);
			console.log(`  Pedido de prueba ${numero} cancelado (→ ${can}).`);
		} else {
			console.log(`  ⚠ Sin número para cancelar el pedido ${idPedido}.`);
		}
	} catch (e) {
		console.log(`  ⚠ No se pudo cancelar el pedido ${idPedido}: ${e.message}`);
	}

	console.log('--- Eventos Realtime (DEBUG-CAMPANA) ---');
	(debugCampana.length > 0 ? debugCampana : ['(ninguno capturado)']).forEach((d) => console.log(`  ${d}`));

	const sonOsc = base2.osciladores > base1.osciladores;
	console.log(`  desglose: base1=${base1.osciladores} → final=${base2.osciladores}`);
	const huboResume = base1.resumidos >= 1 || base2.resumidos >= 1;
	console.log(
		sonOsc
			? '  ✅ LA CAMPANA SONÓ: los osciladores aumentaron tras crear el pedido.'
			: '  ❌ No se detectaron nuevos osciladores tras el pedido.'
	);
	console.log(
		huboResume
			? '  ✅ El AudioContext se desbloqueó (resume llamado tras gesto).'
			: '  ⚠️ El AudioContext NO se resumió tras el gesto.'
	);

	if (errores.length > 0) {
		console.log('--- Errores de consola ---');
		errores.slice(0, 10).forEach((e) => console.log(`  ${e}`));
	} else {
		console.log('  Sin errores de consola.');
	}

	// Pantalla final (debug)
	await page.screenshot({ path: '/tmp/sonido-movil-final.png', fullPage: false }).catch(() => {});
	await context.close();
	await browser.close();
	process.exit(sonOsc ? 0 : 1);
} catch (e) {
	console.error('Fallo de la prueba:', e);
	await page.screenshot({ path: '/tmp/sonido-movil-error.png' }).catch(() => {});
	await context.close();
	await browser.close();
	process.exit(1);
}
