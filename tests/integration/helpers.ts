/**
 * Helpers de la suite de INTEGRACIÓN (Parte 3) — tests/integration/*
 *
 * Reutiliza la infraestructura de la Parte 2 (tests/rls/helpers.ts): clientes
 * de Supabase (anon/service/como-usuario), creación de usuarios por rol,
 * siembra del catálogo (zonas/barrios/tarifas/recargos), pedidos directos,
 * aserciones RLS y limpieza. A eso suma lo propio de la integración:
 * iniciar sesión a través de la app real (POST /api/login con cookies) y
 * limpiar también los pedidos creados vía los endpoints.
 */
export * from '../rls/helpers';
import { ENTORNO, limpiarTodo, PREFIJO, clienteService } from '../rls/helpers';
import { peticion, CookieJar } from './http';

/** Password de los usuarios de prueba (la misma que usa la Parte 2). */
export const PASSWORD_TEST = ENTORNO?.password ?? 'stargo-test-2026';

/** Números de pedido creados vía los endpoints (limpieza determinista). */
export const PEDIDOS_HTTP: string[] = [];

/** Direcciones distintivas: permiten contar/limpiar los pedidos del endpoint. */
export function direccionOrigenTest(): string {
	return `Dir origen integración ${PREFIJO}`;
}
export function direccionDestinoTest(): string {
	return `Dir destino integración ${PREFIJO}`;
}

export interface SesionApp {
	jar: CookieJar;
	email: string;
	esAdmin: boolean;
	esDomiciliario: boolean;
}

/**
 * Inicia sesión a través de la app real (POST /api/login) y devuelve las
 * cookies de sesión. Lanza si las credenciales no son válidas.
 */
export async function loginEnApp(email: string, password: string): Promise<SesionApp> {
	const jar = new CookieJar();
	// El body de /api/login es { data: { email, esAdmin, esDomiciliario } }.
	const r = await peticion<{
		error?: string;
		data?: { email: string; esAdmin: boolean; esDomiciliario: boolean };
	}>('/api/login', { metodo: 'POST', cuerpo: { email, password }, jar });
	if (!r.ok || !r.data?.data) {
		throw new Error(`loginEnApp(${email}) falló: HTTP ${r.status} — ${r.data?.error ?? 'sin datos'}`);
	}
	return {
		jar,
		email: r.data.data.email,
		esAdmin: r.data.data.esAdmin,
		esDomiciliario: r.data.data.esDomiciliario
	};
}

/**
 * Sesión para un usuario SIN rol (cliente): la app no le permite hacer
 * login por /api/login (403), así que se simula su cookie con el access
 * token de Supabase que sí tiene. Es lo que tendría un cliente con sesión
 * de Supabase activa en el navegador.
 */
export function sesionConToken(token: string): SesionApp {
	const jar = new CookieJar();
	jar.poner('stargo_access_token', token);
	return { jar, email: '', esAdmin: false, esDomiciliario: false };
}

/**
 * Limpieza de la corrida: borra también los pedidos creados por los
 * endpoints (identificados por sus direcciones distintivas y por los números
 * registrados), además de todo lo que ya limpiaba la Parte 2.
 */
/** Ejecuta la promesa ignorando errores (limpieza best-effort). */
async function intentar(fn: () => PromiseLike<unknown>): Promise<void> {
	try {
		await fn();
	} catch {
		// La limpieza nunca debe romper la corrida.
	}
}

export async function limpiarIntegracion(): Promise<void> {
	const s = clienteService();
	await intentar(() => s.from('pedidos').delete().like('direccion_origen', `Dir origen integración ${PREFIJO}%`));
	for (const numero of PEDIDOS_HTTP) {
		await intentar(() => s.from('pedidos').delete().eq('numero', numero));
	}
	PEDIDOS_HTTP.length = 0;
	await limpiarTodo();
}
