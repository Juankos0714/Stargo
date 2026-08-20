/**
 * Build script para Capacitor (cross-platform).
 *
 * 1. Mueve archivos .server.ts (Sentry, Supabase server loads) fuera del
 *    alcance de adapter-static, que los rechaza o genera __data.json
 *    que no existen offline.
 * 2. Inyecta variables de entorno de producción para Capacitor:
 *    - PUBLIC_API_BASE_URL → backend Vercel (rutas /api/*)
 *    - PUBLIC_SUPABASE_URL → Supabase en la nube (Realtime, Auth)
 * 3. Ejecuta vite build con CAPACITOR_BUILD=true.
 * 4. Restaura los archivos.
 */
import { execSync } from 'node:child_process';
import { existsSync, renameSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = resolve(ROOT, 'src');

/**
 * Walk a directory recursively and return all files matching a predicate.
 */
function findFiles(dir, predicate, results = []) {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			findFiles(full, predicate, results);
		} else if (predicate(full)) {
			results.push(full);
		}
	}
	return results;
}

/**
 * Parse .env file and return key-value pairs (simple parser, no quoting).
 */
function parseEnv(filePath) {
	if (!existsSync(filePath)) return {};
	const lines = readFileSync(filePath, 'utf-8').split('\n');
	const env = {};
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		const val = trimmed.slice(eq + 1).trim();
		// Strip surrounding quotes if present
		env[key] = val.replace(/^['"]|['"]$/g, '');
	}
	return env;
}

// Collect server-only files to temporarily move out of the way:
// - instrumentation.server.ts (Sentry — adapter-static rejects it)
// - +page.server.ts / +layout.server.ts (generate __data.json that
//   can't be served offline in Capacitor)
const serverFiles = [
	resolve(ROOT, 'src/instrumentation.server.ts'),
	...findFiles(SRC, (f) => /\+(?:page|layout)\.server\.(ts|js)$/.test(f))
];

const moved = [];

try {
	// 1. Move server files out of the way
	for (const file of serverFiles) {
		if (existsSync(file)) {
			renameSync(file, file + '.bak');
			moved.push(file);
		}
	}

	// 2. Load .env and inject production values for Capacitor
	const baseEnv = parseEnv(resolve(ROOT, '.env'));
	const capacitorEnv = parseEnv(resolve(ROOT, '.env.capacitor'));

	// .env.capacitor overrides .env; hardcoded fallbacks as last resort
	const buildEnv = {
		...baseEnv,
		...capacitorEnv,
		CAPACITOR_BUILD: 'true',
		// Ensure production Supabase URL (project ref from anon key)
		PUBLIC_SUPABASE_URL: capacitorEnv.PUBLIC_SUPABASE_URL
			?? 'https://u3wzjfkcydhrjnymspkt.supabase.co',
		// Ensure production API base URL for /api/* routes
		PUBLIC_API_BASE_URL: capacitorEnv.PUBLIC_API_BASE_URL
			?? 'https://stargo-zeta.vercel.app'
	};

	// 3. Build con CAPACITOR_BUILD=true
	execSync('npx vite build', {
		cwd: ROOT,
		stdio: 'inherit',
		env: { ...process.env, ...buildEnv }
	});

	console.log('\n✅ Build de Capacitor completado exitosamente.');
} catch (e) {
	console.error('\n❌ Build falló:', e.message);
	process.exit(1);
} finally {
	// 4. Restore all moved files
	for (const file of moved) {
		const bak = file + '.bak';
		if (existsSync(bak)) {
			renameSync(bak, file);
		}
	}
}
