/**
 * Capacitor auth helper — stores session tokens in localStorage
 * and injects them as cookies on API requests.
 *
 * In Capacitor, httpOnly cookies set by the server don't persist
 * across fetch requests (CapacitorHttp doesn't maintain a cookie jar).
 * This module bridges that gap by storing tokens client-side and
 * injecting them into every request as Cookie headers.
 */

import { Capacitor } from '@capacitor/core';

/** ¿Estamos corriendo dentro de Capacitor (app nativa)? */
export function esCapacitor(): boolean {
	try {
		return Capacitor.isNativePlatform();
	} catch {
		return false;
	}
}

const ACCESS_KEY = 'stargo_access_token';
const REFRESH_KEY = 'stargo_refresh_token';

/** Store session tokens after a successful login. */
export function storeSession(accessToken: string, refreshToken: string): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(ACCESS_KEY, accessToken);
	localStorage.setItem(REFRESH_KEY, refreshToken);
}

/** Clear stored session tokens. */
export function clearSession(): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.removeItem(ACCESS_KEY);
	localStorage.removeItem(REFRESH_KEY);
}

/** Retrieve stored session tokens (or null if not available). */
export function getStoredSession(): { accessToken: string; refreshToken: string } | null {
	if (typeof localStorage === 'undefined') return null;
	const at = localStorage.getItem(ACCESS_KEY);
	const rt = localStorage.getItem(REFRESH_KEY);
	if (!at) return null;
	return { accessToken: at, refreshToken: rt ?? '' };
}

/**
 * Build Cookie header string from stored tokens.
 * Returns empty string if no tokens are stored.
 */
export function buildCookieHeader(): string {
	const session = getStoredSession();
	if (!session) return '';
	return `stargo_access_token=${session.accessToken}; stargo_refresh_token=${session.refreshToken}`;
}
