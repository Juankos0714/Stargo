import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Pagina from '../../src/routes/nuevo-pedido/+page.svelte';
import { api } from '$lib/api';

vi.mock('$lib/api', () => ({
	api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }
}));

const BARRIOS = [
	{ id: 'barrio-a', nombre: 'Barrio A', zona_id: 'zona-1', revisado: true },
	{ id: 'barrio-b', nombre: 'Barrio B', zona_id: 'zona-2', revisado: true }
];
const ZONAS = [
	{ id: 'zona-1', nombre: 'Zona Norte', tipo: 'urbana', descripcion: null },
	{ id: 'zona-2', nombre: 'Zona Sur', tipo: 'urbana', descripcion: null }
];
const RECARGOS = [
	{ codigo: 'rc-peso', nombre: 'Peso test', tipo: 'peso', valor: 2000, activo: true, descripcion: null },
	{ codigo: 'rc-compra', nombre: 'Compra test', tipo: 'compra', valor: 3000, activo: true, descripcion: null },
	{ codigo: 'rc-inactivo', nombre: 'Inactivo test', tipo: 'otro', valor: 999, activo: false, descripcion: null }
];

const getMock = vi.mocked(api.get);
const postMock = vi.mocked(api.post);

// El endpoint real responde { data: <número>, meta: {...} } (api.ts ya lo
// desempaqueta en `data` + `meta` por separado).
function tarifaOk() {
	return { data: 6000, meta: { disponible: true, motivo: 'ok', zona_origen: 'zona-1', zona_destino: 'zona-2' }, error: null };
}	beforeEach(() => {
		vi.clearAllMocks();
		getMock.mockImplementation((path: string) => {
			if (path.startsWith('/api/barrios')) return Promise.resolve({ data: BARRIOS, error: null });
			if (path.startsWith('/api/zonas')) return Promise.resolve({ data: ZONAS, error: null });
			if (path.startsWith('/api/recargos')) return Promise.resolve({ data: RECARGOS, error: null });
			if (path.startsWith('/api/horario'))
				return Promise.resolve({
					data: { fecha: '2026-08-07', dia_semana: 5, apertura: '08:00', cierre: '20:00', abierto: true, motivo: null, fuente: 'semanal', hora_actual: '12:00' },
					error: null
				});
			return Promise.resolve({ data: null, error: null });
		});
		postMock.mockResolvedValue({ data: null, error: null });
	});

/** Espera a que el formulario esté listo (catálogo cargado). */
async function formularioListo() {
	await screen.findByPlaceholderText('Ej: Barrio La Rivera…');
}

