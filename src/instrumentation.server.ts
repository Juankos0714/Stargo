import * as Sentry from '@sentry/sveltekit';

Sentry.init({
  dsn: 'https://bcde8fc66d7aac1e753585e4d8284e73@o4511865584943104.ingest.us.sentry.io/4511865589465088',

  tracesSampleRate: 1.0,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: import.meta.env.DEV,
});