/**
 * PWA / Browser session refresh lifecycle.
 *
 * When a PWA is installed ("Add to Home Screen") and the user backgrounds it,
 * the OS may freeze or kill the WebView process.  When the user returns, the
 * access token stored by Supabase in localStorage (persistSession: true) may
 * be expired, but autoRefreshToken is disabled so nothing refreshes it.
 *
 * The server-side handleSession hook *does* refresh on the next request, but
 * only if a request actually reaches the server.  If the SW serves a cached
 * navigation response (network unavailable) or the page was already loaded,
 * no request is made and the stale token is used — causing auth failures.
 *
 * This module mirrors capacitor-session-refresh.ts for browser/PWA contexts:
 *  1. visibilitychange → refresh when the page becomes visible again
 *  2. Periodic timer (every 4 min) as a safety net for long foreground sessions
 *  3. Initial refresh on mount
 *
 * It is a no-op when running inside Capacitor (which has its own refresh).
 */

import { esCapacitor } from '$lib/capacitor-auth';
import { hidratarSesionRealtime } from '$lib/supabase-browser';

const REFRESH_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes

let timerHandle: ReturnType<typeof setInterval> | null = null;
let visibilityHandler: (() => void) | null = null;
let running = false;

/**
 * Start the periodic + visibility-based token refresh.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function iniciarRefreshSesionPWA(): void {
	if (esCapacitor()) return; // Capacitor has its own refresh
	if (running) return;
	running = true;

	// 1. Refresh when the page becomes visible again (PWA reopened from background)
	visibilityHandler = () => {
		if (document.visibilityState === 'visible') {
			void refrescar();
		}
	};
	document.addEventListener('visibilitychange', visibilityHandler);

	// 2. Periodic refresh as a safety net
	timerHandle = setInterval(() => {
		void refrescar();
	}, REFRESH_INTERVAL_MS);

	// 3. Initial refresh on mount
	void refrescar();
}

/**
 * Stop all periodic and event-based refreshes.
 * Called on logout.
 */
export function detenerRefreshSesionPWA(): void {
	if (visibilityHandler) {
		document.removeEventListener('visibilitychange', visibilityHandler);
		visibilityHandler = null;
	}
	if (timerHandle !== null) {
		clearInterval(timerHandle);
		timerHandle = null;
	}
	running = false;
}

async function refrescar(): Promise<boolean> {
	return hidratarSesionRealtime();
}
