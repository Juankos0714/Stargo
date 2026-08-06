#!/usr/bin/env node
/**
 * Verificación del sistema de alertas (Parte 9 — entregable).
 *
 * «Provocar un error a propósito en staging y confirmar que la alerta llega».
 * Este script hace las DOS comprobaciones contra un servidor ya levantado:
 *
 *   1. GET /api/cron/alertas?prueba=1 — fuerza una alerta de prueba que debe
 *      llegar al webhook (Slack/Discord/Telegram) y registrarse en la tabla
 *      `alertas` (visible en /admin/metricas).
 *   2. POST /api/alertas/probar — provoca un error 500 a propósito; debe
 *      aparecer en Sentry (Issues) y en errores_app (tasa de 5xx del
 *      dashboard).
 *
 * Uso:
 *   BASE_URL=https://tu-app.vercel.app CRON_SECRET=... bun run test:alertas
 *
 * Necesita:
 *   BASE_URL        — URL de la app (staging/preview/producción).
 *   CRON_SECRET     — mismo valor que la env var CRON_SECRET del deploy.
 *   ADMIN_EMAIL / ADMIN_PASSWORD — un admin real de la app (solo para el
 *                     paso 2; si faltan, ese paso se omite con aviso).
 *
 * Salida: mensajes por paso; exit 0 si todo lo configurado llegó bien.
 */
const BASE = (process.env.BASE_URL ?? '').replace(/\/$/, '');
const SECRET = process.env.CRON_SECRET ?? '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';

if (!BASE) {
	console.error('[alertas] Falta BASE_URL. Uso: BASE_URL=... CRON_SECRET=... bun run test:alertas');
	process.exit(2);
}

async function jsonFetch(path, opts = {}) {
	const res = await fetch(`${BASE}${path}`, {
		...opts,
		headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) }
	});
	let body = null;
	try {
		body = await res.json();
	} catch {
		body = null;
	}
	return { status: res.status, ok: res.ok, body };
}

let fallos = 0;

// ---- Paso 1: alerta de prueba del cron ------------------------------------
if (!SECRET) {
	console.warn('[alertas] Sin CRON_SECRET: se omite el paso 1 (alerta de prueba).');
} else {
	console.log('[alertas] Paso 1: disparando alerta de prueba (?prueba=1)…');
	const r = await jsonFetch(`/api/cron/alertas?prueba=1`, {
		method: 'GET',
		headers: { 'x-cron-secret': SECRET }
	});
	if (r.ok && r.body?.data) {
		const alertas = r.body.data.alertas ?? [];
		const prueba = alertas.find((a) => a.evento === 'alerta_prueba');
		console.log(`  ✓ Cron respondió: ${alertas.length} alerta(s), webhook_configurado=${r.body.data.webhook_configurado}`);
		if (prueba) {
			console.log(`    alerta_prueba: registrada=${prueba.registrada}, enviada_webhook=${prueba.enviada_webhook}`);
			if (!prueba.enviada_webhook && r.body.data.webhook_configurado) {
				console.warn('    ⚠ La alerta se registró pero el webhook NO confirmó el envío.');
			}
		}
	} else {
		fallos++;
		console.error(`  ✗ Falló (status ${r.status}): ${JSON.stringify(r.body)}`);
	}
}

// ---- Paso 2: error 500 provocado (Sentry + errores_app) --------------------
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
	console.warn('[alertas] Sin ADMIN_EMAIL/ADMIN_PASSWORD: se omite el paso 2 (error 500).');
} else {
	console.log('[alertas] Paso 2: provocando error 500 (login + POST /api/alertas/probar)…');
	// Login del admin (misma sesión por cookies que el navegador).
	const login = await jsonFetch('/api/login', {
		method: 'POST',
		body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
	});
	const jar = [];
	for (const par of (login.headers?.getSetCookie?.() ?? [])) {
		jar.push(par.split(';')[0]);
	}
	const cookie = jar.join('; ');
	if (!cookie) {
		fallos++;
		console.error(`  ✗ No se obtuvo sesión de admin (status ${login.status}).`);
	} else {
		const r = await jsonFetch('/api/alertas/probar', {
			method: 'POST',
			headers: { Cookie: cookie }
		});
		console.log(`  ${r.status === 500 ? '✓' : '✗'} Respuesta esperada 500 (obtenida ${r.status}).`);
		if (r.status !== 500) fallos++;
		console.log('    Verifica en Sentry → Issues: «Error provocado a propósito…»');
		console.log('    Verifica en /admin/metricas → Errores por minuto > 0.');
	}
}

console.log('---');
if (fallos > 0) {
	console.error(`[alertas] ${fallos} paso(s) fallaron. Revisa arriba.`);
	process.exit(1);
}
console.log('[alertas] OK. Recuerda verificar en el webhook y/o Sentry que las notificaciones llegaron.');
