import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import HistorialTimeline from '../../src/lib/components/HistorialTimeline.svelte';
import { formatearFecha } from '../../src/lib/logic/formato';
import type { HistorialEstado } from '../../src/lib/types';

const HISTORIAL: HistorialEstado[] = [
	{
		id: 1,
		pedido_id: 'p1',
		estado: 'pendiente',
		notas: 'Pedido creado por el cliente',
		created_at: '2026-08-01T10:00:00'
	},
	{ id: 2, pedido_id: 'p1', estado: 'aceptado', notas: null, created_at: '2026-08-01T10:30:00' },
	{
		id: 3,
		pedido_id: 'p1',
		estado: 'entregado',
		notas: 'Entregado a tiempo',
		created_at: '2026-08-01T11:00:00'
	}
];

describe('HistorialTimeline', () => {
	test('muestra cada hito en orden con su etiqueta, nota y fecha', () => {
		render(HistorialTimeline, { historial: HISTORIAL });
		const hitos = screen.getAllByRole('listitem');
		expect(hitos).toHaveLength(3);

		expect(hitos[0]).toHaveTextContent('Pendiente');
		expect(hitos[0]).toHaveTextContent('Pedido creado por el cliente');
		expect(hitos[0]).toHaveTextContent(formatearFecha(HISTORIAL[0].created_at));

		expect(hitos[1]).toHaveTextContent('Aceptado');
		// Sin nota: solo etiqueta + fecha.
		expect(hitos[1]).not.toHaveTextContent('null');

		expect(hitos[2]).toHaveTextContent('Entregado');
		expect(hitos[2]).toHaveTextContent('Entregado a tiempo');
	});

	test('con un historial vacío no renderiza ningún hito', () => {
		render(HistorialTimeline, { historial: [] });
		expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
		// La lista existe (el <ol> se renderiza siempre) pero sin hitos.
		expect(screen.getByRole('list')).toBeInTheDocument();
	});
});
