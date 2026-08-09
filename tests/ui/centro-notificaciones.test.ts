import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import CentroNotificaciones from '../../src/lib/components/CentroNotificaciones.svelte';
import { api } from '$lib/api';
import { esIOS, pushSoportado, suscribirPush, estaSuscrito } from '$lib/push';
import { sonarNotificacion } from '$lib/sonido';

// El componente usa Realtime, hidratación de sesión, Web Push, sonido y
// navegación: todo se controla con mocks (mismo patrón que el resto de tests
// de UI). El callback de Realtime se captura para simular INSERT/UPDATE.
const realtime = vi.hoisted(() => ({
	onCambio: undefined as ((payload: unknown) => void) | undefined
}));

vi.mock('$lib/api', () => ({
	api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }
}));
vi.mock('$lib/realtime', () => ({
	suscribirCambios: (opts: { onCambio: (payload: unknown) => void }) => {
		realtime.onCambio = opts.onCambio;
		return () => {};
	}
}));
vi.mock('$lib/supabase-browser', () => ({
	hidratarSesionRealtime: vi.fn(async () => true)
}));
vi.mock('$lib/push', () => ({
	esIOS: vi.fn(),
	pushSoportado: vi.fn(),
	suscribirPush: vi.fn(),
	estaSuscrito: vi.fn()
}));
vi.mock('$lib/sonido', () => ({
	sonarNotificacion: vi.fn()
}));
vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

const getMock = vi.mocked(api.get);
const esIOSMock = vi.mocked(esIOS);
const pushSoportadoMock = vi.mocked(pushSoportado);
const suscribirPushMock = vi.mocked(suscribirPush);
const estaSuscritoMock = vi.mocked(estaSuscrito);
const sonarMock = vi.mocked(sonarNotificacion);

/** Stub de matchMedia: jsdom no lo implementa. Por defecto simula desktop. */
function stubMatchMedia(esDesktop: boolean) {
	const matcher = (q: string) => ({ matches: q === '(min-width: 768px)' ? esDesktop : false });
	vi.stubGlobal('matchMedia', matcher);
	window.matchMedia = matcher as unknown as typeof window.matchMedia;
}

beforeEach(() => {
	vi.clearAllMocks();
	stubMatchMedia(true); // desktop por defecto
	realtime.onCambio = undefined;
	getMock.mockResolvedValue({ data: [], error: null });
	// Por defecto: no es iOS, push soportado, sin suscripción previa, y
	// activación con éxito.
	esIOSMock.mockReturnValue(false);
	pushSoportadoMock.mockReturnValue(true);
	suscribirPushMock.mockResolvedValue({ ok: true });
	estaSuscritoMock.mockResolvedValue(null);
});

/** Monta el componente y abre el panel de notificaciones (clic en la campana). */
async function abrirPanel() {
	render(CentroNotificaciones, { urlBase: '/admin/pedidos', tono: 'oscuro' });
	const user = userEvent.setup();
	await user.click(screen.getByRole('button', { name: 'Notificaciones' }));
	return user;
}

