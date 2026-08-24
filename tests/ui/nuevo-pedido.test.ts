import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Pagina from '../../src/routes/nuevo-pedido/+page.svelte';
import { api } from '$lib/api';
import type { Barrio, HorarioHoy, Recargo, Zona } from '$lib/types';

vi.mock('$lib/api', () => ({
	api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }
}));

const BARRIOS: Barrio[] = [
	{ id: 'barrio-a', nombre: 'Barrio A', zona_id: 'zona-1', revisado: true },
	{ id: 'barrio-b', nombre: 'Barrio B', zona_id: 'zona-2', revisado: true }
];
const ZONAS: Zona[] = [
	{ id: 'zona-1', nombre: 'Zona Norte', tipo: 'urbana', descripcion: null },
	{ id: 'zona-2', nombre: 'Zona Sur', tipo: 'urbana', descripcion: null }
];
const RECARGOS: Recargo[] = [
	{ codigo: 'rc-peso', nombre: 'Peso test', tipo: 'peso', valor: 2000, activo: true, descripcion: null },
	{ codigo: 'rc-compra', nombre: 'Compra test', tipo: 'compra', valor: 3000, activo: true, descripcion: null },
	{ codigo: 'rc-inactivo', nombre: 'Inactivo test', tipo: 'otro', valor: 999, activo: false, descripcion: null }
];

const HORARIO_ABIERTO: HorarioHoy = {
	fecha: '2026-08-07',
	dia_semana: 5,
	apertura: '08:00',
	cierre: '20:00',
	abierto: true,
	motivo: null,
	fuente: 'semanal',
	hora_actual: '12:00'
};
const HORARIO_CERRADO: HorarioHoy = {
	fecha: '2026-08-07',
	dia_semana: 5,
	apertura: '08:00',
	cierre: '20:00',
	abierto: false,
	motivo: '24 de diciembre',
	fuente: 'excepcion',
	hora_actual: '21:00'
};
const dataAbierto = { barrios: BARRIOS, zonas: ZONAS, recargos: RECARGOS, horario: HORARIO_ABIERTO, error: null };
const dataCerrado = { barrios: BARRIOS, zonas: ZONAS, recargos: RECARGOS, horario: HORARIO_CERRADO, error: null };

const postMock = vi.mocked(api.post);

function tarifaOk() {
	return { data: 6000, meta: { disponible: true, motivo: 'ok', zona_origen: 'zona-1', zona_destino: 'zona-2' }, error: null };
}
beforeEach(() => {
	vi.clearAllMocks();
	postMock.mockResolvedValue({ data: null, error: null });
});

async function formularioListo() {
	await screen.findByPlaceholderText('Ej: Barrio La Rivera…');
}

async function elegirBarrio(user: ReturnType<typeof userEvent.setup>, placeholder: string, query: string) {
	const input = screen.getByPlaceholderText(placeholder);
	await user.click(input);
	await user.type(input, query);
	await user.click(await screen.findByRole('option', { name: new RegExp(query) }));
}

