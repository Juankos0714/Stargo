import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright — suite E2E (Partes 5 y 6).
 *
 * Corre contra la app REAL: el runner scripts/e2e-run.mjs compila la app con
 * las variables públicas del Supabase de prueba, levanta `vite preview` y
 * corre esta suite contra http://127.0.0.1:4176 (o TEST_BASE_URL si apuntas a
 * un servidor externo, p. ej. un preview de Vercel).
 *
 *   bun run test:e2e            # todos los browsers + viewports
 *   bun run test:e2e:headed     # con ventana visible (debug local)
 *
 * Sin credenciales Supabase o sin servidor, el globalSetup no siembra nada y
 * los specs se auto-saltan (test.skip).
 *
 * ⚠️ NUNCA apuntes la suite a un Supabase de producción: crea usuarios y datos.
 */
export default defineConfig({
	testDir: 'tests/e2e',
	// La suite comparte una sola BD de pruebas (Supabase local) y los flujos
	// realtime usan varias sesiones a la vez: 1 worker, sin paralelismo.
	fullyParallel: false,
	workers: 1,
	timeout: 90_000,
	expect: { timeout: 10_000 },
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['list']] : [['list'], ['html', { open: 'never' }]],
	use: {
		baseURL: process.env.TEST_BASE_URL || 'http://127.0.0.1:4176',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	globalSetup: './tests/e2e/global-setup.ts',
	globalTeardown: './tests/e2e/global-teardown.ts',
	projects: [
		// Desktop: Chromium + WebKit (spec: "al menos Chromium + WebKit").
		{ name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
		{ name: 'webkit-desktop', use: { ...devices['Desktop Safari'] } },
		// Móvil (el público real usa mucho móvil; los domiciliarios en movimiento).
		// Los flujos marcados @desktop (matriz ancha, multi-sesión) no corren aquí.
		{
			name: 'chromium-mobile',
			use: { ...devices['Pixel 7'] },
			grepInvert: /@desktop/
		},
		{
			name: 'webkit-mobile',
			use: { ...devices['iPhone 13'] },
			grepInvert: /@desktop/
		}
	]
});
