import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Pagina from '../../src/routes/admin/(panel)/comisiones/+page.svelte';
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

/** Nivel de comisión: nivel n cubre hasta `hasta`, con comisión `valor`. */
function nivel(n: number, hasta: number, valor = 1300) {
	return { id: `nivel-${n}`, nivel: n, hasta, valor };
}

const NIVELES = [nivel(1, 10000), nivel(2, 20000), nivel(3, 30000)];
const CONFIG = { id: 'config', paso: 10000, niveles: 3 };

/** Escalera de `cantidad` niveles de `paso` pesos (espeja la config real de 20 niveles). */
function escalera(cantidad = 20, paso = 10000) {
	return Array.from({ length: cantidad }, (_, i) => nivel(i + 1, (i + 1) * paso));
}
const CONFIG_20 = { id: 'config', paso: 10000, niveles: 20 };

const getMock = vi.mocked(api.get);
const postMock = vi.mocked(api.post);
const putMock = vi.mocked(api.put);
const delMock = vi.mocked(api.del);

beforeEach(() => {
	vi.clearAllMocks();
	getMock.mockResolvedValue({ data: NIVELES, meta: { config: CONFIG }, error: null });
	postMock.mockResolvedValue({ data: null, error: null });
	putMock.mockResolvedValue({ data: null, error: null });
	delMock.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
	// Restaura window.confirm entre tests.
	vi.restoreAllMocks();
});

/**
 * Establece el valor de un input. Se usa fireEvent en vez de user.clear+type:
 * user-event no limpia de forma fiable los <input type="number"> en jsdom.
 */
function setInput(input: HTMLElement, valor: string) {
	fireEvent.input(input, { target: { value: valor } });
}

/** Monta la página y espera a que la primera fila de la tabla esté lista. */
async function renderizar() {
	const r = render(Pagina);
	// Espera la fila 1 (no solo el encabezado, que aparece antes de cargar).
	await screen.findByLabelText('Comisión del nivel 1');
	return r;
}

