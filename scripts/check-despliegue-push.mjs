#!/usr/bin/env node
/**
 * Verifica qué versión está desplegada en el sitio de producción:
 *   - ¿El endpoint /api/push/probar existe? (401/400/500 = sí, 404 = no)
 *   - ¿El service worker desplegado incluye el respaldo postMessage?
 *   - ¿El bundle del cliente incluye la validación VAPID nueva (mensaje
 *     "generate-vapid-keys") y el botón «Enviar notificación de prueba»?
 *     Los chunks se extraen del PRECACHE del propio service worker desplegado.
 *
 * Uso: BASE_URL=https://stargo-zeta.vercel.app bun scripts/check-despliegue-push.mjs
 */
const BASE = (process.env.BASE_URL ?? 'https://stargo-zeta.vercel.app').replace(/\/$/, '');

async function get(path) {
	const res = await fetch(`${BASE}${path}`);
	return { status: res.status, text: await res.text().catch(() => '') };
}

const informe = {};

// 1. ¿El endpoint de diagnóstico está desplegado?
const probar = await fetch(`${BASE}/api/push/probar`, { method: 'POST' });
informe.endpoint_probar = probar.status === 404 ? 'NO desplegado (404)' : `Desplegado (HTTP ${probar.status} sin auth)`;

// 2. Service worker: respaldo postMessage «sonar»
const sw = await get('/service-worker.js');
informe.sw_tamano = `${(sw.text.length / 1024).toFixed(1)} KB`;
informe.sw_postMessage = sw.text.includes('sonar') ? 'Sí' : 'No';

// 3. Chunks del build: cualquier ruta /_app/immutable/*.js citada en el SW.
const rutas = [...sw.text.matchAll(/\/_app\/immutable\/[^"`'\s]+/g)].map((m) => m[0]);
const chunks = [...new Set(rutas.filter((r) => r.endsWith('.js')))];
const bundle = [];
for (const c of chunks) {
	const r = await fetch(`${BASE}${c}`);
	bundle.push(await r.text().catch(() => ''));
}
const todo = bundle.join('\n');
informe.chunks_analizados = chunks.length;
informe.validacion_vapid = todo.includes('generate-vapid-keys')
	? 'Sí (validación VAPID nueva desplegada)'
	: 'NO (código antiguo desplegado)';
informe.boton_prueba = todo.includes('Enviar notificación de prueba')
	? 'Sí (botón de diagnóstico desplegado)'
	: 'NO (botón no encontrado)';

// 4. Clave VAPID si aparece inline (los PUBLIC_ dinámicos no se inlinan).
const claves = [...new Set([...todo.matchAll(/[A-Za-z0-9_-]{86,88}/g)].map((m) => m[0]))].slice(0, 3);
informe.claves_vapid_candidatas = claves.length ? claves : 'no inline (env dinámico, esperado)';

console.log(JSON.stringify(informe, null, 2));
