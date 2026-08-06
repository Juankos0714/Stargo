import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import type { KitConfig } from '@sveltejs/kit';
import { defineConfig } from 'vite';

const csp: NonNullable<KitConfig['csp']> = {
	// 'auto': SvelteKit añade un nonce a sus scripts inline (bootstrap de
	// hidratación) y lo incluye en script-src automáticamente.
	mode: 'auto' as const,
	directives: {
		'default-src': ['self'],
		'script-src': ['self'],
		// 'unsafe-inline' en style-src: necesario por atributos style=""
		// que SvelteKit y algunas vistas usan (p. ej. el degradado del home).
		'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
		'font-src': ['self', 'https://fonts.gstatic.com', 'data:'],
		'img-src': ['self', 'data:'],
		// REST + Realtime (WebSocket) de Supabase desde el navegador.
		// Ingest de Sentry (solo se usa si PUBLIC_SENTRY_DSN está configurado).
		'connect-src': [
			'self',
			'https://*.supabase.co',
			'wss://*.supabase.co',
			'https://*.ingest.sentry.io'
		],
		'base-uri': ['self'],
		'form-action': ['self'],
		'frame-ancestors': ['none'],
		'object-src': ['none']
	}
};

export default defineConfig(({ mode }) => ({
	plugins: [
		tailwindcss(),
		// Subida de sourcemaps a Sentry: solo si hay credenciales (SENTRY_AUTH_TOKEN
		// + org + project). Sin ellas el plugin no se incluye y el build es normal.
		...(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
			? [
					sentryVitePlugin({
						org: process.env.SENTRY_ORG,
						project: process.env.SENTRY_PROJECT,
						authToken: process.env.SENTRY_AUTH_TOKEN,
						telemetry: false,
						// Sube los sourcemaps del build del cliente (y sus mapas).
						sourcemaps: { assets: ['**/*.js', '**/*.map'] }
					})
				]
			: []),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Despliegue en Vercel (serverless + HTTPS).
			adapter: adapter(),

			// CSP solo en producción (en dev Vite inyecta scripts/estilos inline).
			...(mode === 'production' ? { csp } : {})
		})
	],
	// Sourcemaps SOLO cuando hay credenciales de Sentry: sin SENTRY_AUTH_TOKEN
	// no se generan (evita exponer el código fuente en producción sin el
	// beneficio de las issues mapeadas). Con token, el plugin los sube y
	// Vite los genera para ello.
	...(process.env.SENTRY_AUTH_TOKEN ? { build: { sourcemap: true } } : {})
}));