describe('Formulario de creación de pedido', () => {
	test('cuando la app está abierta muestra el aviso de horario y el formulario funciona', async () => {
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa' ? Promise.resolve(tarifaOk()) : Promise.resolve({ data: null, error: null })
		);
		render(Pagina, { props: { data: dataAbierto } });
		await formularioListo();

		expect(screen.getByText(/Atendemos hoy hasta las 20:00/)).toBeInTheDocument();
		expect(screen.getByPlaceholderText('Ej: Barrio La Rivera…')).toBeInTheDocument();
	});

	test('cuando la app está cerrada reemplaza el formulario por el aviso de horario', async () => {
		render(Pagina, { props: { data: dataCerrado } });

		await screen.findByText(/Estamos fuera de horario de atención/);
		expect(screen.getByText(/Horario de hoy/)).toBeInTheDocument();
		expect(screen.getByText('08:00 – 20:00')).toBeInTheDocument();
		expect(screen.getByText('Consultar estado de mi pedido')).toBeInTheDocument();
		expect(screen.queryByPlaceholderText('Ej: Barrio La Rivera…')).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Confirmar pedido' })).not.toBeInTheDocument();
	});

	test('la tarifa se calcula al seleccionar ambos barrios y habilita el envío', async () => {
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa' ? Promise.resolve(tarifaOk()) : Promise.resolve({ data: null, error: null })
		);
		const user = userEvent.setup();
		render(Pagina, { props: { data: dataAbierto } });
		await formularioListo();

		await elegirBarrio(user, 'Ej: Barrio La Rivera…', 'Barrio A');
		expect(postMock).not.toHaveBeenCalled();
		await elegirBarrio(user, 'Ej: Mall Privilegio…', 'Barrio B');

		await waitFor(() =>
			expect(postMock).toHaveBeenCalledWith('/api/calcular_tarifa', {
				barrio_origen: 'barrio-a',
				barrio_destino: 'barrio-b'
			})
		);
		// La tarifa se calcula y el botón se habilita
		const boton = screen.getByRole('button', { name: 'Confirmar pedido' });
		await waitFor(() => expect(boton).not.toBeDisabled());
	});

	test('muestra el estado de carga mientras se calcula la tarifa', async () => {
		let resolver!: (v: unknown) => void;
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa'
				? new Promise((res) => {
						resolver = res as (v: unknown) => void;
					})
				: Promise.resolve({ data: null, error: null })
		);
		const user = userEvent.setup();
		render(Pagina, { props: { data: dataAbierto } });
		await formularioListo();
		await elegirBarrio(user, 'Ej: Barrio La Rivera…', 'Barrio A');
		await elegirBarrio(user, 'Ej: Mall Privilegio…', 'Barrio B');

		await waitFor(() => expect(screen.getByText('Calculando…')).toBeInTheDocument());
		expect(screen.getByRole('button', { name: 'Confirmar pedido' })).toBeDisabled();

		resolver(tarifaOk());
		await waitFor(() => expect(screen.queryByText('Calculando…')).not.toBeInTheDocument());
	});

	test('sin tarifa para la ruta muestra el error y bloquea la confirmación', async () => {
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa'
				? Promise.resolve({
						data: null,
						meta: { disponible: false, motivo: 'sin_tarifa' },
						error: null
					})
				: Promise.resolve({ data: null, error: null })
		);
		const user = userEvent.setup();
		render(Pagina, { props: { data: dataAbierto } });
		await formularioListo();
		await elegirBarrio(user, 'Ej: Barrio La Rivera…', 'Barrio A');
		await elegirBarrio(user, 'Ej: Mall Privilegio…', 'Barrio B');

		await waitFor(() =>
			expect(screen.getByText(/No disponible: este trayecto no tiene tarifa/)).toBeInTheDocument()
		);
		expect(screen.getByRole('button', { name: 'Confirmar pedido' })).toBeDisabled();
		expect(screen.getByText('No se puede confirmar sin una tarifa disponible.')).toBeInTheDocument();
	});

	test('valida peso y transferencia al confirmar en domicilio', async () => {
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa' ? Promise.resolve(tarifaOk()) : Promise.resolve({ data: null, error: null })
		);
		const user = userEvent.setup();
		render(Pagina, { props: { data: dataAbierto } });
		await formularioListo();
		await elegirBarrio(user, 'Ej: Barrio La Rivera…', 'Barrio A');
		await elegirBarrio(user, 'Ej: Mall Privilegio…', 'Barrio B');
		await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar pedido' })).not.toBeDisabled());

		await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));

		await waitFor(() => expect(screen.getByText('La dirección de origen es obligatoria.')).toBeInTheDocument());
		expect(screen.getByText('La dirección de destino es obligatoria.')).toBeInTheDocument();
		// Peso y transferencia son obligatorios en domicilio.
		expect(screen.getByText('El peso del paquete es obligatorio.')).toBeInTheDocument();
		expect(screen.getByText('Indica si hay transferencia bancaria.')).toBeInTheDocument();
		expect(postMock).not.toHaveBeenCalledWith('/api/pedidos', expect.anything());
	});

	test('confirma el pedido domicilio con peso y transferencia', async () => {
		postMock.mockImplementation((path: string) => {
			if (path === '/api/calcular_tarifa') return Promise.resolve(tarifaOk());
			if (path === '/api/pedidos') {
				return Promise.resolve({
					data: { pedido_id: 'x', numero: 'ABC123', tarifa_base: 6000, recargos: [], recargo_total: 0, total: 6000, estado: 'pendiente' },
					error: null
				});
			}
			return Promise.resolve({ data: null, error: null });
		});
		const user = userEvent.setup();
		render(Pagina, { props: { data: dataAbierto } });
		await formularioListo();
		await elegirBarrio(user, 'Ej: Barrio La Rivera…', 'Barrio A');
		await elegirBarrio(user, 'Ej: Mall Privilegio…', 'Barrio B');
		await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar pedido' })).not.toBeDisabled());

		await user.type(screen.getByPlaceholderText('Calle 10 # 15-20, Apto 301'), 'Calle 1 # 2-3');
		await user.type(screen.getByPlaceholderText('Carrera 19 # 20-30'), 'Carrera 4 # 5-6');
		// Peso: campo obligatorio.
		await user.type(screen.getByPlaceholderText('Ej: 2.5'), '2');
		// Transferencia: marcar "No hay transferencia".
		await user.click(screen.getByText('No hay transferencia'));
		// Contacto del cliente.
		await user.type(screen.getByPlaceholderText('Ej: Ana María'), 'Ana María');
		await user.type(screen.getByPlaceholderText('300 123 4567'), '300 123 4567');
		await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));

		await waitFor(() => expect(screen.getByText('¡Pedido confirmado!')).toBeInTheDocument());
		expect(screen.getByText('ABC123')).toBeInTheDocument();
		expect(postMock).toHaveBeenCalledWith(
			'/api/pedidos',
			expect.objectContaining({
				barrio_origen: 'barrio-a',
				barrio_destino: 'barrio-b',
				direccion_origen: 'Calle 1 # 2-3',
				direccion_destino: 'Carrera 4 # 5-6',
				tipo_servicio: 'domicilio',
				nombre_cliente: 'Ana María',
				telefono: '300 123 4567'
			})
		);
	});

	test('en compra/diligencia no se muestran recargos, solo "No aplica"', async () => {
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa' ? Promise.resolve(tarifaOk()) : Promise.resolve({ data: null, error: null })
		);
		const user = userEvent.setup();
		const { container } = render(Pagina, { props: { data: dataAbierto } });
		await formularioListo();

		// Cambia al modo compra/diligencia.
		await user.click(screen.getByText('Compra / diligencia'));
		// Solo debe haber 1 checkbox: "No aplica ningún recargo".
		const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
		expect(checkboxes).toHaveLength(1);
		// No deben existir recargos de peso ni compra.
		expect(screen.queryByText('Peso test')).not.toBeInTheDocument();
		expect(screen.queryByText('Compra test')).not.toBeInTheDocument();
	});
});
