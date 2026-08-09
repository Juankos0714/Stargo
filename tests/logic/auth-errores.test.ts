import { describe, expect, it } from 'vitest';
import { esErrorUsuarioExistente } from '$lib/logic/auth-errores';

describe('esErrorUsuarioExistente', () => {
	it('reconoce "User already registered" (variante clásica)', () => {
		expect(esErrorUsuarioExistente({ code: 'user_already_exists', message: 'User already registered' })).toBe(
			true
		);
	});

	it('reconoce "User already been invited" (invitación pendiente, no aceptada)', () => {
		expect(esErrorUsuarioExistente({ code: null, message: 'User already been invited' })).toBe(true);
	});

	it('reconoce códigos de error sin mensaje útil', () => {
		expect(esErrorUsuarioExistente({ code: 'email_exists', message: '' })).toBe(true);
		expect(esErrorUsuarioExistente({ code: 'user_already_exists' })).toBe(true);
	});

	it('reconoce otras variantes textuales de GoTrue', () => {
		expect(
			esErrorUsuarioExistente({ code: null, message: 'A user with this email address has already been registered' })
		).toBe(true);
		expect(esErrorUsuarioExistente({ code: null, message: 'User already exists' })).toBe(true);
	});

	it('NO marca errores que no son de cuenta existente', () => {
		expect(esErrorUsuarioExistente({ code: 'weak_password', message: 'Password should be at least 6 characters' })).toBe(
			false
		);
		expect(esErrorUsuarioExistente({ code: 'invalid_otp', message: 'Token has expired or is invalid' })).toBe(false);
		expect(esErrorUsuarioExistente(null)).toBe(false);
		expect(esErrorUsuarioExistente(undefined)).toBe(false);
	});
});
