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
	hoy: { fecha: string; total: number; nivel: number | null; comision: number; escalera_anterior?: boolean } | null;
}>;

/** Resumen del día: fecha Bogotá, total acumulado, nivel alcanzado y comisión. */
function dia(total: number, nivel: number | null, comision: number, fecha = '2026-08-07') {
	return { fecha, total, nivel, comision };
}

function cuenta(niveles = escalera20(), overrides: OverridesCuenta = {}) {
	return {
		niveles,
		bloqueado: false,
		total_comision: 0,
		total_pagos: 0,
		deuda: 0,
		pagos: [] as FixturePago[],
		hoy: dia(0, null, 0),
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
		telefono: '3001234567',
		nombre_cliente: 'Ana',
		tarifa_base: p.total,
		recargos: [],
		recargo_total: 0,
		total: p.total,
		comision: p.estado === 'entregado' ? 1300 : undefined,
		base_necesaria: null,
		valor_mandado: null,
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
	await screen.findByText(/Comisión por nivel según el total del día/);
	return r;
}

/** Fila (<li>) de la tabla de niveles cuyo rango contiene el texto indicado. */
function filaDe(texto: RegExp): HTMLElement | null {
	const span = screen.getByText(texto);
	return span.closest('li');
}

describe('Panel del domiciliario: comisión diaria y resaltado del nivel del día', () => {
	test('muestra la tarjeta de HOY con total, nivel alcanzado y comisión del día', async () => {
		await renderizarCon([], escalera20(), {
			// Total del día $40.000 → nivel 4 → 4 × 1.300 = $5.200.
			hoy: dia(40000, 4, 5200)
		});

		const tarjetaHoy = screen.getByText(/Hoy/).closest('div.rounded-2xl');
		expect(tarjetaHoy).toHaveTextContent('$ 40.000');
		expect(tarjetaHoy).toHaveTextContent('nivel 4');
		expect(tarjetaHoy).toHaveTextContent('comisión $ 5.200');
	});

	test('la tarjeta de HOY sin entregas no inventa nivel ni comisión', async () => {
		await renderizarCon([], escalera20(), { hoy: dia(0, null, 0) });

		const tarjetaHoy = screen.getByText(/Hoy/).closest('div.rounded-2xl');
		expect(tarjetaHoy).toHaveTextContent('sin entregas aún');
		expect(tarjetaHoy).not.toHaveTextContent(/nivel \d/);
	});

	test('muestra en el encabezado el badge con el nivel del día', async () => {
		await renderizarCon([], escalera20(), { hoy: dia(25000, 3, 3900) });

		// $25.000 cae en el nivel 3 (hasta $30.000).
		expect(screen.getByText('hoy: nivel 3')).toBeInTheDocument();
		// El badge de resumen de comisiones sigue presente (el texto también
		// aparece en cada fila de la tabla, por eso getAllByText).
		expect(screen.getAllByText(/^comisión \$ ?1\.300$/).length).toBeGreaterThan(0);
	});

	test('resalta la fila del nivel del día al expandir la tabla', async () => {
		const user = userEvent.setup();
		await renderizarCon([], escalera20(), { hoy: dia(25000, 3, 3900) });

		await user.click(screen.getByText(/Comisión por nivel según el total del día/));
		// jsdom respeta el toggle del <details> al hacer clic en el <summary>.
		expect(screen.getByText(/Comisión por nivel/).closest('details')?.open).toBe(true);

		// Nivel 3 (rango $20.001–$30.000) resaltado y con su etiqueta.
		const filaNivel3 = filaDe(/Pedidos de .*20\.001 a .*30\.000/);
		expect(filaNivel3).not.toBeNull();
		expect(filaNivel3?.className).toContain('bg-primary-light/50');
		expect(filaNivel3).toHaveTextContent('hoy');

		// El nivel 1 (rango hasta $10.000) NO está resaltado.
		const filaNivel1 = filaDe(/Pedidos hasta .*10\.000/);
		expect(filaNivel1?.className).not.toContain('bg-primary-light/50');
		expect(filaNivel1).not.toHaveTextContent('hoy');
	});

	test('si el nivel del día queda oculto, el botón lo anuncia y al expandir se resalta', async () => {
		const user = userEvent.setup();
		await renderizarCon([], escalera20(), { hoy: dia(120000, 12, 15600) });

		// En la vista compacta la fila del nivel 12 NO está en el DOM.
		expect(screen.queryByText(/110\.001/)).not.toBeInTheDocument();

		// El botón intermedio menciona el nivel oculto del día.
		const boton = screen.getByRole('button', {
			name: /Ver los 12 niveles intermedios \(hoy: nivel 12\)/
		});
		expect(boton).toBeInTheDocument();

		// Al expandir aparece la fila del nivel 12 y queda resaltada.
		await user.click(boton);
		const filaNivel12 = filaDe(/Pedidos de .*110\.001 a .*120\.000/);
		expect(filaNivel12).not.toBeNull();
		expect(filaNivel12?.className).toContain('bg-primary-light/50');
		expect(filaNivel12).toHaveTextContent('hoy');
		expect(
			screen.getByRole('button', { name: /Mostrar solo el inicio y el final de la tabla/ })
		).toBeInTheDocument();
	});

	test('sin entregas hoy no muestra badge ni resaltado, pero la tabla de niveles sigue visible', async () => {
		await renderizarCon([]);

		expect(screen.queryByText(/hoy: nivel/)).not.toBeInTheDocument();
		expect(screen.getByText(/Comisión por nivel según el total del día \(20 niveles\)/)).toBeInTheDocument();
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
			],
			deuda: 50000
		});

		// Conteo de abonos visibles en el título.
		expect(screen.getByText('Últimos abonos (2)')).toBeInTheDocument();
		// Total acumulado (no la suma de los visibles: 12000+8000 ≠ 50000).
		expect(screen.getByText('deuda $ 50.000')).toBeInTheDocument();
		// El valor y la nota de cada abono se siguen listando (la nota va
		// precedida de «·» en el mismo nodo de texto).
		expect(screen.getByText(/abono 1/)).toBeInTheDocument();
	});

	test('avisa cuando la escalera cambió HOY: la comisión del día usa la escalera anterior', async () => {
		await renderizarCon([], escalera20(), {
			// La escalera congelada de hoy difiere de la vigente (cambió hoy):
			// la comisión de hoy se calculó con la escalera anterior.
			hoy: { ...dia(25000, 3, 3900), escalera_anterior: true }
		});

		expect(screen.getByText(/La escalera de comisiones cambió/)).toBeInTheDocument();
		expect(screen.getByText(/escalera anterior/)).toBeInTheDocument();
		expect(screen.getByText(/días anteriores tampoco se modifican/)).toBeInTheDocument();
	});

	test('sin cambios de escalera hoy NO aparece el aviso', async () => {
		await renderizarCon([], escalera20(), { hoy: dia(25000, 3, 3900) });

		expect(screen.queryByText(/La escalera de comisiones cambió/)).not.toBeInTheDocument();
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

	test('las entregas activas ofrecen el botón de WhatsApp con el mensaje del domiciliario', async () => {
		await renderizarCon([
			{ id: 'p1', numero: 'KAA1AA', estado: 'en_camino', total: 6000, created_at: '2026-08-07T10:00:00' }
		]);

		const enlace = screen.getByRole('link', { name: /Escribir al cliente/ });
		expect(enlace.getAttribute('href')).toMatch(/wa\.me\/573001234567\?/);
		expect(decodeURIComponent(enlace.getAttribute('href') ?? '')).toContain(
			'Hola Ana, soy tu domiciliario para el pedido #KAA1AA, voy en camino.'
		);
		// El número del cliente también es visible (Tarea 2), junto al botón.
		expect(screen.getByText('Ana · 3001234567')).toBeInTheDocument();
	});

	test('muestra una ficha completa y accionable del pedido activo', async () => {
		const pedidoCompleto = {
			...pedido({ id: 'p1', numero: 'KAA1AA', estado: 'asignado', total: 6000, created_at: '2026-08-07T10:00:00' }),
			base_necesaria: 25000,
			valor_mandado: 45000,
			observaciones: 'Pedir portería antes de subir'
		};
		getMock.mockImplementation((path: string) => {
			if (path.startsWith('/api/pedidos')) return Promise.resolve({ data: [pedidoCompleto], error: null });
			if (path.startsWith('/api/domiciliarios/mi-cuenta')) return Promise.resolve({ data: cuenta(), error: null });
			return Promise.resolve({ data: null, error: null });
		});
		render(Pagina);

		await screen.findByText('Adelantar $ 45.000');
		expect(screen.getByText('Cliente')).toBeInTheDocument();
		expect(screen.getByText('Adelantar $ 45.000')).toBeInTheDocument();
		expect(screen.getByText('Base requerida $ 25.000')).toBeInTheDocument();
		expect(screen.getByText(/Pedir portería antes de subir/)).toBeInTheDocument();
		const recogida = screen.getByRole('link', { name: 'Navegar a recogida' });
		const entrega = screen.getByRole('link', { name: 'Navegar a entrega' });
		expect(recogida).toBeInTheDocument();
		expect(entrega).toBeInTheDocument();
		// Maps recibe exactamente la dirección de cada tramo y una ciudad no ambigua.
		expect(decodeURIComponent(recogida.getAttribute('href') ?? '')).toContain(
			'destination=Calle 1 # 2-3, Barrio A, Armenia, Quindío, Colombia'
		);
		expect(decodeURIComponent(entrega.getAttribute('href') ?? '')).toContain(
			'destination=Carrera 4 # 5-6, Barrio B, Armenia, Quindío, Colombia'
		);
	});

	test('muestra “En punto de recogida” cuando el pedido ya fue recogido', async () => {
		await renderizarCon([
			{ id: 'p1', numero: 'KAA1AA', estado: 'recogido', total: 6000, created_at: '2026-08-07T10:00:00' }
		]);

		expect(screen.getByText('En punto de recogida')).toBeInTheDocument();
	});

	test('sin teléfono no se ofrece el botón de WhatsApp', async () => {
		const sinTelefono = {
			...pedido({ id: 'p1', numero: 'KAA1AA', estado: 'en_camino', total: 6000, created_at: '2026-08-07T10:00:00' }),
			telefono: null,
			nombre_cliente: null
		};
		getMock.mockImplementation((path: string) => {
			if (path.startsWith('/api/pedidos')) return Promise.resolve({ data: [sinTelefono], error: null });
			if (path.startsWith('/api/domiciliarios/mi-cuenta')) {
				return Promise.resolve({ data: cuenta(), error: null });
			}
			return Promise.resolve({ data: null, error: null });
		});
		render(Pagina);
		await screen.findByText(/Comisión por nivel según el total del día/);

		expect(screen.queryByRole('link', { name: /Escribir al cliente/ })).not.toBeInTheDocument();
	});
});