/** Selecciona un barrio escribiendo su nombre en el SearchSelect indicado. */
async function elegirBarrio(user: ReturnType<typeof userEvent.setup>, placeholder: string, query: string) {
	const input = screen.getByPlaceholderText(placeholder);
	await user.click(input);
	await user.type(input, query);
	await user.click(await screen.findByRole('option', { name: new RegExp(query) }));
}	describe('Formulario de creación de pedido', () => {
		test('cuando la app está abierta muestra el aviso de horario y el formulario funciona', async () => {
			postMock.mockImplementation((path: string) =>
				path === '/api/calcular_tarifa' ? Promise.resolve(tarifaOk()) : Promise.resolve({ data: null, error: null })
			);
			render(Pagina);
			await formularioListo();

			expect(screen.getByText(/Atendemos hoy hasta las 20:00/)).toBeInTheDocument();
			expect(screen.getByPlaceholderText('Ej: Barrio La Rivera…')).toBeInTheDocument();
		});

		test('cuando la app está cerrada reemplaza el formulario por el aviso de horario', async () => {
			getMock.mockImplementation((path: string) => {
				if (path.startsWith('/api/barrios')) return Promise.resolve({ data: BARRIOS, error: null });
				if (path.startsWith('/api/zonas')) return Promise.resolve({ data: ZONAS, error: null });
				if (path.startsWith('/api/recargos')) return Promise.resolve({ data: RECARGOS, error: null });
				if (path.startsWith('/api/horario'))
					return Promise.resolve({
						data: { fecha: '2026-08-07', dia_semana: 5, apertura: '08:00', cierre: '20:00', abierto: false, motivo: '24 de diciembre', fuente: 'excepcion', hora_actual: '21:00' },
						error: null
					});
				return Promise.resolve({ data: null, error: null });
			});
			render(Pagina);

			await screen.findByText(/Estamos fuera de horario de atención/);
			// El rango vive dentro de un <strong>; el texto previo en el <p>.
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
		render(Pagina);
		await formularioListo();

		await elegirBarrio(user, 'Ej: Barrio La Rivera…', 'Barrio A');
		expect(postMock).not.toHaveBeenCalled(); // solo origen: aún no calcula
		await elegirBarrio(user, 'Ej: Mall Privilegio…', 'Barrio B');

		await waitFor(() =>
			expect(postMock).toHaveBeenCalledWith('/api/calcular_tarifa', {
				barrio_origen: 'barrio-a',
				barrio_destino: 'barrio-b'
			})
		);
		// es-CO formatea con espacio: «$ 6.000».
		await waitFor(() => expect(screen.getByText(/6\.000/)).toBeInTheDocument());
		const boton = screen.getByRole('button', { name: 'Confirmar pedido' });
		expect(boton).not.toBeDisabled();
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
		render(Pagina);
		await formularioListo();
		await elegirBarrio(user, 'Ej: Barrio La Rivera…', 'Barrio A');
		await elegirBarrio(user, 'Ej: Mall Privilegio…', 'Barrio B');

		await waitFor(() => expect(screen.getByText('Calculando…')).toBeInTheDocument());
		expect(screen.getByRole('button', { name: 'Confirmar pedido' })).toBeDisabled();

		resolver(tarifaOk());
		await waitFor(() => expect(screen.queryByText('Calculando…')).not.toBeInTheDocument());
		await waitFor(() => expect(screen.getByText(/6\.000/)).toBeInTheDocument());
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
		render(Pagina);
		await formularioListo();
		await elegirBarrio(user, 'Ej: Barrio La Rivera…', 'Barrio A');
		await elegirBarrio(user, 'Ej: Mall Privilegio…', 'Barrio B');

		await waitFor(() =>
			expect(screen.getByText(/No disponible: este trayecto no tiene tarifa/)).toBeInTheDocument()
		);
		expect(screen.getByRole('button', { name: 'Confirmar pedido' })).toBeDisabled();
		expect(screen.getByText('No se puede confirmar sin una tarifa disponible.')).toBeInTheDocument();
	});

	test('valida los campos al confirmar y no envía con campos inválidos', async () => {
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa' ? Promise.resolve(tarifaOk()) : Promise.resolve({ data: null, error: null })
		);
		const user = userEvent.setup();
		render(Pagina);
		await formularioListo();
		await elegirBarrio(user, 'Ej: Barrio La Rivera…', 'Barrio A');
		await elegirBarrio(user, 'Ej: Mall Privilegio…', 'Barrio B');
		await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar pedido' })).not.toBeDisabled());

		await user.click(screen.getByRole('button', { name: 'Confirmar pedido' }));

		await waitFor(() => expect(screen.getByText('La dirección de origen es obligatoria.')).toBeInTheDocument());
		expect(screen.getByText('La dirección de destino es obligatoria.')).toBeInTheDocument();
		// Fase 14: sin recargos ni «No aplica» también bloquea el envío.
		expect(
			screen.getByText('Indica si aplican recargos a tu pedido o marca «No aplica».')
		).toBeInTheDocument();
		// Fase 19: el celular es obligatorio para coordinar por WhatsApp.
		expect(screen.getByText('El teléfono es obligatorio para coordinar la entrega.')).toBeInTheDocument();
		expect(postMock).not.toHaveBeenCalledWith('/api/pedidos', expect.anything());
	});

	test('confirma el pedido y muestra el código de seguimiento', async () => {
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
		render(Pagina);
		await formularioListo();
		await elegirBarrio(user, 'Ej: Barrio La Rivera…', 'Barrio A');
		await elegirBarrio(user, 'Ej: Mall Privilegio…', 'Barrio B');
		await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar pedido' })).not.toBeDisabled());

		await user.type(screen.getByPlaceholderText('Calle 10 # 15-20, Apto 301'), 'Calle 1 # 2-3');
		await user.type(screen.getByPlaceholderText('Carrera 19 # 20-30'), 'Carrera 4 # 5-6');
		// Fase 14: decisión explícita de recargos (marcar «No aplica»).
		await user.click(screen.getByText('No aplica'));
		// Fase 19: contacto del cliente (nombre opcional + celular obligatorio).
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
				recargos: [],
				recargos_confirmados_no_aplica: true,
				nombre_cliente: 'Ana María',
				telefono: '300 123 4567'
			})
		);
	});

	test('suma los recargos seleccionados al total estimado (solo activos y aplicables)', async () => {
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa' ? Promise.resolve(tarifaOk()) : Promise.resolve({ data: null, error: null })
		);
		const user = userEvent.setup();
		const { container } = render(Pagina);
		await formularioListo();
		await elegirBarrio(user, 'Ej: Barrio La Rivera…', 'Barrio A');
		await elegirBarrio(user, 'Ej: Mall Privilegio…', 'Barrio B');
		await waitFor(() => expect(screen.getByText(/6\.000/)).toBeInTheDocument());

		// Dos checkboxes: «No aplica» (Fase 14) + el recargo de PESO. El de
		// compra queda oculto en un Domicilio normal (Fase 16) y el inactivo
		// fuera de la lista.
		const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
		expect(checkboxes).toHaveLength(2);

		const noAplica = checkboxes[0];
		const recargo = checkboxes[1];
		// Al marcar un recargo se desmarca «No aplica».
		await user.click(recargo);
		expect(recargo.checked).toBe(true);
		expect(noAplica.checked).toBe(false);
		// El total aparece en el precio grande y en el desglose «Total estimado».
		await waitFor(() => expect(screen.getAllByText(/8\.000/).length).toBeGreaterThan(0));
		expect(screen.getByText('Total estimado')).toBeInTheDocument();
		// Aparece en el checkbox y en el desglose.
		expect(screen.getAllByText('Peso test').length).toBeGreaterThan(0);
		// El recargo de compra no se ofrece en un domicilio normal.
		expect(screen.queryByText('Compra test')).not.toBeInTheDocument();

		// Al marcar «No aplica» se desmarcan los recargos y baja el total.
		await user.click(noAplica);
		expect(noAplica.checked).toBe(true);
		expect(recargo.checked).toBe(false);
		await waitFor(() => expect(screen.getAllByText(/6\.000/).length).toBeGreaterThan(0));
	});

	test('en Compra/diligencia se ofrecen también los recargos de tipo compra', async () => {
		postMock.mockImplementation((path: string) =>
			path === '/api/calcular_tarifa' ? Promise.resolve(tarifaOk()) : Promise.resolve({ data: null, error: null })
		);
		const user = userEvent.setup();
		const { container } = render(Pagina);
		await formularioListo();

		// Cambia al modo compra/diligencia: el recargo de compra debe aparecer.
		await user.click(screen.getByRole('button', { name: /Compra \/ diligencia/ }));
		const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
		// «No aplica» + peso + compra (el inactivo queda fuera).
		expect(checkboxes).toHaveLength(3);
		expect(screen.getAllByText('Compra test').length).toBeGreaterThan(0);
		expect(screen.getAllByText('Peso test').length).toBeGreaterThan(0);
	});
});
