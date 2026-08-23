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
 * 5. Elimina el service worker del build y arregla CSP para Capacitor.
 */
import { execSync } from 'node:child_process';
import { existsSync, renameSync, readdirSync, statSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
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
		env[key] = val.replace(/^['"]|['"]$/g, '');
	}
	return env;
}

/**
 * Remove the service worker registration block from SvelteKit's index.html.
 * The block is: if ('serviceWorker' in navigator) { ... } at the end of the
 * inline <script>. We use brace counting to find the matching closing brace.
 */
function removeServiceWorkerBlock(html) {
	const marker = "if ('serviceWorker' in navigator)";
	const idx = html.indexOf(marker);
	if (idx === -1) return { html, removed: false };

	// Find the opening brace of the if block
	const openBrace = html.indexOf('{', idx);
	if (openBrace === -1) return { html, removed: false };

	// Count braces to find the matching close
	let depth = 0;
	let i = openBrace;
	for (; i < html.length; i++) {
		if (html[i] === '{') depth++;
		else if (html[i] === '}') {
			depth--;
			if (depth === 0) break;
		}
	}

	// Extract the start of the if statement (including leading whitespace/newlines)
	let start = idx;
	while (start > 0 && (html[start - 1] === '\n' || html[start - 1] === '\t' || html[start - 1] === ' ')) {
		start--;
	}

	// Remove from start to i+1 (inclusive)
	const newHtml = html.slice(0, start) + html.slice(i + 1);
	return { html: newHtml, removed: true };
}

const serverFiles = [
	resolve(ROOT, 'src/instrumentation.server.ts'),
	...findFiles(SRC, (f) => /\+(?:page|layout)\.server\.(ts|js)$/.test(f))
];

const moved = [];

try {
	for (const file of serverFiles) {
		if (existsSync(file)) {
			renameSync(file, file + '.bak');
			moved.push(file);
		}
	}

	const baseEnv = parseEnv(resolve(ROOT, '.env'));
	const capacitorEnv = parseEnv(resolve(ROOT, '.env.capacitor'));

	const buildEnv = {
		...baseEnv,
		...capacitorEnv,
		CAPACITOR_BUILD: 'true',
		PUBLIC_SUPABASE_URL: capacitorEnv.PUBLIC_SUPABASE_URL
			?? 'https://uwfjfkcytohrjnyspkkt.supabase.co',
		PUBLIC_API_BASE_URL: capacitorEnv.PUBLIC_API_BASE_URL
			?? 'https://stargo-zeta.vercel.app'
	};

	execSync('npx vite build', {
		cwd: ROOT,
		stdio: 'inherit',
		env: { ...process.env, ...buildEnv }
	});

	const buildDir = resolve(ROOT, 'build');

	// Remove service worker file
	const swPath = join(buildDir, 'service-worker.js');
	if (existsSync(swPath)) {
		unlinkSync(swPath);
		console.log('🗑️  service-worker.js eliminado del build de Capacitor.');
	}

	// Fix index.html: remove SW registration + fix CSP
	const indexHtml = join(buildDir, 'index.html');
	if (existsSync(indexHtml)) {
		let html = readFileSync(indexHtml, 'utf-8');

		// Remove the service worker registration block
		const { html: cleanedHtml, removed } = removeServiceWorkerBlock(html);
		if (removed) {
			console.log('🗑️  Service worker registration removed from index.html.');
		}
		html = cleanedHtml;

		// Fix CSP: replace script-src sha256 hash with 'unsafe-inline'
		// (inline bootstrap script changes between builds)
		html = html.replace(
			/script-src\s+'self'\s+https:\/\/vercel\.live\s+'sha256-[^']*'/,
			"script-src 'self' 'unsafe-inline' https://vercel.live"
		);

		writeFileSync(indexHtml, html);
	}

	console.log('\n✅ Build de Capacitor completado exitosamente.');
} catch (e) {
	console.error('\n❌ Build falló:', e.message);
	process.exit(1);
} finally {
	for (const file of moved) {
		const bak = file + '.bak';
		if (existsSync(bak)) {
			renameSync(bak, file);
		}
	}
}
