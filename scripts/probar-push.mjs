#!/usr/bin/env node
/**
 * Diagnóstico de las notificaciones push (Web Push, Fase 15).
 *
 * Cuando la notificación «solo suena al entrar a la app», el push del sistema
 * no se está entregando. Este script prueba la cadena completa contra un
 * servidor ya levantado:
 *
 *   1. Login real con un admin (o domiciliario).
 *   2. POST /api/push/probar → el servidor cuenta las suscripciones del
 *      usuario y llama DIRECTAMENTE a la Edge Function send-push con un
 *      payload de prueba (no depende del webhook del dashboard).
 *   3. Según el resultado se identifica el eslabón roto:
 *      - «SIN SUSCRIPCIÓN» → nunca se activó el push en este navegador.
 *      - «EDGE FUNCTION INALCANZABLE / CON ERROR» → send-push no está
 *        desplegada o los secrets VAPID no están bien.
 *      - «OK — push enviado» pero el teléfono no recibió nada → el webhook
 *        del dashboard (INSERT en notificaciones → send-push) está mal.
 *
 * Tras la prueba, con la app CERRADA debes ver la notificación del sistema.
 *
 * Uso:
 *   BASE_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... bun run test:push
 *
 * Necesita:
 *   BASE_URL        — URL de la app (staging/preview/producción).
 *   ADMIN_EMAIL / ADMIN_PASSWORD — un admin real (o el que activó el push).
 */
const BASE = (process.env.BASE_URL ?? '').replace(/\/$/, '');
const EMAIL = process.env.ADMIN_EMAIL ?? '';
const PASSWORD = process.env.ADMIN_PASSWORD ?? '';

if (!BASE) {
	console.error('[push] Falta BASE_URL. Uso: BASE_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... bun run test:push');
	process.exit(2);
}
if (!EMAIL || !PASSWORD) {
	console.error('[push] Faltan ADMIN_EMAIL / ADMIN_PASSWORD');
	process.exit(2);
}

let fallos = 0;

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

// ---- Paso 1: login (misma sesión por cookies que el navegador) ------------
console.log(`[push] Paso 1: login con ${EMAIL}…`);
const login = await jsonFetch('/api/login', {
	method: 'POST',
	body: JSON.stringify({ email: EMAIL, password: PASSWORD })
});
const jar = [];
for (const par of login.headers?.getSetCookie?.() ?? []) jar.push(par.split(';')[0]);
const cookie = jar.join('; ');
if (!cookie) {
	console.error(`  ✗ No se obtuvo sesión (status ${login.status}): ${JSON.stringify(login.body)}`);
	process.exit(1);
}
console.log('  ✓ Sesión obtenida.');

// ---- Paso 2: prueba de push ----------------------------------------------
console.log('[push] Paso 2: diagnóstico de la cadena (POST /api/push/probar)…');
console.log('  → Con la app CERRADA debes recibir 2 push: «(directo)» y «(webhook)».');
const r = await jsonFetch('/api/push/probar', { method: 'POST', headers: { Cookie: cookie } });

if (!r.ok && !r.body?.data) {
	fallos++;
	console.error(`  ✗ Falló (status ${r.status}): ${JSON.stringify(r.body)}`);
} else {
	const data = r.body?.data ?? {};
	console.log(`  Suscripciones guardadas: ${data.suscripciones ?? '?'}`);
	console.log(`  Push enviados (vía directa): ${data.enviadas ?? 0}`);
	console.log(`  Diagnóstico: ${data.diagnostico ?? '?'}`);
	for (const linea of (data.detalle ?? '—').split('\n')) console.log(`    ${linea}`);

	if (data.diagnostico === 'TODO OK') {
		console.log('  ✓ La cadena completa respondió.');
		console.log('    ¿Te llegaron AMBOS banners? Si solo el «(directo)», el WEBHOOK está mal:');
		console.log('    Supabase → Database → Webhooks → INSERT en public.notificaciones → send-push.');
	} else {
		fallos++;
		console.error(`  ⚠ Eslabón roto: ${data.diagnostico ?? 'desconocido'} (lee el detalle arriba).`);
	}
}

console.log('---');
if (fallos > 0) {
	console.error(`[push] ${fallos} problema(s). Revisa arriba.`);
	process.exit(1);
}
console.log('[push] OK. ¿Te llegó la notificación con la app cerrada?');
