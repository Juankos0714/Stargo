/**
 * Global setup de la suite E2E (Partes 5 y 6).
 *
 * Siembra una vez (antes de todos los specs) los usuarios por rol (admin,
 * domiciliario, domiciliario B, cliente) y el catálogo (zonas/barrios/
 * tarifas/recargos) contra el Supabase de PRUEBAS, y guarda el estado en
 * tests/e2e/.state.json para que los specs lo lean.
 *
 * Sin credenciales (SUPABASE_URL / ANON / SERVICE_ROLE), no siembra nada:
 * los specs se auto-saltan y `bun run test:e2e` termina sin romper.
 *
 * ⚠️ NUNCA apuntes esto a producción: crea usuarios y datos de prueba.
 */
import { sembrarE2E } from './helpers';

export default async function globalSetup(): Promise<void> {
	try {
		const estado = await sembrarE2E();
		if (estado) {
			console.log(`[e2e] Estado sembrado con prefijo «${estado.prefijo}» (admin: ${estado.usuarios.admin.email})`);
		} else {
			console.log('[e2e] Sin credenciales Supabase — suite omitida (los specs se auto-saltan).');
		}
	} catch (e) {
		console.error('[e2e] El globalSetup falló al sembrar:', e);
		// El teardown limpiará lo poco que se haya creado (best-effort) y la
		// suite quedará en rojo con un mensaje claro en cada spec.
		throw e;
	}
}