describe('CentroNotificaciones — estados de activación de Web Push', () => {
	test('pushActivo === null (estado desconocido): muestra el botón de activar', async () => {
		// El navegador soporta push pero aún no se sabe si hay suscripción:
		// antes este caso no mostraba NADA; ahora el botón debe aparecer.
		estaSuscritoMock.mockResolvedValue(null);
		await abrirPanel();

		const boton = screen.getByRole('button', { name: 'Activar notificaciones push' });
		expect(boton).toBeInTheDocument();
		// Y la pista de qué hace el push, no un error.
		expect(
			screen.getByText('Recibe avisos de pedidos nuevos aunque la app esté cerrada.')
		).toBeInTheDocument();
		expect(screen.queryByText('Notificaciones push activadas')).not.toBeInTheDocument();
	});

	test('pushActivo === false (sin suscripción): muestra el botón de activar', async () => {
		estaSuscritoMock.mockResolvedValue(false);
		await abrirPanel();

		const boton = screen.getByRole('button', { name: 'Activar notificaciones push' });
		expect(boton).toBeInTheDocument();
		expect(screen.queryByText('Notificaciones push activadas')).not.toBeInTheDocument();
	});

	test('pushActivo === true (ya suscrito): muestra el estado activado y NO el botón', async () => {
		estaSuscritoMock.mockResolvedValue(true);
		await abrirPanel();

		// El estado llega de forma asíncrona (estaSuscrito en el $effect).
		const activado = await screen.findByText('Notificaciones push activadas');
		expect(activado).toBeInTheDocument();
		expect(screen.getByText('Recibirás avisos de pedidos aunque la app esté cerrada.')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Activar notificaciones push' })).not.toBeInTheDocument();
	});

	test('push no soportado: la sección de activación no se renderiza', async () => {
		pushSoportadoMock.mockReturnValue(false);
		await abrirPanel();

		expect(screen.queryByRole('button', { name: 'Activar notificaciones push' })).not.toBeInTheDocument();
		expect(screen.queryByText('Notificaciones push activadas')).not.toBeInTheDocument();
		// El panel de notificaciones (lista) sí sigue visible.
		expect(screen.getByText('Notificaciones')).toBeInTheDocument();
	});

	test('en iPhone sin la app instalada (push no soportado pero iOS): muestra el aviso de instalar', async () => {
		// iOS 16.4+: el push solo existe en la PWA instalada; en Safari normal
		// no hay botón de activar, pero el usuario debe saber por qué.
		esIOSMock.mockReturnValue(true);
		pushSoportadoMock.mockReturnValue(false);
		await abrirPanel();

		expect(screen.getByText('Notificaciones solo en la app instalada')).toBeInTheDocument();
		expect(screen.getByText(/Agregar a pantalla de inicio/)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Activar notificaciones push' })).not.toBeInTheDocument();
	});
});	describe('CentroNotificaciones — sonido al llegar una notificación nueva', () => {
	test('un INSERT reproduce el sonido y dispara una recarga de la lista', async () => {
		await abrirPanel();

		// El $effect registró el callback de Realtime al montar.
		expect(realtime.onCambio).toBeTypeOf('function');

		// Llamadas a /api/notificaciones al montar y al abrir el panel:
		// el INSERT debe AUMENTAR el conteo (recarga), no solo existir.
		const llamadasAntes = getMock.mock.calls.filter(([p]) => p === '/api/notificaciones').length;
		realtime.onCambio?.({ eventType: 'INSERT', new: { id: 1 } });
		await waitFor(() =>
			expect(getMock.mock.calls.filter(([p]) => p === '/api/notificaciones').length).toBeGreaterThan(
				llamadasAntes
			)
		);
		expect(sonarMock).toHaveBeenCalledTimes(1);
	});

	test('un UPDATE (marcar leída) NO reproduce sonido', async () => {
		await abrirPanel();

		realtime.onCambio?.({ eventType: 'UPDATE', new: { id: 1, leida: true } });

		expect(sonarMock).not.toHaveBeenCalled();
	});

	test('eventos sin tipo no reproducen sonido', async () => {
		await abrirPanel();

		realtime.onCambio?.({ old: { id: 1 } });
		realtime.onCambio?.(null);

		expect(sonarMock).not.toHaveBeenCalled();
	});

	test('la instancia del breakpoint no visible NO suena (evita doble sonido)', async () => {
		// En desktop, la instancia móvil (topbar) debe callar.
		stubMatchMedia(true); // desktop
		const { unmount } = render(CentroNotificaciones, {
			urlBase: '/admin/pedidos',
			soloSonarEn: 'mobile'
		});
		await waitFor(() => expect(realtime.onCambio).toBeTypeOf('function'));

		realtime.onCambio?.({ eventType: 'INSERT', new: { id: 2 } });

		expect(sonarMock).not.toHaveBeenCalled();
		unmount();
	});

	test('la instancia del breakpoint visible SÍ suena', async () => {
		// En desktop, la instancia del sidebar (desktop) suena.
		stubMatchMedia(true);
		const { unmount } = render(CentroNotificaciones, {
			urlBase: '/admin/pedidos',
			soloSonarEn: 'desktop'
		});
		await waitFor(() => expect(realtime.onCambio).toBeTypeOf('function'));

		realtime.onCambio?.({ eventType: 'INSERT', new: { id: 3 } });

		expect(sonarMock).toHaveBeenCalledTimes(1);
		unmount();
	});
});
	describe('CentroNotificaciones — flujo de activar notificaciones', () => {
	test('clic en activar con éxito: llama a suscribirPush y pasa al estado activado', async () => {
		const user = await abrirPanel();

		await user.click(screen.getByRole('button', { name: 'Activar notificaciones push' }));

		expect(suscribirPushMock).toHaveBeenCalledTimes(1);
		const activado = await screen.findByText('Notificaciones push activadas');
		expect(activado).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Activar notificaciones push' })).not.toBeInTheDocument();
	});

	test('fallo al activar: muestra el error y conserva el botón para reintentar', async () => {
		suscribirPushMock.mockResolvedValue({ ok: false, error: 'Permiso de notificaciones denegado.' });
		const user = await abrirPanel();

		await user.click(screen.getByRole('button', { name: 'Activar notificaciones push' }));

		const error = await screen.findByText('Permiso de notificaciones denegado.');
		expect(error).toBeInTheDocument();
		// El botón sigue disponible para reintentar.
		expect(screen.getByRole('button', { name: 'Activar notificaciones push' })).toBeInTheDocument();
		expect(screen.queryByText('Notificaciones push activadas')).not.toBeInTheDocument();
	});
});
