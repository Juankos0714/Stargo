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
	{ codigo: 'rc-pago', nombre: 'Pago test', tipo: 'pago', valor: 1500, activo: true, descripcion: null },
	{ codigo: 'rc-tiempo', nombre: 'Tiempo espera test', tipo: 'tiempo_espera', valor: 1000, activo: true, descripcion: null },
	{ codigo: 'rc-paradas', nombre: 'Paradas test', tipo: 'paradas', valor: 500, activo: true, descripcion: null },
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

	test('en compra/diligencia los recargos redundantes no se muestran', async () => {
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa' ? Promise.resolve(tarifaOk()) : Promise.resolve({ data: null, error: null })
		);
		const user = userEvent.setup();
		render(Pagina, { props: { data: dataAbierto } });
		await formularioListo();

		// Cambia al modo compra/diligencia.
		await user.click(screen.getByText('Compra / diligencia'));
		// Selecciona tipo de diligencia "pago".
		await user.click(screen.getByText('Pago de factura o servicio'));
		// Recargos redundantes NO deben aparecer: "pago" y "peso".
		expect(screen.queryByText('Pago test')).not.toBeInTheDocument();
		expect(screen.queryByText('Peso test')).not.toBeInTheDocument();
		// Pero otros recargos SÍ deben aparecer.
		expect(screen.getByText('No aplica ningún recargo')).toBeInTheDocument();
	});

	test('al cambiar tipo de diligencia se descartan recargos redundantes seleccionados', async () => {
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa' ? Promise.resolve(tarifaOk()) : Promise.resolve({ data: null, error: null })
		);
		const user = userEvent.setup();
		render(Pagina, { props: { data: dataAbierto } });
		await formularioListo();

		// Cambia al modo compra/diligencia.
		await user.click(screen.getByText('Compra / diligencia'));

		// 1) Selecciona "Otra diligencia": todos los recargos disponibles aparecen.
		await user.click(screen.getByText('Otra diligencia'));
		expect(screen.getByText('Tiempo espera test')).toBeInTheDocument();
		expect(screen.getByText('Paradas test')).toBeInTheDocument();
		expect(screen.getByText('Pago test')).toBeInTheDocument();

		// 2) Selecciona el recargo "Pago test" manualmente.
		await user.click(screen.getByText('Pago test'));

		// 3) Cambia a "Pago de factura o servicio".
		await user.click(screen.getByText('Pago de factura o servicio'));

		// El recargo "Pago test" ya NO debe estar visible (es redundante).
		expect(screen.queryByText('Pago test')).not.toBeInTheDocument();
	});

	test('al cambiar de domicilio a compra/diligencia se limpian recargos de domicilio', async () => {
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa' ? Promise.resolve(tarifaOk()) : Promise.resolve({ data: null, error: null })
		);
		const user = userEvent.setup();
		render(Pagina, { props: { data: dataAbierto } });
		await formularioListo();

		// 1) En modo domicilio, ingresa peso (esto sincroniza el recargo "peso").
		await user.type(screen.getByPlaceholderText('Ej: 2.5'), '3');

		// 2) Cambia a compra/diligencia.
		await user.click(screen.getByText('Compra / diligencia'));
		await user.click(screen.getByText('Otra diligencia'));

		// Los recargos de domicilio (peso, pago) NO deben estar seleccionados.
		// El checkbox "Peso test" no debe existir en compra/diligencia.
		expect(screen.queryByText('Peso test')).not.toBeInTheDocument();
	});

	test('al cambiar de compra a diligencia_bancaria se limpian valores residuales', async () => {
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa' ? Promise.resolve(tarifaOk()) : Promise.resolve({ data: null, error: null })
		);
		const user = userEvent.setup();
		render(Pagina, { props: { data: dataAbierto } });
		await formularioListo();

		// 1) Selecciona "Compra" y ve todos los recargos.
		await user.click(screen.getByText('Compra / diligencia'));
		await user.click(screen.getByText('Compra de productos'));
		expect(screen.getAllByText('Compra test').length).toBeGreaterThanOrEqual(1);
		expect(screen.getByText('Peso test')).toBeInTheDocument();
		expect(screen.getByText('Pago test')).toBeInTheDocument();

		// 2) Cambia a "Pago bancario" (diligencia_bancaria).
		await user.click(screen.getByText('Pago bancario o corresponsal'));

		// Solo "Tiempo espera", "Paradas" y "Otro" deben quedar visibles.
		expect(screen.getByText('Tiempo espera test')).toBeInTheDocument();
		expect(screen.getByText('Paradas test')).toBeInTheDocument();
		expect(screen.queryByText('Compra test')).not.toBeInTheDocument();
		expect(screen.queryByText('Peso test')).not.toBeInTheDocument();
		expect(screen.queryByText('Pago test')).not.toBeInTheDocument();
	});

	test('texto de ayuda contextual aparece al seleccionar tipo de diligencia', async () => {
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa' ? Promise.resolve(tarifaOk()) : Promise.resolve({ data: null, error: null })
		);
		const user = userEvent.setup();
		render(Pagina, { props: { data: dataAbierto } });
		await formularioListo();

		await user.click(screen.getByText('Compra / diligencia'));
		await user.click(screen.getByText('Pago de factura o servicio'));

		// Debe aparecer el texto de ayuda contextual.
		expect(screen.getByText(/El pago que va a realizar el domiciliario/)).toBeInTheDocument();
	});
});
