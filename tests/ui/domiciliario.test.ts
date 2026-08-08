import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Pagina from '../../src/routes/domiciliario/+page.svelte';
import { api } from '$lib/api';

// La página usa Realtime, la hidratación de sesión y $app/state (page.data
// con el domiciliarioId): se controlan aquí, como en el resto de tests de UI.
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
// $app/state lo resuelve el alias de vitest.ui.config.ts → tests/ui/mocks/app-state.ts.

interface FixturePedido {
	id: string;
	numero: string;
	estado: string;
	total: number;
	created_at: string;
}

/** Nivel de comisión: nivel n cubre hasta n × paso, con `valor` de comisión. */
function nivel(n: number, paso = 10000, valor = 1300) {
	return { id: `nivel-${n}`, nivel: n, hasta: n * paso, valor };
}

/** Escalera de 20 niveles de $10.000, todos con comisión $1.300. */
function escalera20() {
	return Array.from({ length: 20 }, (_, i) => nivel(i + 1));
}

interface FixturePago {
	id: string;
	valor: number;
	nota: string | null;
	created_at: string;
}

type OverridesCuenta = Partial<{
	niveles: ReturnType<typeof escalera20>;
	bloqueado: boolean;
	total_comision: number;
	total_pagos: number;
	deuda: number;
	pagos: FixturePago[];
}>;

function cuenta(niveles = escalera20(), overrides: OverridesCuenta = {}) {
	return {
		niveles,
		bloqueado: false,
		total_comision: 0,
		total_pagos: 0,
		deuda: 0,
		pagos: [] as FixturePago[],
		...overrides
	};
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
		tarifa_base: p.total,
		recargos: [],
		recargo_total: 0,
		total: p.total,
		comision: p.estado === 'entregado' ? 1300 : undefined,
		motivo_cancelacion: null,
		zona_origen_id: 'zona-1',
		zona_destino_id: 'zona-2',
		estado: p.estado,
		domiciliario_id: 'domi-1',
		created_at: p.created_at,
		updated_at: p.created_at,
		barrio_origen_nombre: 'Barrio A',
		barrio_destino_nombre: 'Barrio B',
		historial: []
	};
}

const getMock = vi.mocked(api.get);

beforeEach(() => {
	vi.clearAllMocks();
	getMock.mockImplementation((path: string) => {
		if (path.startsWith('/api/pedidos')) return Promise.resolve({ data: [], error: null });
		if (path.startsWith('/api/domiciliarios/mi-cuenta')) {
			return Promise.resolve({ data: cuenta(), error: null });
		}
		return Promise.resolve({ data: null, error: null });
	});
});

/** Monta la página con los pedidos y la cuenta indicados. */
async function renderizarCon(
	pedidos: FixturePedido[],
	niveles = escalera20(),
	overrides: OverridesCuenta = {}
) {
	getMock.mockImplementation((path: string) => {
		if (path.startsWith('/api/pedidos')) return Promise.resolve({ data: pedidos.map(pedido), error: null });
		if (path.startsWith('/api/domiciliarios/mi-cuenta')) {
			return Promise.resolve({ data: cuenta(niveles, overrides), error: null });
		}
		return Promise.resolve({ data: null, error: null });
	});
	const r = render(Pagina);
	// La sección de comisiones aparece cuando la cuenta termina de cargar.
	await screen.findByText(/Comisión por nivel según el valor del pedido/);
	return r;
}

/** Fila (<li>) de la tabla de niveles cuyo rango contiene el texto indicado. */
function filaDe(texto: RegExp): HTMLElement | null {
	const span = screen.getByText(texto);
	return span.closest('li');
}

