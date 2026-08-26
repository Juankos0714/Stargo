/**
 * Capacitor session refresh lifecycle.
 *
 * When the app resumes from background (or is first opened), we call
 * /api/sesion via apiFetch. The server-side handler (hooks.server.ts →
 * handleSession) refreshes the access token if expired and returns the
 * fresh pair.  api.ts already syncs those tokens back to localStorage,
 * and hidratarSesionRealtime() does the same for the Supabase client.
 *
 * We also run a periodic refresh every 4 minutes as a safety net for
 * very long sessions where the user never backgrounds the app.
 */

import { App } from '@capacitor/app';
import { esCapacitor } from '$lib/capacitor-auth';
import { hidratarSesionRealtime } from '$lib/supabase-browser';

const REFRESH_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes

let cleanupFns: (() => void)[] = [];
let timerHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic + resume-based token refresh.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function iniciarRefreshSesion(): void {
	if (!esCapacitor()) return;
	if (cleanupFns.length > 0) return; // already running

	// 1. Listen for app resume (transition from background → active)
	const resumeHandle = App.addListener('appStateChange', async ({ isActive }) => {
		if (!isActive) return; // going to background — ignore
		await refrescar();
	});
	cleanupFns.push(() => resumeHandle.then((h) => h.remove()));

	// 2. Listen for the specific 'resume' event (fires after the app was paused)
	const resumeEventHandle = App.addListener('resume', async () => {
		await refrescar();
	});
	cleanupFns.push(() => resumeEventHandle.then((h) => h.remove()));

	// 3. Periodic refresh as a safety net
	timerHandle = setInterval(() => {
		void refrescar();
	}, REFRESH_INTERVAL_MS);
	cleanupFns.push(() => {
		if (timerHandle !== null) {
			clearInterval(timerHandle);
			timerHandle = null;
		}
	});

	// 4. Initial refresh on app start
	void refrescar();
}

/**
 * Stop all periodic and event-based refreshes.
 * Called on logout.
 */
export function detenerRefreshSesion(): void {
	for (const fn of cleanupFns) fn();
	cleanupFns = [];
	if (timerHandle !== null) {
		clearInterval(timerHandle);
		timerHandle = null;
	}
}

async function refrescar(): Promise<boolean> {
	return hidratarSesionRealtime();
}
