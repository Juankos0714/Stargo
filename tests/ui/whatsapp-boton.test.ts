import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import BotonWhatsApp from '../../src/lib/components/BotonWhatsApp.svelte';

describe('BotonWhatsApp (Fase 19)', () => {
	test('pinta un enlace wa.me con el número normalizado y el mensaje urlencoded', () => {
		const mensaje = 'Hola Ana, te escribimos de StarGo respecto a tu pedido #ABC123. ¿En qué te podemos ayudar?';
		render(BotonWhatsApp, {
			telefono: '300 123 4567',
			mensaje,
			label: 'Contactar por WhatsApp'
		});

		const link = screen.getByRole('link', { name: /Contactar por WhatsApp/ });
		expect(link).toHaveAttribute('target', '_blank');
		expect(link).toHaveAttribute('rel', 'noopener noreferrer');
		expect(link.getAttribute('href')).toBe(
			`https://wa.me/573001234567?text=${encodeURIComponent(mensaje)}`
		);
	});		test('un teléfono que ya trae el indicativo 57 no se duplica', () => {
		render(BotonWhatsApp, { telefono: '+57 300 123 4567', mensaje: 'Hola' });
		const href = screen.getByRole('link').getAttribute('href');
		expect(href).toMatch(/wa\.me\/573001234567\?/);
		expect(href).not.toMatch(/5757/);
	});

	test('sin teléfono válido no pinta nada', () => {
		const { container } = render(BotonWhatsApp, { telefono: null, mensaje: 'Hola' });
		expect(container.querySelector('a')).toBeNull();
	});
});