describe('Panel admin de comisiones', () => {
	test('muestra la escalera: encabezado con config, tarjeta y una fila por nivel', async () => {
		await renderizar();

		expect(screen.getByRole('heading', { name: 'Comisiones por nivel' })).toBeInTheDocument();
		// Encabezado de la tabla con la config de la escalera.
		expect(screen.getByText(/3 niveles · cada uno abarca \$ ?10\.000/)).toBeInTheDocument();

		// Tarjeta «Escalera de niveles» con paso y cantidad precargados.
		expect(screen.getByText('Escalera de niveles')).toBeInTheDocument();
		// El input es type="text" con value={formatearMontoCampo(pasoInput)}: muestra "10.000".
		expect(screen.getByLabelText('Paso entre niveles')).toHaveValue('10.000');
		expect(screen.getByLabelText('Cantidad de niveles')).toHaveValue(3);

		// Una fila por nivel con su rango y comisión.
		expect(screen.getByText('Hasta $ 10.000')).toBeInTheDocument();
		expect(screen.getByText(/De \$ ?10\.001 a \$ ?20\.000/)).toBeInTheDocument(); // nivel 2
		// Los inputs de comisión y tope son type="text" con formatearMontoCampo.
		expect(screen.getByLabelText('Comisión del nivel 1')).toHaveValue('1.300');
		expect(screen.getByLabelText('Tope del nivel 1')).toHaveValue('10.000');
		expect(screen.getAllByRole('button', { name: 'Guardar' })).toHaveLength(3);
		expect(screen.getAllByRole('button', { name: 'Eliminar' })).toHaveLength(3);
	});

	test('guarda el valor de un nivel (PUT) y confirma con el mensaje', async () => {
		const user = userEvent.setup();
		await renderizar();

		setInput(screen.getByLabelText('Comisión del nivel 1'), '1500');
		await user.click(screen.getAllByRole('button', { name: 'Guardar' })[0]);

		await waitFor(() =>
			expect(putMock).toHaveBeenCalledWith('/api/comisiones?id=nivel-1', { valor: 1500, hasta: 10000 })
		);
		await waitFor(() =>
			expect(screen.getByText(/Nivel 1 actualizado a \$ ?1\.500/)).toBeInTheDocument()
		);
	});

	test('avisa que los cambios aplican desde mañana (Fase 18)', async () => {
		await renderizar();

		// Cada día queda congelado con su escalera; el cambio aplica desde
		// mañana (el aviso aparece en el banner y en los textos de apoyo).
		expect(screen.getAllByText(/desde mañana/).length).toBeGreaterThan(0);
		expect(screen.getAllByText(/días anteriores/).length).toBeGreaterThan(0);
	});

	test('normaliza valores negativos antes de guardar y llama a la API con el valor positivo', async () => {
		const user = userEvent.setup();
		await renderizar();

		// normalizarMontoCampo strips all non-digits: -500 → '500'.
		setInput(screen.getByLabelText('Comisión del nivel 1'), '-500');
		await user.click(screen.getAllByRole('button', { name: 'Guardar' })[0]);

		// La validación no bloquea porque el normalizador elimina el signo menos.
		await waitFor(() =>
			expect(putMock).toHaveBeenCalledWith('/api/comisiones?id=nivel-1', { valor: 500, hasta: 10000 })
		);
	});

	test('agrega un nivel (POST) y muestra el mensaje con el paso configurado', async () => {
		const user = userEvent.setup();
		await renderizar();

		await user.click(screen.getByRole('button', { name: 'Agregar nivel' }));

		await waitFor(() => expect(postMock).toHaveBeenCalledWith('/api/comisiones', {}));
		await waitFor(() =>
			expect(screen.getByText(/Nivel agregado: continúa la escalera de \$ ?10\.000/)).toBeInTheDocument()
		);
	});

	test('elimina un nivel solo si se confirma (window.confirm)', async () => {
		const user = userEvent.setup();
		await renderizar();
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

		await user.click(screen.getAllByRole('button', { name: 'Eliminar' })[0]);
		await waitFor(() => expect(delMock).toHaveBeenCalledWith('/api/comisiones?id=nivel-1'));
		await waitFor(() => expect(screen.getByText('Nivel 1 eliminado.')).toBeInTheDocument());

		// Sin confirmación no se elimina.
		confirmSpy.mockReturnValue(false);
		await user.click(screen.getAllByRole('button', { name: 'Eliminar' })[0]);
		expect(delMock).toHaveBeenCalledTimes(1);
	});

	test('reacomoda la escalera con paso y cantidad nuevos (PUT /api/comisiones/config)', async () => {
		const user = userEvent.setup();
		await renderizar();
		vi.spyOn(window, 'confirm').mockReturnValue(true);

		setInput(screen.getByLabelText('Paso entre niveles'), '20000');
		setInput(screen.getByLabelText('Cantidad de niveles'), '5');
		await user.click(screen.getByRole('button', { name: 'Reacomodar escalera' }));

		await waitFor(() =>
			expect(putMock).toHaveBeenCalledWith('/api/comisiones/config', { paso: 20000, niveles: 5 })
		);
		await waitFor(() =>
			expect(screen.getByText(/Escalera reacomodada: 5 niveles de \$ ?20\.000/)).toBeInTheDocument()
		);
	});

	test('valida la reconfiguración: paso inválido bloquea sin llamar a la API', async () => {
		const user = userEvent.setup();
		await renderizar();
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

		setInput(screen.getByLabelText('Paso entre niveles'), '0');
		await user.click(screen.getByRole('button', { name: 'Reacomodar escalera' }));

		expect(screen.getByText('El paso entre niveles debe ser mayor que cero.')).toBeInTheDocument();
		expect(confirmSpy).not.toHaveBeenCalled();
		expect(putMock).not.toHaveBeenCalled();
	});

	test('valida el tope del nivel antes de guardar y no llama a la API', async () => {
		const user = userEvent.setup();
		await renderizar();

		setInput(screen.getByLabelText('Tope del nivel 1'), '0');
		await user.click(screen.getAllByRole('button', { name: 'Guardar' })[0]);

		expect(screen.getByText('El tope del nivel 1 debe ser mayor que cero.')).toBeInTheDocument();
		expect(putMock).not.toHaveBeenCalled();
	});

	test('valida la cantidad de niveles al reacomodar (debe haber al menos uno)', async () => {
		const user = userEvent.setup();
		await renderizar();
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

		setInput(screen.getByLabelText('Cantidad de niveles'), '0');
		await user.click(screen.getByRole('button', { name: 'Reacomodar escalera' }));

		expect(screen.getByText('Debe haber al menos un nivel.')).toBeInTheDocument();
		expect(confirmSpy).not.toHaveBeenCalled();
		expect(putMock).not.toHaveBeenCalled();
	});

	test('sin niveles muestra el estado vacío', async () => {
		getMock.mockResolvedValue({ data: [], meta: { config: CONFIG }, error: null });
		render(Pagina);

		await waitFor(() =>
			expect(screen.getByText('Aún no hay niveles. Agrega el primero con «Agregar nivel».')).toBeInTheDocument()
		);
		expect(screen.getByText(/0 niveles · cada uno abarca/)).toBeInTheDocument();
	});

	test('muestra el error de carga cuando la API falla', async () => {
		getMock.mockResolvedValue({ data: null, error: 'sin conexión' });
		render(Pagina);

		await waitFor(() =>
			expect(screen.getByText(/No se pudieron cargar las comisiones: sin conexión/)).toBeInTheDocument()
		);
	});
});

