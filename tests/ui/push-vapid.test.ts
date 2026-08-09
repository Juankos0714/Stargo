import { describe, expect, test } from 'vitest';
import { esClaveVapidValida } from '$lib/push-vapid';

/** Genera una clave base64url válida: 65 bytes (clave P-256 descomprimida). */
function claveValida(): string {
	const bytes = Array.from({ length: 65 }, (_, i) => (i * 7 + 3) % 256);
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

describe('esClaveVapidValida — formato de la clave VAPID pública', () => {
	test('acepta una clave base64url desnuda de 65 bytes', () => {
		expect(esClaveVapidValida(claveValida())).toBe(true);
	});

	test('acepta la clave real del .env (formato base64url)', () => {
		expect(
			esClaveVapidValida(
				'BLVwLdQtY-uG5HuI5u73xs4IQyYeZvLtdWl7hZNvlRfZYFS_YRHn7IhdMm6f4_jyjATKueFArjJZtE_K2zk89fk'
			)
		).toBe(true);
	});

	test('rechaza una clave PEM (BEGIN PUBLIC KEY)', () => {
		expect(esClaveVapidValida('-----BEGIN PUBLIC KEY-----\nMIIB...\n-----END PUBLIC KEY-----')).toBe(false);
	});

	test('rechaza un JWK (JSON)', () => {
		expect(esClaveVapidValida('{"kty":"EC","crv":"P-256","x":"...","y":"..."}')).toBe(false);
	});

	test('rechaza vacío, nulo y cadenas demasiado cortas', () => {
		expect(esClaveVapidValida('')).toBe(false);
		expect(esClaveVapidValida('   ')).toBe(false);
		expect(esClaveVapidValida('abc')).toBe(false);
		expect(esClaveVapidValida('clave-no-base64!')).toBe(false);
	});

	test('tolera espacios alrededor', () => {
		expect(esClaveVapidValida(`  ${claveValida()}  `)).toBe(true);
	});

	test('rechaza una cadena base64url de otra longitud (no 65 bytes)', () => {
		// 64 bytes no es una clave P-256 descomprimida.
		const de64 = btoa(String.fromCharCode(...Array(64).fill(4)))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');
		expect(esClaveVapidValida(de64)).toBe(false);
	});
});
