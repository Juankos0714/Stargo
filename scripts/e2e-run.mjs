#!/usr/bin/env node
/**
 * Orquesta la suite E2E (Partes 5 y 6) — tests/e2e/*.spec.ts
 *
 * Compila la app con las variables públicas apuntando al Supabase de PRUEBAS,
 * levanta `vite preview` y corre Playwright contra http://127.0.0.1:4176
 * (Chromium + WebKit, viewports desktop y móvil). Sin mocks: navegador real,
 * HTTP real, Realtime real.
 *
 * Uso:
 *   bun run test:e2e            # toda la matriz de browsers/viewports
 *   bun run test:e2e:headed     # con ventana visible (debug local)
 *
 * Necesita SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
 * (carga .env.test si existe; ver .env.test.example). Sin credenciales la
 * suite se omite sin fallar.
 *
 * Opciones:
 *   TEST_BASE_URL=http://…   apunta a un servidor YA levantado (p. ej. un
 *                            preview de Vercel) — no compila ni levanta nada.
 *   TEST_SKIP_BUILD=1        reutiliza el build existente.
 *   TEST_PREVIEW_PORT=XXXX   puerto del preview (default 4176).
 *   E2E_PROJECTS=chromium-desktop,webkit-desktop   subset de projects.
 *
 * ⚠️ NUNCA apuntes la suite a un Supabase de producción: crea usuarios y datos.
 */
import { spawn, spawnSync } from 'node:child_process';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EXTERNO = process.env.TEST_BASE_URL?.trim() || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
	console.log('[test:e2e] Faltan SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY — suite omitida.');
	console.log('[test:e2e]   Copia .env.test.example a .env.test, levanta `supabase start` e instala los browsers:');
	console.log('[test:e2e]   bunx playwright install chromium webkit');
	process.exit(0);
}

const PORT = process.env.TEST_PREVIEW_PORT || '4176';
const BASE = `http://127.0.0.1:${PORT}`;
const PREFIJO_E2E = `e2e${Date.now().toString(36)}`;

/** Corre un comando heredando stdout/stderr; devuelve el status. */
function correr(cmd, args, envExtra = {}) {
	const r = spawnSync(cmd, args, {
		stdio: 'inherit',
		env: { ...process.env, ...envExtra }
	});
	return r.status ?? 1;
}

function correrPlaywright() {
	const args = ['x', 'playwright', 'test'];
	if (process.env.E2E_HEADED === '1') args.push('--headed');
	const projects = (process.env.E2E_PROJECTS ?? '').split(',').filter(Boolean);
	for (const p of projects) args.push('--project', p);
	return correr('bun', args, {
		TEST_BASE_URL: EXTERNO || BASE,
		E2E_PREFIJO: PREFIJO_E2E
	});
}

// -------- Modo servidor externo: solo correr los tests ---------------------
if (EXTERNO) {
	console.log(`[test:e2e] Usando servidor externo ${EXTERNO}`);
	process.exit(correrPlaywright());
}

// -------- Build con las variables públicas del Supabase de prueba ----------
if (process.env.TEST_SKIP_BUILD !== '1') {
	console.log(`[test:e2e] Compilando la app con PUBLIC_SUPABASE_URL=${SUPABASE_URL}`);
	const status = correr('bun', ['run', 'build'], {
		PUBLIC_SUPABASE_URL: SUPABASE_URL,
		PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY
	});
	if (status !== 0) {
		console.error('[test:e2e] Falló el build. Revisa los errores de arriba.');
		process.exit(status);
	}
} else {
	console.log('[test:e2e] TEST_SKIP_BUILD=1: reutilizando el build existente.');
}

// -------- Preview ----------------------------------------------------------
const preview = spawn('bun', ['run', 'preview', '--host', '127.0.0.1', '--port', PORT, '--strictPort'], {
	stdio: 'inherit',
	env: process.env,
	detached: process.platform !== 'win32'
});

async function esperarServidor() {
	for (let i = 0; i < 90; i++) {
		try {
			const r = await fetch(`${BASE}/`);
			if (r.ok || r.status < 500) return;
		} catch {
			// aún arrancando
		}
		await new Promise((res) => setTimeout(res, 1000));
	}
	throw new Error(`[test:e2e] El preview no respondió en ${BASE} tras 90s`);
}

function apagarPreview() {
	if (!preview.pid) return;
	if (process.platform === 'win32') {
		try {
			spawnSync('taskkill', ['/PID', String(preview.pid), '/T', '/F']);
		} catch {
			/* ya cerró */
		}
	} else {
		try {
			process.kill(-preview.pid, 'SIGTERM');
		} catch {
			try {
				preview.kill('SIGTERM');
			} catch {
				/* ya cerró */
			}
		}
	}
}

try {
	await esperarServidor();
	console.log(`[test:e2e] Preview listo en ${BASE}`);
	const status = correrPlaywright();
	apagarPreview();
	process.exit(status);
} catch (e) {
	console.error(e instanceof Error ? e.message : e);
	apagarPreview();
	process.exit(1);
}
