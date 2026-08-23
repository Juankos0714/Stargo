import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest para la suite de INTEGRACIÓN (Parte 3) — tests/integration/*
 *
 * NO se corre con `bun run test`: lo orquesta scripts/integration-run.mjs,
 * que compila la app con las variables públicas del Supabase de prueba,
 * levanta `vite preview` y corre Vitest contra http://127.0.0.1:PORT.
 *
 *   bun run test:integration
 *
 * Los tests hacen HTTP de verdad (hooks, cookies, SSR, endpoints) contra la
 * app real y una instancia local de Supabase (sin mocks). Sin credenciales o
 * sin servidor, los suites se auto-saltan (describe.skipIf).
 */
export default defineConfig({
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
			'$env/static/public': fileURLToPath(new URL('./tests/ui/mocks/env-static-public.ts', import.meta.url))
		}
	},
	test: {
		environment: 'node',
		include: ['tests/integration/**/*.test.ts'],
		// Todo comparte la misma base de datos y el mismo servidor: nada de
		// paralelismo para evitar interferencias entre suites.
		fileParallelism: false,
		testTimeout: 30000,
		hookTimeout: 60000
	}
});
