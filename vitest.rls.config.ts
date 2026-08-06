import { defineConfig } from 'vitest/config';

/**
 * Vitest para la suite de RLS (Parte 2) — tests/rls/*
 *
 * Corre contra un proyecto Supabase de PRUEBAS (por defecto Supabase local
 * vía CLI + Docker). Necesita las variables de entorno de .env.test
 * (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY):
 *
 *   bun run test:rls
 *
 * Sin credenciales, los suites se auto-saltan (describe.skipIf) para no
 * romper el desarrollo local.
 *
 * Advertencia: NUNCA apuntes esta suite a producción — crea usuarios y datos.
 */
export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/rls/**/*.test.ts'],
		// Todos los archivos comparten el mismo Supabase: nada de paralelismo
		// para evitar interferencias entre suites.
		fileParallelism: false,
		testTimeout: 20000,
		hookTimeout: 60000
	}
});
