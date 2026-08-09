import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import CentroNotificaciones from '../../src/lib/components/CentroNotificaciones.svelte';
import { api } from '$lib/api';
import { pushSoportado, suscribirPush, estaSuscrito } from '$lib/push';

// El componente usa Realtime, hidratación de sesión, Web Push y navegación:
// todo se controla con mocks (mismo patrón que el resto de tests de UI).
vi.mock('$lib/api', () => ({
	api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }
}));
vi.mock('$lib/realtime', () => ({
	suscribirCambios: () => () => {}
}));
vi.mock('$lib/supabase-browser', () => ({
	hidratarSesionRealtime: vi.fn(async () => true)
}));
vi.mock('$lib/push', () => ({
	pushSoportado: vi.fn(),
	suscribirPush: vi.fn(),
	estaSuscrito: vi.fn()
}));
vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

const getMock = vi.mocked(api.get);
const pushSoportadoMock = vi.mocked(pushSoportado);
const suscribirPushMock = vi.mocked(suscribirPush);
const estaSuscritoMock = vi.mocked(estaSuscrito);

beforeEach(() => {
	vi.clearAllMocks();
	getMock.mockResolvedValue({ data: [], error: null });
	// Por defecto: push soportado, sin suscripción previa, y activación con éxito.
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
