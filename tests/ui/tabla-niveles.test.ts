import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import TablaNiveles from '../../src/lib/components/TablaNiveles.svelte';
import { rangoDeNiveles } from '$lib/types';

// Componente aislado: no necesita mocks (solo Icon + lógica pura).

/** Escalera de `cantidad` niveles de `paso` pesos, todos con comisión `valor`. */
function nivelesEscalera(cantidad = 20, paso = 10000, valor = 1300) {
	return rangoDeNiveles(
		Array.from({ length: cantidad }, (_, i) => ({
			id: `nivel-${i + 1}`,
			nivel: i + 1,
			hasta: (i + 1) * paso,
			valor
		}))
	);
}

/** Fila (<li>) cuyo rango contiene el texto indicado. */
function filaDe(texto: RegExp): HTMLElement | null {
	return screen.getByText(texto).closest('li');
}

describe('TablaNiveles', () => {
	test('muestra el badge del nivel destacado en el encabezado; sin destacado no hay badge', () => {
		const { unmount } =		render(TablaNiveles, { niveles: nivelesEscalera(), nivelDestacado: 3 });
		expect(screen.getByText('tu último pedido: nivel 3')).toBeInTheDocument();
		// El texto del badge también aparece en cada fila de la tabla.
		expect(screen.getAllByText(/^comisión \$ ?1\.300$/).length).toBeGreaterThan(0);
		unmount();

		render(TablaNiveles, { niveles: nivelesEscalera(), nivelDestacado: null });
		expect(screen.queryByText(/tu último pedido/)).not.toBeInTheDocument();
	});

	test('resalta la fila del nivel destacado y deja las demás sin resaltar', () => {
		render(TablaNiveles, { niveles: nivelesEscalera(), nivelDestacado: 3 });

		// jsdom mantiene el contenido del <details> en el DOM aunque esté cerrado.
		const filaNivel3 = filaDe(/^Pedidos de \$ ?20\.001 a \$ ?30\.000$/);
		expect(filaNivel3?.className).toContain('bg-primary-light/50');
		expect(filaNivel3).toHaveTextContent('tu último pedido');

		const filaNivel1 = filaDe(/^Pedidos hasta \$ ?10\.000$/);
		expect(filaNivel1?.className).not.toContain('bg-primary-light/50');
		expect(filaNivel1).not.toHaveTextContent('tu último pedido');
	});

	test('acepta un título y una nota al pie personalizados', () => {
		render(TablaNiveles, {
			niveles: nivelesEscalera(),
			titulo: 'Escala de comisiones',
			notaPie: 'Fin de la tabla.'
		});
		expect(screen.getByText('Escala de comisiones (20 niveles)')).toBeInTheDocument();
		expect(screen.getByText('Fin de la tabla.')).toBeInTheDocument();
		expect(screen.queryByText(/se congela/)).not.toBeInTheDocument();
	});

	test('un nivel destacado fuera del rango no muestra badge ni mensaje engañoso', () => {
		render(TablaNiveles, { niveles: nivelesEscalera(), nivelDestacado: 99 });

		expect(screen.queryByText(/tu último pedido/)).not.toBeInTheDocument();
		expect(screen.queryByText(/nivel 99/)).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Ver los 12 niveles intermedios…/ })).toBeInTheDocument();
	});

	test('usa la etiqueta personalizada en el badge y en la fila resaltada', () => {
		render(TablaNiveles, {
			niveles: nivelesEscalera(),
			nivelDestacado: 3,
			etiquetaDestacado: 'nivel actual'
		});
		expect(screen.getByText('nivel actual: nivel 3')).toBeInTheDocument();
		expect(filaDe(/^Pedidos de \$ ?20\.001 a \$ ?30\.000$/)).toHaveTextContent('nivel actual');
	});

	test('con más de 8 niveles oculta los intermedios y el botón los anuncia (sin destacado)', async () => {
		const user = userEvent.setup();
		render(TablaNiveles, { niveles: nivelesEscalera(20) });

		// El nivel 7 (intermedio) no está en el DOM; el 1 y el 20 sí.
		expect(screen.queryByText(/60\.001/)).not.toBeInTheDocument();
		expect(screen.getByText(/^Pedidos hasta \$ ?10\.000$/)).toBeInTheDocument();
		expect(screen.getByText(/^Pedidos de \$ ?190\.001 a \$ ?200\.000$/)).toBeInTheDocument();

		const boton = screen.getByRole('button', { name: /Ver los 12 niveles intermedios…/ });
		await user.click(boton);
		expect(screen.getByText(/^Pedidos de \$ ?60\.001 a \$ ?70\.000$/)).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: /Mostrar solo el inicio y el final de la tabla/ })
		).toBeInTheDocument();
	});

	test('si el nivel destacado queda oculto, el botón lo anuncia y al expandir se resalta', async () => {
		const user = userEvent.setup();
		render(TablaNiveles, { niveles: nivelesEscalera(20), nivelDestacado: 12 });

		expect(screen.queryByText(/110\.001/)).not.toBeInTheDocument();
		const boton = screen.getByRole('button', {
			name: /Ver los 12 niveles intermedios \(tu último pedido: nivel 12\)/
		});

		await user.click(boton);
		const filaNivel12 = filaDe(/^Pedidos de \$ ?110\.001 a \$ ?120\.000$/);
		expect(filaNivel12?.className).toContain('bg-primary-light/50');
		expect(filaNivel12).toHaveTextContent('tu último pedido');
	});

	test('con 9 niveles y el 6 destacado usa el singular en el botón', () => {
		render(TablaNiveles, { niveles: nivelesEscalera(9), nivelDestacado: 6 });

		expect(screen.queryByText(/50\.001/)).not.toBeInTheDocument(); // nivel 6 oculto
		expect(
			screen.getByRole('button', { name: /Ver el nivel intermedio \(tu último pedido: nivel 6\)/ })
		).toBeInTheDocument();
	});

	test('con 8 o menos niveles no hay control intermedio y se ven todos', () => {
		render(TablaNiveles, { niveles: nivelesEscalera(6) });

		expect(screen.queryByRole('button')).not.toBeInTheDocument();
		expect(screen.getByText(/^Pedidos de \$ ?50\.001 a \$ ?60\.000$/)).toBeInTheDocument(); // nivel 6
	});

	test('el badge de resumen muestra el rango cuando hay valores distintos', () => {
		const niveles = rangoDeNiveles([
			{ id: 'n1', nivel: 1, hasta: 10000, valor: 1300 },
			{ id: 'n2', nivel: 2, hasta: 20000, valor: 2500 },
			{ id: 'n3', nivel: 3, hasta: 30000, valor: 2500 }
		]);
		render(TablaNiveles, { niveles });

		// El rango solo aparece en el badge del encabezado (las filas muestran su valor).
		expect(screen.getByText(/^comisión \$ ?1\.300 – \$ ?2\.500$/)).toBeInTheDocument();
	});
});
