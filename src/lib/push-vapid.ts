/**
 * Validación de la clave VAPID pública.
 *
 * La causa nº 1 de «el push no funciona» es una clave VAPID mal copiada: un
 * PEM (`-----BEGIN PUBLIC KEY-----…`) o un JWK (`{"kty":"EC",…}`) en lugar de
 * la forma base64url desnuda (65 bytes, formato JOSE) que espera
 * `pushManager.subscribe({ applicationServerKey })`. Esta validación detecta
 * el error en el cliente, con un mensaje claro, ANTES de suscribirse.
 */
/** Decodifica una cadena base64url (JOSE, sin relleno) a bytes. Lanza si es inválida. */
export function base64UrlABytes(clave: string): Uint8Array {
	const b64 = clave.replace(/-/g, '+').replace(/_/g, '/');
	const bin = atob(b64);
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function esClaveVapidValida(clave: string): boolean {
	const limpia = (clave ?? '').trim();
	if (!limpia || limpia.includes('BEGIN') || limpia.includes('{')) return false;
	if (!/^[A-Za-z0-9_-]+={0,2}$/.test(limpia)) return false;
	try {
		// Clave pública P-256 descomprimida: 65 bytes (0x04 + 32 + 32).
		return base64UrlABytes(limpia).length === 65;
	} catch {
		return false;
	}
}
