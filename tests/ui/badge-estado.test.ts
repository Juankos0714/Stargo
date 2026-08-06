import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/svelte';
import BadgeEstado from '../../src/lib/components/BadgeEstado.svelte';
import { ESTADOS_PEDIDO, type EstadoPedido } from '../../src/lib/types';

const ESTADOS = Object.keys(ESTADOS_PEDIDO) as EstadoPedido[];

describe('BadgeEstado — los 7 estados de pedido', () => {
	test.each(ESTADOS)('%s → etiqueta y colores canónicos', (estado) => {
		const { container } = render(BadgeEstado, { estado });
		const badge = container.querySelector('span');
		expect(badge).not.toBeNull();
		expect(badge!).toHaveTextContent(ESTADOS_PEDIDO[estado].label);
		// Cada clase de color del Design System debe estar presente en el badge.
		for (const clase of ESTADOS_PEDIDO[estado].color.split(' ')) {
			expect(badge!).toHaveClass(clase);
		}
		expect(badge!).toHaveClass('rounded-full');
		expect(badge!).toHaveClass('font-semibold');
	});

	test('tamaño por defecto (sm) aplica las clases base', () => {
		const { container } = render(BadgeEstado, { estado: 'pendiente' });
		expect(container.querySelector('span')).toHaveClass('px-2.5', 'py-0.5', 'text-xs');
	});

	test('size="lg" aplica el tamaño grande', () => {
		const { container } = render(BadgeEstado, { estado: 'entregado', size: 'lg' });
		expect(container.querySelector('span')).toHaveClass('px-3', 'py-1', 'text-sm');
	});

	test('class adicional se pasa al span (posicionamiento)', () => {
		const { container } = render(BadgeEstado, { estado: 'asignado', class: 'ml-auto' });
		expect(container.querySelector('span')).toHaveClass('ml-auto');
	});
});
