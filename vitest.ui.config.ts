import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/**
 * Vitest para componentes de UI (Parte 4) — tests/ui/*
 *
 * Corre en jsdom con el plugin de Svelte (compile los .svelte igual que la
 * app, forzando runes) y el alias $lib. Los componentes que usan Supabase
 * se controlan con vi.mock en cada test; $env/static/public apunta a un
 * stub para que ningún módulo real intente leer variables de entorno.
 *
 *   bun run test:ui
 *
 * No requiere Supabase local: es la capa de componentes aislados.
 */
export default defineConfig({
	plugins: [
		svelte({
			hot: false,
			// Mismo modo runes que el proyecto (excepto librerías).
			compilerOptions: {
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
			}
		})
	],
	resolve: {
		// Vitest transforma los tests en modo SSR, lo que haría que el plugin
		// de Svelte compile los componentes como server (y mount() no existe
		// ahí). Con estas condiciones la resolución es tipo cliente: svelte
		// apunta a su build de DOM y los componentes se compilan como tal.
		conditions: ['svelte', 'browser'],
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
			// Ningún componente debe leer credenciales reales en los tests.
			'$env/static/public': fileURLToPath(new URL('./tests/ui/mocks/env-static-public.ts', import.meta.url))
		}
	},
	test: {
		environment: 'jsdom',
		include: ['tests/ui/**/*.test.ts'],
		setupFiles: ['tests/ui/setup.ts'],
		// Evita interferencias entre archivos que comparten estado global (fetch, timers).
		fileParallelism: false,
		testTimeout: 15000,
		// Reporte de cobertura de los componentes críticos (sin umbral duro:
		// el gate de % sigue siendo la lógica pura de src/lib/logic).
		coverage: {
			provider: 'v8',
			include: [
				'src/lib/components/**',
				'src/routes/nuevo-pedido/**',
				'src/routes/admin/(panel)/pedidos/**'
			],
			exclude: ['**/*.test.ts'],
			reporter: ['text']
		}
	}
});
