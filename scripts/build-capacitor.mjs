/**
 * Build script para Capacitor (cross-platform).
 *
 * 1. Mueve instrumentation.server.ts (Sentry) fuera del alcance de
 *    adapter-static, que lo rechaza.
 * 2. Ejecuta vite build con CAPACITOR_BUILD=true.
 * 3. Restaura el archivo.
 */
import { execSync } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const INSTR_FILE = resolve(ROOT, 'src/instrumentation.server.ts');
const INSTR_BAK = INSTR_FILE + '.bak';

let moved = false;

try {
	// 1. Mover instrumentation.server.ts temporalmente
	if (existsSync(INSTR_FILE)) {
		renameSync(INSTR_FILE, INSTR_BAK);
		moved = true;
	}

	// 2. Build con CAPACITOR_BUILD=true
	process.env.CAPACITOR_BUILD = 'true';
	execSync('npx vite build', { cwd: ROOT, stdio: 'inherit', env: { ...process.env, CAPACITOR_BUILD: 'true' } });

	console.log('\n✅ Build de Capacitor completado exitosamente.');
} catch (e) {
	console.error('\n❌ Build falló:', e.message);
	process.exit(1);
} finally {
	// 3. Restaurar instrumentation.server.ts
	if (moved && existsSync(INSTR_BAK)) {
		renameSync(INSTR_BAK, INSTR_FILE);
	}
}
