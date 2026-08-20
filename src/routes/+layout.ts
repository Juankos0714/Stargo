/**
 * Capacitor build: disable SSR so the app runs as a pure SPA.
 *
 * When adapter-static + fallback is used, SvelteKit still tries to fetch
 * __data.json on the client — without a server that won't exist, causing 500.
 * Disabling SSR lets the client-side router handle everything.
 *
 * Note: The build script (build-capacitor.mjs) also moves all *.server.ts
 * files out of the way so that adapter-static doesn't try to prerender
 * server loads that require Supabase connectivity.
 */
export const ssr = import.meta.env.CAPACITOR_BUILD === 'true';
