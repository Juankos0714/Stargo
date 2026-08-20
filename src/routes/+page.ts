/**
 * Client-side load for the root page.
 *
 * When running in Capacitor (ssr = false), the +page.server.ts load
 * function doesn't execute, so the page receives empty data.
 * This +page.ts ensures SvelteKit gets a valid data shape from the
 * client side instead of trying to fetch __data.json from a non-existent
 * server, which causes a 500 error.
 *
 * In Vercel (ssr = true + prerender), this is overridden by the
 * server load in +page.server.ts.
 */
export function load() {
	return {
		horario: null,
		esAdmin: false,
		esDomiciliario: false
	};
}
