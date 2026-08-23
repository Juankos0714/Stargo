import { CapacitorHttp } from '@capacitor/core';
import { buildCookieHeader, esCapacitor } from '$lib/capacitor-auth';

export interface ApiResult<T> {
	data: T | null;
	meta?: Record<string, unknown>;
	error: string | null;
}

/** Hardcoded base URL for Capacitor builds. */
const CAPACITOR_API_BASE = 'https://stargo-zeta.vercel.app';

function apiUrl(path: string): string {
	if (/^https?:\/\//.test(path)) return path;
	if (esCapacitor()) return `${CAPACITOR_API_BASE}${path}`;
	return path;
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<ApiResult<T>> {
	try {
		const url = apiUrl(path);
		const baseHeaders: Record<string, string> = {
			'Content-Type': 'application/json',
			...((opts.headers as Record<string, string>) ?? {})
		};

		if (esCapacitor()) {
			// Capacitor: use native HTTP (bypasses WebView fetch issues)
			const cookieStr = buildCookieHeader();
			if (cookieStr) baseHeaders['Cookie'] = cookieStr;

			const response = await CapacitorHttp.request({
				url,
				method: (opts.method as string) ?? 'GET',
				headers: baseHeaders,
				data: opts.body ? JSON.parse(opts.body as string) : undefined
			});

			if (response.status < 200 || response.status >= 300) {
				const errBody = typeof response.data === 'string'
					? JSON.parse(response.data || '{}')
					: (response.data ?? {});
				return { data: null, error: errBody?.error ?? errBody?.message ?? `Error ${response.status}` };
			}

			const body = typeof response.data === 'string'
				? JSON.parse(response.data || '{}')
				: (response.data ?? {});
			return {
				data: (body?.data ?? null) as T | null,
				meta: body?.meta as Record<string, unknown> | undefined,
				error: null
			};
		}

		// Web: normal fetch
		const res = await fetch(url, { ...opts, headers: baseHeaders });
		const body = await res.json().catch(() => ({}));
		if (!res.ok) {
			return { data: null, error: body?.error ?? body?.message ?? `Error ${res.status}` };
		}
		return {
			data: (body?.data ?? null) as T | null,
			meta: body?.meta as Record<string, unknown> | undefined,
			error: null
		};
	} catch (e) {
		return { data: null, error: e instanceof Error ? e.message : 'Error de red' };
	}
}

export const api = {
	get: <T>(path: string) => request<T>(path),
	post: <T>(path: string, body?: unknown) =>
		request<T>(path, { method: 'POST', body: body == null ? undefined : JSON.stringify(body) }),
	put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
	del: <T>(path: string) => request<T>(path, { method: 'DELETE' })
};

/**
 * Fetch con resolución de URL para Capacitor.
 * En Capacitor usa CapacitorHttp nativo (bypasses WebView fetch issues).
 * En web usa fetch normal.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
	const url = apiUrl(path);
	const existingHeaders = (init?.headers as Record<string, string>) ?? {};

	if (esCapacitor()) {
		const cookieStr = buildCookieHeader();
		const headers: Record<string, string> = { ...existingHeaders };
		if (cookieStr) headers['Cookie'] = cookieStr;

		const response = await CapacitorHttp.request({
			url,
			method: (init?.method as string) ?? 'GET',
			headers
		});

		// Return a Response-like object for compatibility
		const data = typeof response.data === 'string'
			? response.data
			: JSON.stringify(response.data);

		return new Response(data, {
			status: response.status,
			headers: new Headers(response.headers as Record<string, string>)
		});
	}

	return fetch(url, { ...init, headers: existingHeaders });
}
