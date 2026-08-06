#!/usr/bin/env node
/**
 * Orquesta la suite de integración (Parte 3) — tests/integration/*
 *
 * El flujo completo (request → Supabase → response) se prueba contra la app
 * REAL: se compila con las variables públicas apuntando al Supabase de
 * prueba y se levanta `vite preview`, de modo que los tests hacen HTTP de
 * verdad contra el mismo código que corre en producción (hooks, cookies,
 * SSR, redirects, endpoints). Sin mocks de Supabase.
 *
 * Uso:
 *   bun run test:integration
 *
 * Necesita SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
 * (carga .env.test si existe; ver .env.test.example). Sin credenciales la
 * suite se omite sin fallar.
 *
 * Opciones:
 *   TEST_BASE_URL=http://…   apunta a un servidor YA levantado (no compila
 *                            ni levanta preview; solo corre Vitest).
 *   TEST_SKIP_BUILD=1        reutiliza el build existente (no vuelve a
 *                            compilar; ahorra tiempo si no cambió el código).
 *   TEST_PREVIEW_PORT=XXXX   puerto del preview (default 4175).
 *
 * ⚠️ NUNCA apuntes la suite a un Supabase de producción: crea usuarios y datos.
 */
import { spawn, spawnSync } from 'node:child_process';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EXTERNO = process.env.TEST_BASE_URL?.trim() || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
	console.log('[test:integration] Faltan SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY — suite omitida.');
	console.log('[test:integration]   Copia .env.test.example a .env.test y levanta `supabase start`.');
	process.exit(0);
}

const PORT = process.env.TEST_PREVIEW_PORT || '4175';
const BASE = `http://127.0.0.1:${PORT}`;

/** Corre un comando heredando stdout/stderr; devuelve el status. */
function correr(cmd, args, envExtra = {}) {
	const r = spawnSync(cmd, args, {
		stdio: 'inherit',
		env: { ...process.env, ...envExtra }
	});
	return r.status ?? 1;
}

function correrVitest() {
	return correr('bun', ['vitest', 'run', '--config', 'vitest.integration.config.ts'], {
		TEST_BASE_URL: EXTERNO || BASE
	});
}

// -------- Modo servidor externo: solo correr los tests ---------------------
if (EXTERNO) {
	console.log(`[test:integration] Usando servidor externo ${EXTERNO}`);
	process.exit(correrVitest());
}

// -------- Build con las variables públicas del Supabase de prueba ----------
// Vite da prioridad a las variables ya presentes en process.env sobre las de
// .env, así que el build se hace con los URLs locales aunque exista un .env
// de producción en la raíz.
if (process.env.TEST_SKIP_BUILD !== '1') {
	console.log(`[test:integration] Compilando la app con PUBLIC_SUPABASE_URL=${SUPABASE_URL}`);
	const status = correr('bun', ['run', 'build'], {
		PUBLIC_SUPABASE_URL: SUPABASE_URL,
		PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY
	});
	if (status !== 0) {
		console.error('[test:integration] Falló el build. Revisa los errores de arriba.');
		process.exit(status);
	}
} else {
	console.log('[test:integration] TEST_SKIP_BUILD=1: reutilizando el build existente.');
}

// -------- Preview ----------------------------------------------------------
// detached en POSIX: el preview corre en su propio grupo de procesos y el
// teardown mata el grupo entero (bun → vite), sin huérfanos.
const preview = spawn('bun', ['run', 'preview', '--host', '127.0.0.1', '--port', PORT, '--strictPort'], {
	stdio: 'inherit',
	env: process.env,
	detached: process.platform !== 'win32'
});

async function esperarServidor() {
	for (let i = 0; i < 90; i++) {
		try {
			const r = await fetch(`${BASE}/`);
			if (r.ok || r.status < 500) return; // 303/4xx también implican que responde
		} catch {
			// aún arrancando
		}
		await new Promise((res) => setTimeout(res, 1000));
	}
	throw new Error(`[test:integration] El preview no respondió en ${BASE} tras 90s`);
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
		// Mata el grupo de procesos (el preview se lanzó detached).
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
	console.log(`[test:integration] Preview listo en ${BASE}`);
	const status = correrVitest();
	apagarPreview();
	process.exit(status);
} catch (e) {
	console.error(e instanceof Error ? e.message : e);
	apagarPreview();
	process.exit(1);
}
