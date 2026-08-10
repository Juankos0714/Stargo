#!/usr/bin/env node
/**
 * Verifica el PAREADO VAPID sin credenciales:
 *
 * La Edge Function send-push tiene verify_jwt=false y su modo diagnóstico
 * (`{"diagnostico": true}`) NO envía nada: solo responde si las secrets
 * VAPID existen y la huella SHA-256 (base64url) de su clave pública.
 *
 * Se compara esa huella con la de PUBLIC_VAPID_PUBLIC_KEY (la que usa el
 * navegador al suscribirse). Si difieren → VAPID DESPAREJADO: la privada que
 * firma en Supabase no es la pareja de la pública del cliente, y TODOS los
 * push fallan en silencio con 401/403. Es la causa nº 1 de «no llega nada».
 *
 * Necesita SUPABASE_URL (o la variable PUBLIC_SUPABASE_URL del .env) para
 * derivar la URL de la función, y opcionalmente VAPID_PUBLIC_KEY_PROPIA con
 * la clave pública a comparar (por defecto lee PUBLIC_VAPID_PUBLIC_KEY del
 * .env).
 *
 * Uso:
 *   bun scripts/verificar-vapid.mjs
 *   VAPID_PUBLIC_KEY_PROPIA=... bun scripts/verificar-vapid.mjs
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

function huella(clave) {
	return createHash('sha256').update(clave.trim()).digest('base64url');
}

// --- Clave del cliente -----------------------------------------------------
let claveCliente = process.env.VAPID_PUBLIC_KEY_PROPIA ?? '';
if (!claveCliente) {
	try {
		const env = readFileSync('.env', 'utf8');
		const m = env.match(/^PUBLIC_VAPID_PUBLIC_KEY=(.+)$/m);
		claveCliente = (m?.[1] ?? '').trim();
	} catch {
		claveCliente = '';
	}
}

// --- URL de la Edge Function ----------------------------------------------
let supabaseUrl = process.env.SUPABASE_URL ?? '';
if (!supabaseUrl) {
	try {
		const env = readFileSync('.env', 'utf8');
		supabaseUrl = env.match(/^PUBLIC_SUPABASE_URL=(.+)$/m)?.[1]?.trim() ?? '';
	} catch {
		supabaseUrl = '';
	}
}

const ref = supabaseUrl ? new URL(supabaseUrl).hostname.split('.')[0] : '';
const edgeUrl = `https://${ref}.functions.supabase.co/send-push`;

console.log(`[vapid] Edge Function: ${edgeUrl}`);

let res;
try {
	res = await fetch(edgeUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		signal: AbortSignal.timeout(15_000),
		body: JSON.stringify({ diagnostico: true })
	});
} catch (e) {
	console.error(`[vapid] ✗ No se pudo llamar a la Edge Function: ${e.message}`);
	console.error('[vapid]   ¿Está desplegada send-push? ¿Proyecto ref correcto?');
	process.exit(1);
}

const texto = await res.text();
let diag = null;
try {
	diag = JSON.parse(texto)?.diagnostico;
} catch {
	diag = null;
}

if (!diag) {
	console.error(`[vapid] ✗ La Edge Function respondió ${res.status}: ${texto.slice(0, 200)}`);
	console.error('[vapid]   Si es «ok» (texto plano), NO está desplegado el modo diagnóstico:');
	console.error('[vapid]   → supabase login && supabase functions deploy send-push');
	process.exit(1);
}

console.log(`[vapid] Secrets VAPID configuradas en send-push: ${diag.vapid_configurado ? 'SÍ' : 'NO'}`);
if (!diag.vapid_configurado) {
	console.error('[vapid] ✗ VAPID SIN CONFIGURAR: añade VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY');
	console.error('[vapid]   en Supabase → Edge Functions → Secrets de send-push.');
	process.exit(1);
}

console.log(`[vapid] Huella de send-push (Supabase): ${diag.huella}`);

if (!claveCliente) {
	console.warn('[vapid] ⚠ No se encontró PUBLIC_VAPID_PUBLIC_KEY para comparar.');
	console.warn('[vapid]   Pásala con: VAPID_PUBLIC_KEY_PROPIA=... bun scripts/verificar-vapid.mjs');
	process.exit(1);
}

const h = huella(claveCliente);
console.log(`[vapid] Huella del cliente (${claveCliente.slice(0, 24)}…): ${h}`);

if (h === diag.huella) {
	console.log('[vapid] ✓ VAPID PAREADO: la pública del cliente es la misma pareja de la privada de send-push.');
	process.exit(0);
}

console.error('[vapid] ✗ VAPID DESPAREJADO: las claves NO son la misma pareja.');
console.error('[vapid]   TODOS los push fallan en silencio (401/403).');
console.error('[vapid]   Solución: copia el MISMO publicKey a Vercel (PUBLIC_VAPID_PUBLIC_KEY) y a');
console.error('[vapid]   send-push (VAPID_PUBLIC_KEY), o regenera el par con:');
console.error('[vapid]     npx web-push generate-vapid-keys --json');
process.exit(1);
