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

	test('la tarifa se calcula al seleccionar ambos barrios', async () => {
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
			expect(postMock).toHaveBeenCalledWith('/api/calcular_tarifa',
				expect.objectContaining({
					barrio_origen: 'barrio-a',
					barrio_destino: 'barrio-b'
				})
			)
		);
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

		// "Calculando…" puede aparecer en el resumen y/o en el botón Calcular.
		await waitFor(() => expect(screen.queryAllByText('Calculando…').length).toBeGreaterThan(0));

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
		// Botón de confirmar deshabilitado hasta que calcState sea 'calculated'.
		expect(screen.getByRole('button', { name: 'Confirmar pedido' })).toBeDisabled();
	});

	test('valida peso y transferencia al calcular en domicilio', async () => {
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa' ? Promise.resolve(tarifaOk()) : Promise.resolve({ data: null, error: null })
		);
		const user = userEvent.setup();
		render(Pagina, { props: { data: dataAbierto } });
		await formularioListo();
		await elegirBarrio(user, 'Ej: Barrio La Rivera…', 'Barrio A');
		await elegirBarrio(user, 'Ej: Mall Privilegio…', 'Barrio B');
		await waitFor(() => expect(postMock).toHaveBeenCalled());

		// Sin llenar peso ni transferencia, Calcular valida y muestra errores.
		await user.click(screen.getByRole('button', { name: /Calcular/ }));

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
		await waitFor(() => expect(postMock).toHaveBeenCalled());

		await user.type(screen.getByPlaceholderText('Calle 10 # 15-20, Apto 301'), 'Calle 1 # 2-3');
		await user.type(screen.getByPlaceholderText('Carrera 19 # 20-30'), 'Carrera 4 # 5-6');
		// Peso: campo obligatorio.
		await user.type(screen.getByPlaceholderText('Ej: 2.5'), '2');
		// Transferencia: marcar "No hay transferencia".
		await user.click(screen.getByText('No hay transferencia'));
		// Contacto del cliente.
		await user.type(screen.getByPlaceholderText('Ej: Ana María'), 'Ana María');
		await user.type(screen.getByPlaceholderText('300 123 4567'), '300 123 4567');

		// Paso 1: Calcular (valida + calcula tarifa → habilita Confirmar).
		await user.click(screen.getByRole('button', { name: /Calcular/ }));
		await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar pedido' })).not.toBeDisabled());

		// Paso 2: Confirmar.
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

	test('en pago en corresponsal aparecen los campos de pago y no los de compra/peso', async () => {
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa' ? Promise.resolve(tarifaOk()) : Promise.resolve({ data: null, error: null })
		);
		const user = userEvent.setup();
		render(Pagina, { props: { data: dataAbierto } });
		await formularioListo();

		// Selecciona tipo de servicio "Pago en corresponsal" directamente.
		await user.click(screen.getByText('Pago en corresponsal'));
		// Campos de pago presentes.
		expect(screen.getByLabelText(/Descripción/)).toBeInTheDocument();
		expect(screen.getByLabelText(/Valor de la factura/)).toBeInTheDocument();
		// No existen campos de compra ni de peso.
		expect(screen.queryByLabelText(/Productos/)).not.toBeInTheDocument();
	});

	test('confirma un pago con paradas numéricas sin quedarse en confirmando', async () => {
		postMock.mockImplementation((path: string) => {
			if (path === '/api/calcular_tarifa') return Promise.resolve(tarifaOk());
			if (path === '/api/pedidos') {
				return Promise.resolve({
					data: { pedido_id: 'pago-1', numero: 'PAGO01', tarifa_base: 0, recargos: [], recargo_total: 6000, total: 6000, estado: 'pendiente' },
					error: null
				});
			}
			return Promise.resolve({ data: null, error: null });
		});
		const user = userEvent.setup();
		render(Pagina, { props: { data: dataAbierto } });
		await formularioListo();

		await user.click(screen.getByText('Pago en corresponsal'));
		await user.click(screen.getByText('No, solo el destino'));
		await elegirBarrio(user, 'Ej: Mall Privilegio…', 'Barrio B');
		await user.type(screen.getByPlaceholderText('Carrera 19 # 20-30'), 'Calle 4 # 5-6');
		await user.type(screen.getByLabelText(/Descripción/), 'Pago de recibo');
		await user.type(screen.getByLabelText(/Valor de la factura/), '200000');
		await user.type(screen.getByRole('spinbutton', { name: /Paradas adicionales/ }), '2');
		await user.click(screen.getByText('No hay transferencia'));
		await user.type(screen.getByPlaceholderText('300 123 4567'), '3001234567');

		await user.click(screen.getByRole('button', { name: /Calcular/ }));
		await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar pedido' })).not.toBeDisabled());
		await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));

		await waitFor(() => expect(screen.getByText('¡Pedido confirmado!')).toBeInTheDocument());
		expect(postMock).toHaveBeenCalledWith('/api/pedidos', expect.objectContaining({ recargos: expect.arrayContaining(['paradas:2']) }));
	});

	test('al cambiar tipo de diligencia se actualizan los campos visibles', async () => {
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa' ? Promise.resolve(tarifaOk()) : Promise.resolve({ data: null, error: null })
		);
		const user = userEvent.setup();
		render(Pagina, { props: { data: dataAbierto } });
		await formularioListo();

		// 1) Selecciona "Compra de productos": campos de compra visibles.
		await user.click(screen.getByText('Compra de productos'));
		expect(screen.getByLabelText(/Productos \/ descripción/)).toBeInTheDocument();
		expect(screen.queryByLabelText(/^Cantidad$/)).not.toBeInTheDocument();

		// 2) Cambia a "Pago en corresponsal".
		await user.click(screen.getByText('Pago en corresponsal'));

		// Los campos de compra ya NO deben estar visibles.
		expect(screen.queryByLabelText(/Productos \/ descripción/)).not.toBeInTheDocument();
		// Ahora aparecen los campos de pago.
		expect(screen.getByLabelText(/Descripción/)).toBeInTheDocument();
	});

	test('al cambiar de domicilio a pago en corresponsal se cambian las secciones del formulario', async () => {
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa' ? Promise.resolve(tarifaOk()) : Promise.resolve({ data: null, error: null })
		);
		const user = userEvent.setup();
		render(Pagina, { props: { data: dataAbierto } });
		await formularioListo();

		// 1) En modo domicilio, existen los campos de peso y transferencia.
		expect(screen.getByLabelText(/Peso del paquete/)).toBeInTheDocument();
		expect(screen.getByText('No hay transferencia')).toBeInTheDocument();

		// 2) Cambia a pago en corresponsal.
		await user.click(screen.getByText('Pago en corresponsal'));

		// Los campos de domicilio (peso del paquete) ya no deben existir.
		expect(screen.queryByLabelText(/Peso del paquete/)).not.toBeInTheDocument();
	});

	test('al cambiar de compra a pago bancario se cambian los campos del formulario', async () => {
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa' ? Promise.resolve(tarifaOk()) : Promise.resolve({ data: null, error: null })
		);
		const user = userEvent.setup();
		render(Pagina, { props: { data: dataAbierto } });
		await formularioListo();

		// 1) Selecciona "Compra de productos" y ve campos de compra.
		await user.click(screen.getByText('Compra de productos'));
		expect(screen.getByLabelText(/Productos \/ descripción/)).toBeInTheDocument();
		expect(screen.getByLabelText(/Peso del paquete/)).toBeInTheDocument();

		// 2) Cambia a "Pago bancario".
		await user.click(screen.getByText('Pago bancario'));

		// Ya no existen campos de compra ni de peso.
		expect(screen.queryByLabelText(/Productos \/ descripción/)).not.toBeInTheDocument();
		expect(screen.queryByLabelText(/Peso del paquete/)).not.toBeInTheDocument();
		// Ahora aparecen los campos de banco.
		expect(screen.getByLabelText(/Entidad \/ banco/)).toBeInTheDocument();
	});

	test('texto de ayuda contextual aparece al seleccionar tipo de diligencia', async () => {
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa' ? Promise.resolve(tarifaOk()) : Promise.resolve({ data: null, error: null })
		);
		const user = userEvent.setup();
		render(Pagina, { props: { data: dataAbierto } });
		await formularioListo();

		await user.click(screen.getByText('Pago en corresponsal'));

		// Debe aparecer el texto de ayuda contextual.
		expect(screen.getByText(/El pago que va a realizar el domiciliario/)).toBeInTheDocument();
	});
});
