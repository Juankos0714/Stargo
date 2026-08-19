import { env } from '$env/dynamic/public';

export interface ApiResult<T> {
	data: T | null;
	/** Metadatos del endpoint cuando el body es { data, meta } (p. ej.
	 * /api/calcular_tarifa devuelve data = número de tarifa y meta = {disponible,
	 * motivo, barrios, zonas…}). */
	meta?: Record<string, unknown>;
	error: string | null;
}

/**
 * Resuelve la URL de la API: en Capacitor las rutas relativas no funcionan
 * (el origin es capacitor://localhost o similar), así que se antepone
 * PUBLIC_API_BASE_URL (configurar en .env del build de Capacitor).
 */
function apiUrl(path: string): string {
	if (/^https?:\/\//.test(path)) return path;
	const base = (env.PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
	return base ? `${base}${path}` : path;
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<ApiResult<T>> {
	try {
		const res = await fetch(apiUrl(path), {
			...opts,
			headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) }
		});
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
 * En Capacitor las rutas relativas no resuelven (origin = capacitor://localhost),
 * así que se usa PUBLIC_API_BASE_URL. En el navegador/web usa fetch normal.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
	return fetch(apiUrl(path), init);
}
