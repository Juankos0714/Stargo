import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Pagina from '../../src/routes/admin/(panel)/pedidos/+page.svelte';
import { api } from '$lib/api';

// La página usa Realtime y la hidratación de sesión: se controlan aquí.
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

interface FixturePedido {
	id: string;
	numero: string;
	estado: string;
}

function pedido(p: FixturePedido) {
	return {
		id: p.id,
		numero: p.numero,
		barrio_origen_id: 'b-origen',
		direccion_origen: 'Calle 1 # 2-3',
		barrio_destino_id: 'b-destino',
		direccion_destino: 'Carrera 4 # 5-6',
		observaciones: null,
		tarifa_base: 6000,
		recargos: null,
		recargo_total: 0,
		total: 6000,
		motivo_cancelacion: null,
		zona_origen_id: 'zona-1',
		zona_destino_id: 'zona-2',
		estado: p.estado,
		domiciliario_id: null,
		created_at: '2026-08-01T10:00:00',
		updated_at: '2026-08-01T10:00:00',
		barrio_origen_nombre: 'Barrio A',
		barrio_destino_nombre: 'Barrio B',
		domiciliario_nombre: null,
		historial: []
	};
}

const getMock = vi.mocked(api.get);

beforeEach(() => {
	vi.clearAllMocks();
});

async function renderizarCon(pedidos: FixturePedido[]) {
	getMock.mockImplementation((path: string) => {
		if (path.startsWith('/api/pedidos')) return Promise.resolve({ data: pedidos.map(pedido), error: null });
		if (path.startsWith('/api/domiciliarios')) {
			return Promise.resolve({
				data: [
					{ id: 'd1', user_id: 'u1', nombre: 'Ana López', email: null, telefono: null, activo: true },
					{ id: 'd2', user_id: 'u2', nombre: 'Luis Paz', email: null, telefono: null, activo: false }
				],
				error: null
			});
		}
		return Promise.resolve({ data: null, error: null });
	});
	const r = render(Pagina);
	// La tabla se pinta cuando la carga termina.
	await screen.findByText('Pedidos');
	await waitFor(() => expect(screen.queryByText('Cargando pedidos…')).not.toBeInTheDocument());
	return r;
}

function filasVisibles(): string[] {
	return [...document.querySelectorAll('tbody tr')].map((tr) => tr.textContent ?? '');
}

describe('Tabla de pedidos del admin', () => {
	test('filtra por la pestaña activa (por defecto pendientes) y muestra contadores', async () => {
		const { container } = await renderizarCon([
			{ id: 'p1', numero: 'KAA1AA', estado: 'pendiente' },
			{ id: 'p2', numero: 'KBB2BB', estado: 'pendiente' },
			{ id: 'p3', numero: 'KCC3CC', estado: 'entregado' }
		]);

		// Pestaña por defecto: solo pendientes.
		expect(filasVisibles().filter((t) => t.includes('KAA1AA'))).toHaveLength(1);
		expect(filasVisibles().filter((t) => t.includes('KCC3CC'))).toHaveLength(0);

		// Contadores por estado.
		const tabPendientes = screen.getByRole('button', { name: /Pendientes/ });
		expect(tabPendientes).toHaveTextContent('2');
		expect(screen.getByRole('button', { name: /Entregados/ })).toHaveTextContent('1');
		expect(screen.getByRole('button', { name: /Cancelados/ })).toHaveTextContent('0');
		expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
	});

	test('cambia de pestaña y muestra el estado vacío cuando no hay filas', async () => {
		const user = userEvent.setup();
		await renderizarCon([
			{ id: 'p1', numero: 'KAA1AA', estado: 'pendiente' },
			{ id: 'p3', numero: 'KCC3CC', estado: 'entregado' }
		]);

		await user.click(screen.getByRole('button', { name: /Entregados/ }));
		expect(filasVisibles().filter((t) => t.includes('KCC3CC'))).toHaveLength(1);
		expect(screen.queryByText('KAA1AA')).not.toBeInTheDocument();

		// Estado vacío en una pestaña sin pedidos.
		await user.click(screen.getByRole('button', { name: /Cancelados/ }));
		expect(screen.getByText('No hay pedidos cancelados por ahora.')).toBeInTheDocument();
		expect(screen.queryByRole('row', { name: /KAA1AA/ })).not.toBeInTheDocument();
	});

	test('«Todos» muestra todas las filas en el orden que trae la API', async () => {
		const user = userEvent.setup();
		const { container } = await renderizarCon([
			{ id: 'p1', numero: 'KAA1AA', estado: 'pendiente' },
			{ id: 'p2', numero: 'KBB2BB', estado: 'cancelado' },
			{ id: 'p3', numero: 'KCC3CC', estado: 'entregado' }
		]);

		await user.click(screen.getByRole('button', { name: /Todos/ }));
		const filas = [...container.querySelectorAll('tbody tr')];
		expect(filas).toHaveLength(3);
		expect(filas[0].textContent).toContain('KAA1AA');
		expect(filas[1].textContent).toContain('KBB2BB');
		expect(filas[2].textContent).toContain('KCC3CC');
	});

	test('sin pedidos muestra el estado vacío de la pestaña por defecto', async () => {
		await renderizarCon([]);
		expect(screen.getByText('No hay pedidos pendientes por ahora.')).toBeInTheDocument();
	});

	test('los pedidos pendientes ofrecen asignar (solo domiciliarios activos)', async () => {
		await renderizarCon([{ id: 'p1', numero: 'KAA1AA', estado: 'pendiente' }]);
		expect(screen.getByRole('button', { name: 'Asignar' })).toBeInTheDocument();
		const select = screen.getByRole('combobox');
		const opciones = [...select.querySelectorAll('option')].map((o) => o.textContent ?? '');
		expect(opciones).toContain('Ana López');
		expect(opciones).not.toContain('Luis Paz'); // inactivo
	});

	test('los pedidos en estado activo ofrecen cancelar; los terminales no', async () => {
		const user = userEvent.setup();
		await renderizarCon([
			{ id: 'p1', numero: 'KAA1AA', estado: 'aceptado' },
			{ id: 'p3', numero: 'KCC3CC', estado: 'entregado' }
		]);
		// La pestaña por defecto es «Pendientes»: hay que abrir «Aceptados».
		await user.click(screen.getByRole('button', { name: /Aceptados/ }));
		expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();

		// Un estado terminal no ofrece cancelar (solo un «—»).
		await user.click(screen.getByRole('button', { name: /Entregados/ }));
		expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
	});
});
