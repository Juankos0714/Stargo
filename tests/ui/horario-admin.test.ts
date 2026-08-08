import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Pagina from '../../src/routes/admin/(panel)/horario/+page.svelte';
import { api } from '$lib/api';

vi.mock('$lib/api', () => ({
	api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }
}));
vi.mock('$lib/realtime', () => ({
	debounce: <A extends unknown[]>(fn: (...args: A) => unknown) => fn,
	suscribirCambios: () => () => {}
}));
vi.mock('$lib/supabase-browser', () => ({
	hidratarSesionRealtime: vi.fn(async () => true)
}));

function semanaPermisiva() {
	return Array.from({ length: 7 }, (_, i) => ({
		dia_semana: i + 1,
		apertura: '08:00',
		cierre: '20:00',
		activo: true
	}));
}

const getMock = vi.mocked(api.get);
const putMock = vi.mocked(api.put);
const delMock = vi.mocked(api.del);

function estadoHoy(abierto: boolean) {
	return {
		fecha: '2026-08-07',
		dia_semana: 5,
		apertura: '08:00',
		cierre: '20:00',
		abierto,
		motivo: null,
		fuente: 'semanal',
		hora_actual: '12:00'
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	getMock.mockImplementation((path: string) => {
		if (path.startsWith('/api/horario?completo=1')) {
			return Promise.resolve({ data: { semanal: semanaPermisiva(), excepciones: [] }, error: null });
		}
		if (path.startsWith('/api/horario')) {
			return Promise.resolve({ data: estadoHoy(true), error: null });
		}
		return Promise.resolve({ data: null, error: null });
	});
	putMock.mockResolvedValue({ data: { ok: true }, error: null });
	delMock.mockResolvedValue({ data: { ok: true }, error: null });
});

describe('Panel admin de horarios', () => {
	test('muestra los 7 días de la semana, el estado de hoy y sus horarios', async () => {
		render(Pagina);
		await screen.findByText('Lunes');
		for (const dia of ['Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']) {
			expect(screen.getByText(dia)).toBeInTheDocument();
		}
		// Estado de hoy: abierto con el rango.
		expect(screen.getByText('La app está recibiendo pedidos')).toBeInTheDocument();
		expect(screen.getByText(/horario 08:00 – 20:00/)).toBeInTheDocument();
		// 7 inputs de apertura + 7 de cierre.
		expect(screen.getAllByDisplayValue('08:00').length).toBeGreaterThanOrEqual(7);
	});

	test('cuando la app está cerrada hoy, la tarjeta lo indica', async () => {
		getMock.mockImplementation((path: string) => {
			if (path.startsWith('/api/horario?completo=1')) {
				return Promise.resolve({ data: { semanal: semanaPermisiva(), excepciones: [] }, error: null });
			}
			if (path.startsWith('/api/horario')) {
				return Promise.resolve({
					data: { ...estadoHoy(false), motivo: 'Cierre por inventario', fuente: 'excepcion' },
					error: null
				});
			}
			return Promise.resolve({ data: null, error: null });
		});
		render(Pagina);
		// El texto «cerrada» también aparece en el render inicial (hoy nulo →
		// el ternario cae en la rama cerrada): se espera a que cargue el rango.
		// Se espera a que cargue el rango (evita el render inicial con hoy nulo).
		const parrafo = await screen.findByText(/horario 08:00 – 20:00/);
		expect(screen.getByText('La app está cerrada para pedidos nuevos')).toBeInTheDocument();
		// El motivo se interpola entre nodos de texto del <p> (jsdom): se
		// verifica contra el textContent completo del párrafo.
		expect(parrafo.textContent).toContain('Cierre por inventario');
	});

	test('guardar un día envía PUT /api/horario con el tipo semanal', async () => {
		const user = userEvent.setup();
		render(Pagina);
		await screen.findByText('Lunes');

		// Hay 7 botones «Guardar» (uno por día); el primero corresponde a Lunes.
		const botonLunes = screen.getAllByRole('button', { name: 'Guardar' })[0];
		await user.click(botonLunes);

		await waitFor(() =>
			expect(putMock).toHaveBeenCalledWith('/api/horario', {
				tipo: 'semanal',
				dia_semana: 1,
				apertura: '08:00',
				cierre: '20:00',
				activo: true
			})
		);
	});

	test('agregar una excepción envía PUT con tipo excepcion', async () => {
		const user = userEvent.setup();
		render(Pagina);
		await screen.findByText('Lunes');

		await user.type(screen.getByLabelText('Fecha'), '2026-12-24');
		await user.type(screen.getByLabelText(/Motivo/), 'Nochebuena');
		const apertura = screen.getByLabelText('Apertura', { exact: true });
		const cierre = screen.getByLabelText('Cierre', { exact: true });
		await user.clear(apertura);
		await user.type(apertura, '08:00');
		await user.clear(cierre);
		await user.type(cierre, '14:00');
		await user.click(screen.getByRole('button', { name: 'Agregar excepción' }));

		await waitFor(() =>
			expect(putMock).toHaveBeenCalledWith('/api/horario', {
				tipo: 'excepcion',
				fecha: '2026-12-24',
				apertura: '08:00',
				cierre: '14:00',
				activo: true,
				motivo: 'Nochebuena'
			})
		);
	});

	test('rechaza horas inválidas (apertura = cierre) sin llamar a la API', async () => {
		const user = userEvent.setup();
		render(Pagina);
		await screen.findByText('Lunes');

		await user.type(screen.getByLabelText('Fecha'), '2026-12-24');
		const apertura = screen.getByLabelText('Apertura', { exact: true });
		const cierre = screen.getByLabelText('Cierre', { exact: true });
		await user.clear(apertura);
		await user.type(apertura, '08:00');
		await user.clear(cierre);
		await user.type(cierre, '08:00');
		await user.click(screen.getByRole('button', { name: 'Agregar excepción' }));

		await waitFor(() => expect(screen.getByText(/no pueden ser la misma hora/)).toBeInTheDocument());
		expect(putMock).not.toHaveBeenCalled();
	});

	test('eliminar una excepción llama a DELETE con la fecha', async () => {
		getMock.mockImplementation((path: string) => {
			if (path.startsWith('/api/horario?completo=1')) {
				return Promise.resolve({
					data: {
						semanal: semanaPermisiva(),
						excepciones: [
							{ fecha: '2026-12-24', apertura: '08:00', cierre: '14:00', activo: true, motivo: 'Nochebuena' }
						]
					},
					error: null
				});
			}
			if (path.startsWith('/api/horario')) {
				return Promise.resolve({ data: estadoHoy(true), error: null });
			}
			return Promise.resolve({ data: null, error: null });
		});
		const user = userEvent.setup();
		const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
		render(Pagina);

		await screen.findByText('2026-12-24');
		await user.click(screen.getByRole('button', { name: 'Eliminar' }));

		await waitFor(() => expect(delMock).toHaveBeenCalledWith('/api/horario?tipo=excepcion&fecha=2026-12-24'));
		confirmar.mockRestore();
	});
});