describe('Panel del domiciliario: resaltado del nivel del último pedido', () => {
	test('muestra en el encabezado el badge con el nivel del último pedido', async () => {
		await renderizarCon([
			{ id: 'p1', numero: 'ABC111', estado: 'en_camino', total: 25000, created_at: '2026-08-01T10:00:00' }
		]);

		// $25.000 cae en el nivel 3 (hasta $30.000).
		expect(screen.getByText('tu último pedido: nivel 3')).toBeInTheDocument();
		// El badge de resumen de comisiones sigue presente (el texto también
		// aparece en cada fila de la tabla, por eso getAllByText).
		expect(screen.getAllByText(/^comisión \$ ?1\.300$/).length).toBeGreaterThan(0);
	});

	test('resalta la fila del nivel del último pedido al expandir la tabla', async () => {
		const user = userEvent.setup();
		await renderizarCon([
			{ id: 'p1', numero: 'ABC111', estado: 'en_camino', total: 25000, created_at: '2026-08-01T10:00:00' }
		]);

		await user.click(screen.getByText(/Comisión por nivel según el valor del pedido/));
		// jsdom respeta el toggle del <details> al hacer clic en el <summary>.
		expect(screen.getByText(/Comisión por nivel/).closest('details')?.open).toBe(true);

		// Nivel 3 (rango $20.001–$30.000) resaltado y con su etiqueta.
		const filaNivel3 = filaDe(/Pedidos de .*20\.001 a .*30\.000/);
		expect(filaNivel3).not.toBeNull();
		expect(filaNivel3?.className).toContain('bg-primary-light/50');
		expect(filaNivel3).toHaveTextContent('tu último pedido');

		// El nivel 1 (rango hasta $10.000) NO está resaltado.
		const filaNivel1 = filaDe(/Pedidos hasta .*10\.000/);
		expect(filaNivel1?.className).not.toContain('bg-primary-light/50');
		expect(filaNivel1).not.toHaveTextContent('tu último pedido');
	});

	test('el badge y el resaltado corresponden al pedido MÁS reciente (orden por created_at)', async () => {
		const user = userEvent.setup();
		await renderizarCon([
			// Pedido entregado más viejo: total $8.000 → nivel 1.
			{ id: 'p1', numero: 'ABC111', estado: 'entregado', total: 8000, created_at: '2026-08-01T10:00:00' },
			// Pedido más reciente: total $25.000 → nivel 3.
			{ id: 'p2', numero: 'ABC222', estado: 'en_camino', total: 25000, created_at: '2026-08-01T11:00:00' }
		]);

		expect(screen.getByText('tu último pedido: nivel 3')).toBeInTheDocument();
		expect(screen.queryByText('tu último pedido: nivel 1')).not.toBeInTheDocument();

		await user.click(screen.getByText(/Comisión por nivel según el valor del pedido/));
		expect(filaDe(/Pedidos de .*20\.001 a .*30\.000/)?.className).toContain('bg-primary-light/50');
		expect(filaDe(/Pedidos hasta .*10\.000/)?.className).not.toContain('bg-primary-light/50');
	});

	test('si el nivel del último pedido queda oculto, el botón lo anuncia y al expandir se resalta', async () => {
		const user = userEvent.setup();
		await renderizarCon([
			// Total $120.000 → nivel 12 (oculto entre los intermedios 6–17).
			{ id: 'p1', numero: 'ABC111', estado: 'en_camino', total: 120000, created_at: '2026-08-01T10:00:00' }
		]);

		// En la vista compacta la fila del nivel 12 NO está en el DOM.
		expect(screen.queryByText(/110\.001/)).not.toBeInTheDocument();

		// El botón intermedio menciona el nivel oculto del último pedido.
		const boton = screen.getByRole('button', {
			name: /Ver los 12 niveles intermedios \(tu último pedido: nivel 12\)/
		});
		expect(boton).toBeInTheDocument();

		// Al expandir aparece la fila del nivel 12 y queda resaltada.
		await user.click(boton);
		const filaNivel12 = filaDe(/Pedidos de .*110\.001 a .*120\.000/);
		expect(filaNivel12).not.toBeNull();
		expect(filaNivel12?.className).toContain('bg-primary-light/50');
		expect(filaNivel12).toHaveTextContent('tu último pedido');
		expect(
			screen.getByRole('button', { name: /Mostrar solo el inicio y el final de la tabla/ })
		).toBeInTheDocument();
	});

	test('sin pedidos no muestra badge ni resaltado, pero la tabla de niveles sigue visible', async () => {
		await renderizarCon([]);

		expect(screen.queryByText(/tu último pedido/)).not.toBeInTheDocument();
		expect(screen.getByText(/Comisión por nivel según el valor del pedido \(20 niveles\)/)).toBeInTheDocument();
		expect(screen.getAllByText(/^comisión \$ ?1\.300$/).length).toBeGreaterThan(0);
	});

	test('el encabezado de abonos muestra el total abonado acumulado', async () => {
		await renderizarCon([], escalera20(), {
			// El acumulado usa total_pagos (Σ de TODOS los abonos), aunque la
			// API solo liste los últimos 10: aquí difieren a propósito.
			total_pagos: 50000,
			pagos: [
				{ id: 'pg1', valor: 12000, nota: 'abono 1', created_at: '2026-08-01T10:00:00' },
				{ id: 'pg2', valor: 8000, nota: null, created_at: '2026-08-02T10:00:00' }
			]
		});

		// Conteo de abonos visibles en el título.
		expect(screen.getByText('Últimos abonos (2)')).toBeInTheDocument();
		// Total acumulado (no la suma de los visibles: 12000+8000 ≠ 50000).
		expect(screen.getByText('total abonado $ 50.000')).toBeInTheDocument();
		// El valor y la nota de cada abono se siguen listando (la nota va
		// precedida de «·» en el mismo nodo de texto).
		expect(screen.getByText(/abono 1/)).toBeInTheDocument();
	});

	test('el summary de abonos muestra el estado de la deuda como badge verde/rojo', async () => {
		// Al día (deuda 0): badge verde.
		const alDia = await renderizarCon([], escalera20(), {
			total_pagos: 50000,
			deuda: 0,
			pagos: [{ id: 'pg1', valor: 50000, nota: null, created_at: '2026-08-01T10:00:00' }]
		});
		const badgeAlDia = screen.getByText('al día');
		expect(badgeAlDia.className).toContain('bg-green-100');
		expect(screen.queryByText('en deuda')).not.toBeInTheDocument();
		alDia.unmount();

		// En deuda (deuda > 0): badge rojo.
		await renderizarCon([], escalera20(), {
			total_pagos: 30000,
			deuda: 12000,
			pagos: [{ id: 'pg1', valor: 30000, nota: null, created_at: '2026-08-01T10:00:00' }]
		});
		const badgeEnDeuda = screen.getByText('en deuda');
		expect(badgeEnDeuda.className).toContain('bg-red-100');
		expect(screen.queryByText('al día')).not.toBeInTheDocument();
	});
});
