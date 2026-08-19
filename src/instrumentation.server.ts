export {};

// En Capacitor (adapter-static), Sentry del servidor no aplica.
if (process.env.CAPACITOR_BUILD) {
	// No-op: instrumentation.server.ts no es soportado por adapter-static.
} else {
	const Sentry = await import('@sentry/sveltekit');

	Sentry.init({
		dsn: 'https://bcde8fc66d7aac1e753585e4d8284e73@o4511865584943104.ingest.us.sentry.io/4511865589465088',

		tracesSampleRate: 1.0,

		// Enable logs to be sent to Sentry
		enableLogs: true,

		// uncomment the line below to enable Spotlight (https://spotlightjs.com)
		// spotlight: import.meta.env.DEV,
	});
}