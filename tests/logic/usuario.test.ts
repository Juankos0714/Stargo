import { describe, expect, test } from 'vitest';
import {
	DOMINIO_EMAIL_SINTETICO,
	emailSinteticoDe,
	esEmail,
	normalizarUsername,
	usernameValido
} from '$lib/logic/usuario';

describe('normalizarUsername', () => {
	test('minúsculas, sin espacios ni acentos', () => {
		expect(normalizarUsername('Móvil 1')).toBe('movil1');
		expect(normalizarUsername('JUAN.2')).toBe('juan2');
		expect(normalizarUsername('  Repartidor  3 ')).toBe('repartidor3');
	});

	test('tolera símbolos y diéresis', () => {
		expect(normalizarUsername('Ültimo_42')).toBe('ultimo42');
		expect(normalizarUsername('pepé-movil')).toBe('pepemovil');
	});

	test('vacío o solo símbolos → cadena vacía', () => {
		expect(normalizarUsername('')).toBe('');
		expect(normalizarUsername('   ')).toBe('');
		expect(normalizarUsername('!!!')).toBe('');
	});
});

describe('usernameValido', () => {
	test('acepta 2-30 caracteres alfanuméricos', () => {
		expect(usernameValido('movil1')).toBe(true);
		expect(usernameValido('Móvil 1')).toBe(true);
		expect(usernameValido('a'.repeat(30))).toBe(true);
	});

	test('rechaza muy cortos, muy largos o sin letras', () => {
		expect(usernameValido('a')).toBe(false);
		expect(usernameValido('')).toBe(false);
		expect(usernameValido('a'.repeat(31))).toBe(false);
		expect(usernameValido('!!!')).toBe(false);
	});
});

describe('emailSinteticoDe', () => {
	test('deriva el email sintético interno del username normalizado', () => {
		expect(emailSinteticoDe('movil1')).toBe(`movil1@${DOMINIO_EMAIL_SINTETICO}`);
		expect(emailSinteticoDe('Móvil 1')).toBe(`movil1@${DOMINIO_EMAIL_SINTETICO}`);
	});

	test('es determinista: mismo username → mismo email', () => {
		expect(emailSinteticoDe('movil2')).toBe(emailSinteticoDe('MOVIL2'));
	});
});

describe('esEmail', () => {
	test('distingue emails reales de usernames', () => {
		expect(esEmail('repartidor@correo.com')).toBe(true);
		expect(esEmail('movil1')).toBe(false);
		expect(esEmail('movil1@')).toBe(false);
		expect(esEmail('')).toBe(false);
	});
});