describe('Validación de rangos de la escalera (sin solapamientos ni huecos)', () => {
	async function renderizar20() {
		getMock.mockResolvedValue({ data: escalera(), meta: { config: CONFIG_20 }, error: null });
		await renderizar();
	}

	test('con 20 niveles los rangos se muestran contiguos: sin huecos ni solapamientos', async () => {
		await renderizar20();

		expect(screen.getByText(/20 niveles · cada uno abarca \$ ?10\.000/)).toBeInTheDocument();
		// Nivel 1 abarca desde 1 peso.
		expect(screen.getByText('Hasta $ 10.000')).toBeInTheDocument();
		// Nivel 2 continúa exactamente en 10.001 (sin hueco entre rangos)…
		expect(screen.getByText(/De \$ ?10\.001 a \$ ?20\.000/)).toBeInTheDocument();
		// …un nivel intermedio…
		expect(screen.getByText(/De \$ ?90\.001 a \$ ?100\.000/)).toBeInTheDocument();
		// …y el último cierra en 200.000, contiguo al anterior y sin tope superior.
		expect(screen.getByText(/De \$ ?190\.001 a \$ ?200\.000/)).toBeInTheDocument();
		expect(screen.getAllByRole('button', { name: 'Guardar' })).toHaveLength(20);
	});

	test('rechaza un tope que solapa el nivel anterior y no llama a la API', async () => {
		const user = userEvent.setup();
		await renderizar20();

		setInput(screen.getByLabelText('Tope del nivel 2'), '10000');
		await user.click(screen.getAllByRole('button', { name: 'Guardar' })[1]);

		expect(
			screen.getByText('El tope del nivel 2 debe ser mayor que 10000 (tope del nivel 1).')
		).toBeInTheDocument();
		expect(putMock).not.toHaveBeenCalled();
	});

	test('rechaza un tope que invade el rango del siguiente nivel (hueco) y no llama a la API', async () => {
		const user = userEvent.setup();
		await renderizar20();

		setInput(screen.getByLabelText('Tope del nivel 1'), '20000');
		await user.click(screen.getAllByRole('button', { name: 'Guardar' })[0]);

		expect(
			screen.getByText('El tope del nivel 1 debe ser menor que 20000 (tope del nivel 2).')
		).toBeInTheDocument();
		expect(putMock).not.toHaveBeenCalled();
	});

	test('acepta un tope estrictamente entre vecinos y lo envía al servidor', async () => {
		const user = userEvent.setup();
		await renderizar20();

		setInput(screen.getByLabelText('Tope del nivel 2'), '15000');
		await user.click(screen.getAllByRole('button', { name: 'Guardar' })[1]);

		await waitFor(() =>
			expect(putMock).toHaveBeenCalledWith('/api/comisiones?id=nivel-2', { valor: 1300, hasta: 15000 })
		);
		await waitFor(() =>
			expect(screen.getByText(/Nivel 2 actualizado a \$ ?1\.300/)).toBeInTheDocument()
		);
	});

	test('el último nivel admite cualquier tope mayor que el anterior', async () => {
		const user = userEvent.setup();
		await renderizar20();

		setInput(screen.getByLabelText('Tope del nivel 20'), '400000');
		await user.click(screen.getAllByRole('button', { name: 'Guardar' })[19]);

		await waitFor(() =>
			expect(putMock).toHaveBeenCalledWith('/api/comisiones?id=nivel-20', { valor: 1300, hasta: 400000 })
		);
	});
});
