/**
 * Cliente HTTP mínimo para la suite de integración (Parte 3).
 *
 * La app usa cookies httpOnly (stargo_access_token / stargo_refresh_token),
 * así que este módulo lleva un CookieJar manual: registra los Set-Cookie de
 * cada respuesta y los envía en la siguiente petición (como un navegador).
 */

export const BASE_URL = process.env.TEST_BASE_URL ?? '';
/** La suite solo tiene sentido si el runner levantó (o apuntó) un servidor. */
export const INTEGRACION_DISPONIBLE = Boolean(BASE_URL);

export class CookieJar {
	private mapa = new Map<string, string>();

	/** Registra los Set-Cookie de una respuesta (soporta varios). */
	registrar(headers: Headers): void {
		for (const linea of obtenerSetCookie(headers)) {
			const [par] = linea.split(';');
			const idx = par.indexOf('=');
			if (idx < 0) continue;
			const nombre = par.slice(0, idx).trim();
			const valor = par.slice(idx + 1).trim();
			if (valor === '' || valor.toLowerCase() === 'deleted') {
				this.mapa.delete(nombre);
			} else {
				this.mapa.set(nombre, valor);
			}
		}
	}

	/** Header Cookie: "nombre=valor; nombre2=valor2". */
	header(): string {
		return [...this.mapa.entries()].map(([n, v]) => `${n}=${v}`).join('; ');
	}

	get(nombre: string): string | undefined {
		return this.mapa.get(nombre);
	}

	/** Para simular tokens corruptos/expirados en los tests de sesión. */
	poner(nombre: string, valor: string): void {
		this.mapa.set(nombre, valor);
	}

	quitar(nombre: string): void {
		this.mapa.delete(nombre);
	}
}

function obtenerSetCookie(headers: Headers): string[] {
	const h = headers as Headers & { getSetCookie?: () => string[] };
	if (typeof h.getSetCookie === 'function') {
		try {
			return h.getSetCookie();
		} catch {
			// fallback abajo
		}
	}
	const cruda = headers.get('set-cookie');
	if (!cruda) return [];
	// Nuestros tokens (JWT) no contienen comas, así que separar por ", " es seguro.
	return cruda.split(', ');
}

export interface PeticionResultado<T> {
	status: number;
	ok: boolean;
	data: T | null;
	headers: Headers;
	jar: CookieJar;
}

export interface PeticionOpciones {
	metodo?: string;
	cuerpo?: unknown;
	jar?: CookieJar;
	/** 'follow' (default) o 'manual' (para observar redirects 3xx). */
	redirect?: 'follow' | 'manual';
	headers?: Record<string, string>;
}

/**
 * Hace una petición a la app en pruebas. Devuelve el cuerpo JSON parseado
 * (null si no es JSON) y el jar (el mismo que se pasó, mutado con las nuevas
 * cookies).
 */
async function ejecutar(path: string, opts: PeticionOpciones): Promise<Response> {
	const headers: Record<string, string> = {
		Accept: 'application/json',
		...(opts.headers ?? {})
	};
	if (opts.cuerpo !== undefined) {
		headers['Content-Type'] = 'application/json';
	}
	if (opts.jar) {
		const cookie = opts.jar.header();
		if (cookie) headers['Cookie'] = cookie;
	}

	return fetch(`${BASE_URL}${path}`, {
		method: opts.metodo ?? 'GET',
		headers,
		body: opts.cuerpo !== undefined ? JSON.stringify(opts.cuerpo) : undefined,
		redirect: opts.redirect ?? 'follow'
	});
}

function registrarJar(res: Response, opts: PeticionOpciones): CookieJar {
	const jar = opts.jar ?? new CookieJar();
	jar.registrar(res.headers);
	return jar;
}

export async function peticion<T = unknown>(
	path: string,
	opts: PeticionOpciones = {}
): Promise<PeticionResultado<T>> {
	const res = await ejecutar(path, opts);
	const jar = registrarJar(res, opts);

	let data: T | null = null;
	try {
		data = (await res.json()) as T;
	} catch {
		data = null;
	}

	return { status: res.status, ok: res.ok, data, headers: res.headers, jar };
}

export interface PeticionTextoResultado {
	status: number;
	ok: boolean;
	texto: string;
	headers: Headers;
	jar: CookieJar;
}

/** Igual que peticion() pero devuelve el cuerpo como texto (HTML, CSV…). */
export async function peticionTexto(
	path: string,
	opts: PeticionOpciones = {}
): Promise<PeticionTextoResultado> {
	const res = await ejecutar(path, opts);
	const jar = registrarJar(res, opts);
	return { status: res.status, ok: res.ok, texto: await res.text(), headers: res.headers, jar };
}
