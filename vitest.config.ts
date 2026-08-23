import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest (Parte 1 — Pruebas unitarias de lógica de negocio).
 *
 * Solo se testea lógica pura (src/lib/logic) y los módulos servidor sin
 * dependencias de UI ni de base de datos real. El gate de cobertura es
 * DIFERENTE por carpeta:
 *   - src/lib/logic: ≥90% en todas las métricas (es donde vive el dinero
 *     y la máquina de estados; el CI falla si baja de ahí).
 *   - resto de src: sin umbral (se reporta pero no bloquea).
 */
export default defineConfig({
	resolve: {
		// Mismo alias que SvelteKit ($lib → src/lib): los módulos de la app
		// importan con $lib/… y los tests resuelven esos imports.
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
			// $env/static/public: supabase-browser.ts lo importa a nivel de módulo.
			'$env/static/public': fileURLToPath(new URL('./tests/ui/mocks/env-static-public.ts', import.meta.url))
		}
	},
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		// Las suites de RLS, integración y UI se corren aparte con su propia
		// config (vitest.rls/integration/ui.config.ts); no pertenecen al run
		// rápido de lógica pura.
		exclude: ['tests/rls/**', 'tests/integration/**', 'tests/ui/**'],
		coverage: {
			provider: 'v8',
			include: ['src/lib/logic/**'],
			exclude: ['**/*.test.ts'],
			thresholds: {
				statements: 90,
				branches: 90,
				functions: 90,
				lines: 90
			},
			reporter: ['text', 'json-summary']
		}
	}
});
