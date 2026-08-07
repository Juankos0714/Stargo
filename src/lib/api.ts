export interface ApiResult<T> {
	data: T | null;
	/** Metadatos del endpoint cuando el body es { data, meta } (p. ej.
	 * /api/calcular_tarifa devuelve data = número de tarifa y meta = {disponible,
	 * motivo, barrios, zonas…}). */
	meta?: Record<string, unknown>;
	error: string | null;
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<ApiResult<T>> {
	try {
		const res = await fetch(path, {
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
