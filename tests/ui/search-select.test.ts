import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import SearchSelect, { type SearchItem } from '../../src/lib/components/SearchSelect.svelte';

const ITEMS: SearchItem[] = [
	{ id: 'a1', label: 'Barrio A', detalle: 'Zona 1' },
	{ id: 'b2', label: 'Barrio B', detalle: 'Zona 2' },
	{ id: 'c3', label: 'Barrio Central', detalle: 'Zona 3' }
];

function renderizar(opts: Partial<{ value: string | null; onchange: (id: string | null) => void; disabled: boolean }> = {}) {
	const onchange = opts.onchange ?? vi.fn();
	const r = render(SearchSelect, {
		items: ITEMS,
		value: opts.value ?? null,
		onchange,
		placeholder: 'Buscar barrio…',
		id: 'sel-test',
		disabled: opts.disabled ?? false
	});
	return { ...r, onchange };
}

describe('SearchSelect', () => {
	test('renderiza el placeholder y un combobox', () => {
		renderizar();
		expect(screen.getByPlaceholderText('Buscar barrio…')).toBeInTheDocument();
		expect(screen.getByRole('combobox')).toBeInTheDocument();
	});

	test('al enfocar muestra todas las opciones', async () => {
		const user = userEvent.setup();
		renderizar();
		const input = screen.getByRole('combobox');
		await user.click(input);
		for (const item of ITEMS) {
			expect(screen.getByRole('option', { name: new RegExp(item.label) })).toBeInTheDocument();
		}
	});

	test('filtra las opciones al escribir', async () => {
		const user = userEvent.setup();
		renderizar();
		const input = screen.getByRole('combobox');
		await user.click(input);
		await user.type(input, 'central');
		expect(screen.getByRole('option', { name: /Barrio Central/ })).toBeInTheDocument();
		expect(screen.queryByRole('option', { name: /Barrio A/ })).not.toBeInTheDocument();
		expect(screen.queryByRole('option', { name: /Barrio B/ })).not.toBeInTheDocument();
	});

	test('elegir una opción llama a onchange con su id y rellena el input', async () => {
		const user = userEvent.setup();
		const { onchange } = renderizar();
		const input = screen.getByRole('combobox');
		await user.click(input);
		await user.type(input, 'Barrio B');
		await user.click(screen.getByRole('option', { name: /Barrio B/ }));
		expect(onchange).toHaveBeenCalledWith('b2');
		expect(screen.getByRole('combobox')).toHaveValue('Barrio B');
		// El listado se cierra tras elegir.
		expect(screen.queryByRole('option')).not.toBeInTheDocument();
	});

	test('sin resultados muestra «Sin resultados»', async () => {
		const user = userEvent.setup();
		renderizar();
		const input = screen.getByRole('combobox');
		await user.click(input);
		await user.type(input, 'zzzz');
		expect(screen.getByText('Sin resultados')).toBeInTheDocument();
	});

	test('con valor seleccionado aparece el botón limpiar y limpia con onchange(null)', async () => {
		const user = userEvent.setup();
		const { onchange } = renderizar({ value: 'a1' });
		expect(screen.getByRole('combobox')).toHaveValue('Barrio A');
		await user.click(screen.getByRole('button', { name: 'Limpiar selección' }));
		expect(onchange).toHaveBeenCalledWith(null);
		expect(screen.getByRole('combobox')).toHaveValue('');
	});

	test('disabled deshabilita el input', () => {
		renderizar({ disabled: true });
		expect(screen.getByRole('combobox')).toBeDisabled();
	});
});
