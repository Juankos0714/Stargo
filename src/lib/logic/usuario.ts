/**
 * Lógica pura de usernames de domiciliarios (Parte 1 — tests unitarios).
 *
 * El admin crea repartidores con un usuario tipo «movil1», «movil2»… sin
 * correo. La cuenta de Supabase Auth se crea con un EMAIL SINTÉTICO interno
 * derivado del username («movil1» → movil1@stargo.local): así el login por
 * usuario se resuelve derivando el mismo email (determinista, sin consultas
 * extra ni RPC) y auth.users conserva su esquema de email único. El
 * repartidor nunca ve ni usa ese correo.
 */

/** Dominio de los correos sintéticos internos (nunca visible para el usuario). */
export const DOMINIO_EMAIL_SINTETICO = 'stargo.local';

/**
 * Normaliza un username a una forma canónica para almacenar y derivar el
 * email sintético: minúsculas, sin acentos ni diéresis, sin espacios ni
 * símbolos (se quitan). Ej.: «Móvil 1» → «movil1», «JUAN.2» → «juan2».
 */
export function normalizarUsername(input: string): string {
	return (input ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '') // quita acentos/diéresis
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');
}

/** ¿El username es válido para crear un repartidor? (2-30 caracteres alfanuméricos). */
export function usernameValido(input: string): boolean {
	const u = normalizarUsername(input);
	return u.length >= 2 && u.length <= 30;
}

/** Email sintético interno derivado del username (nunca se muestra al usuario). */
export function emailSinteticoDe(username: string): string {
	return `${normalizarUsername(username)}@${DOMINIO_EMAIL_SINTETICO}`;
}

/** ¿El identificador de login parece un email (contiene @)? */
export function esEmail(identificador: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((identificador ?? '').trim());
}
