import { describe, expect, test } from 'vitest';
import {
	INDICATIVO_COLOMBIA,
	NOMBRE_EMPRESA,
	mensajeWhatsAppAdmin,
	mensajeWhatsAppDomiciliario,
	normalizarTelefonoWhatsApp,
	urlWhatsApp
} from '../../src/lib/logic/whatsapp';

describe('normalizarTelefonoWhatsApp (Fase 19)', () => {
	test('número local de 10 dígitos: antepone el indicativo 57', () => {
		expect(normalizarTelefonoWhatsApp('3001234567')).toBe(`57${'3001234567'}`);
	});

	test('ignora espacios, guiones y paréntesis', () => {
		expect(normalizarTelefonoWhatsApp('300 123 4567')).toBe('573001234567');
		expect(normalizarTelefonoWhatsApp('300-123-45-67')).toBe('573001234567');
		expect(normalizarTelefonoWhatsApp('(300) 123-4567')).toBe('573001234567');
	});

	test('ya trae el indicativo 57: no se duplica', () => {
		expect(normalizarTelefonoWhatsApp('573001234567')).toBe('573001234567');
		expect(normalizarTelefonoWhatsApp('+57 300 123 4567')).toBe('573001234567');
	});

	test('números inválidos devuelven null', () => {
		expect(normalizarTelefonoWhatsApp('')).toBeNull();
		expect(normalizarTelefonoWhatsApp(null)).toBeNull();
		expect(normalizarTelefonoWhatsApp(undefined)).toBeNull();
		expect(normalizarTelefonoWhatsApp('300123456')).toBeNull(); // 9 dígitos
		expect(normalizarTelefonoWhatsApp('30012345678')).toBeNull(); // 11 dígitos
		expect(normalizarTelefonoWhatsApp('603001234567')).toBeNull(); // 12 sin prefijo 57
		expect(normalizarTelefonoWhatsApp('abcdefghij')).toBeNull();
	});
});

describe('urlWhatsApp', () => {
	test('construye wa.me con el número normalizado y el mensaje urlencoded', () => {
		const url = urlWhatsApp('300 123 4567', 'Hola, ¿en qué te podemos ayudar?');
		expect(url).toBe(
			`https://wa.me/573001234567?text=${encodeURIComponent('Hola, ¿en qué te podemos ayudar?')}`
		);
	});

	test('el mensaje se codifica (espacios, #, acentos, ¿?)', () => {
		const url = urlWhatsApp('573001234567', 'Hola, pedido #ABC123 ¿todo bien?');
		expect(url).toContain(`?text=${encodeURIComponent('Hola, pedido #ABC123 ¿todo bien?')}`);
		expect(url).not.toContain(' ');
		expect(url).not.toContain('#ABC123');
	});

	test('sin teléfono válido devuelve null (el botón no se pinta)', () => {
		expect(urlWhatsApp(null, 'Hola')).toBeNull();
		expect(urlWhatsApp('', 'Hola')).toBeNull();
		expect(urlWhatsApp('30012', 'Hola')).toBeNull();
	});
});

describe('mensajeWhatsAppAdmin', () => {
	test('con nombre: saluda y menciona el pedido y la empresa', () => {
		const m = mensajeWhatsAppAdmin('ABC123', 'Ana María');
		expect(m).toBe(`Hola Ana María, te escribimos de ${NOMBRE_EMPRESA} respecto a tu pedido #ABC123. ¿En qué te podemos ayudar?`);
	});

	test('sin nombre: el mensaje va sin nombre (no inventa datos)', () => {
		const m = mensajeWhatsAppAdmin('ABC123', null);
		expect(m).toBe(`Hola, te escribimos de ${NOMBRE_EMPRESA} respecto a tu pedido #ABC123. ¿En qué te podemos ayudar?`);
		expect(m).not.toMatch(/Hola ,/);
	});

	test('nombre en blanco se trata igual que ausente', () => {
		expect(mensajeWhatsAppAdmin('X1', '   ')).toBe(mensajeWhatsAppAdmin('X1', null));
	});
});

describe('mensajeWhatsAppDomiciliario', () => {
	test('mensaje orientado a la entrega, con nombre cuando existe', () => {
		expect(mensajeWhatsAppDomiciliario('ABC123', 'Ana')).toBe(
			'Hola Ana, soy tu domiciliario para el pedido #ABC123, voy en camino.'
		);
	});

	test('sin nombre: mensaje genérico', () => {
		expect(mensajeWhatsAppDomiciliario('ABC123', null)).toBe(
			'Hola, soy tu domiciliario para el pedido #ABC123, voy en camino.'
		);
	});
});

describe('constantes de país', () => {
	test('el indicativo es el de Colombia y la empresa StarGo', () => {
		expect(INDICATIVO_COLOMBIA).toBe('57');
		expect(NOMBRE_EMPRESA).toBe('StarGo');
	});
});
