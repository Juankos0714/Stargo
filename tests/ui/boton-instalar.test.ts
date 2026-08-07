import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import BotonInstalar from '../../src/lib/components/BotonInstalar.svelte';
import { resetearEstadoInstalacion } from '../../src/lib/pwa';

/**
 * BotonInstalar se apoya en $lib/pwa.ts, que captura `beforeinstallprompt` a
 * nivel de módulo (window) y mantiene estado global entre tests.
 * `resetearEstadoInstalacion()` limpia ese estado en cada test.
 *
 * NOTA: no usar vi.resetModules() aquí: al recargar el módulo se duplica el
 * runtime interno de Svelte y los $effect del componente fallan
 * (effect_orphan).
 */
beforeEach(() => {
	resetearEstadoInstalacion();
});

afterEach(() => {
	vi.useRealTimers();
});

/** jsdom no implementa matchMedia: se simula por consulta para controlar modo standalone y móvil. */
function simularMatchMedia(queries: Record<string, boolean>) {
	window.matchMedia = vi.fn((query: string) => ({
		matches: queries[query] ?? false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn()
	})) as unknown as typeof window.matchMedia;
}

/** Desktop por defecto (no móvil, no standalone). */
function escritorio() {
	simularMatchMedia({
		'(display-mode: standalone)': false,
		'(pointer: coarse)': false
	});
}

/** Móvil táctil (pero sin modo standalone). */
function movil() {
	simularMatchMedia({
		'(display-mode: standalone)': false,
		'(pointer: coarse)': true
	});
}

/** Crea un evento beforeinstallprompt con prompt()/userChoice simulados. */
function eventoInstalacion() {
	const evt = new Event('beforeinstallprompt');
	const prompt = vi.fn().mockResolvedValue(undefined);
	Object.defineProperty(evt, 'prompt', { value: prompt });
	Object.defineProperty(evt, 'userChoice', {
		value: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' })
	});
	return { evt, prompt };
}

const botonInstalar = () => screen.getByRole('button', { name: /instalar app/i });

describe('BotonInstalar — instalación PWA', () => {
	test('no se muestra si la app ya está instalada (standalone)', async () => {
		simularMatchMedia({ '(display-mode: standalone)': true, '(pointer: coarse)': false });
		const { container } = render(BotonInstalar);
		// La detección de standalone ocurre en un $effect: tras montar, se marca
		// como instalada y nunca aparece el botón.
		await act(async () => {});
		expect(container.textContent).not.toContain('Instalar app');
	});

	test('no se muestra sin beforeinstallprompt, sin iOS y en escritorio', () => {
		escritorio();
		const { container } = render(BotonInstalar);
		expect(container.textContent).not.toContain('Instalar app');
	});

	test('captura beforeinstallprompt aunque llegue antes de montar el componente', async () => {
		// Regresión del bug principal: en móvil el evento puede dispararse
		// antes de que la app hidrate. Al capturarlo a nivel de módulo, el
		// botón aparece igualmente.
		escritorio();
		window.dispatchEvent(new Event('beforeinstallprompt'));
		render(BotonInstalar);
		await vi.waitFor(() => expect(botonInstalar()).toBeInTheDocument());
	});

	test('aparece el botón al llegar beforeinstallprompt tras montar', async () => {
		escritorio();
		render(BotonInstalar);
		expect(screen.queryByRole('button', { name: /instalar app/i })).not.toBeInTheDocument();
		window.dispatchEvent(new Event('beforeinstallprompt'));
		await vi.waitFor(() => expect(botonInstalar()).toBeInTheDocument());
	});

	test('el clic llama prompt() del evento guardado y oculta el botón', async () => {
		escritorio();
		const user = userEvent.setup();
		render(BotonInstalar);
		const { evt, prompt } = eventoInstalacion();
		window.dispatchEvent(evt);
		await vi.waitFor(() => expect(botonInstalar()).toBeInTheDocument());
		await user.click(botonInstalar());
		expect(prompt).toHaveBeenCalledOnce();
		await vi.waitFor(() =>
			expect(screen.queryByRole('button', { name: /instalar app/i })).not.toBeInTheDocument()
		);
	});

	test('appinstalled oculta el botón', async () => {
		escritorio();
		render(BotonInstalar);
		window.dispatchEvent(new Event('beforeinstallprompt'));
		await vi.waitFor(() => expect(botonInstalar()).toBeInTheDocument());
		window.dispatchEvent(new Event('appinstalled'));
		await vi.waitFor(() =>
			expect(screen.queryByRole('button', { name: /instalar app/i })).not.toBeInTheDocument()
		);
	});

	test('en iOS sin el evento se abre la guía de instalación', async () => {
		escritorio();
		const user = userEvent.setup();
		const uaOriginal = navigator.userAgent;
		Object.defineProperty(navigator, 'userAgent', {
			value:
				'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
			configurable: true
		});
		try {
			render(BotonInstalar);
			// La detección de iOS ocurre en un $effect (solo cliente), así que el
			// botón aparece justo después de montar.
			await vi.waitFor(() => expect(botonInstalar()).toBeInTheDocument());
			await user.click(botonInstalar());
			await act(async () => {});
			expect(screen.getByRole('dialog')).toBeInTheDocument();
			expect(screen.getByText(/compartir/i)).toBeInTheDocument();
			expect(screen.getByText(/añadir a pantalla de inicio/i)).toBeInTheDocument();
		} finally {
			Object.defineProperty(navigator, 'userAgent', { value: uaOriginal, configurable: true });
		}
	});

	test('en móvil sin beforeinstallprompt (Firefox/Samsung) se ofrece la guía como respaldo', async () => {
		vi.useFakeTimers();
		movil();
		render(BotonInstalar);
		// Los $effect de detección corren al montar; luego avanza el timer.
		await act(async () => {});
		expect(screen.queryByRole('button', { name: /instalar app/i })).not.toBeInTheDocument();

		vi.advanceTimersByTime(2500);
		await act(async () => {});
		const boton = botonInstalar();

		fireEvent.click(boton);
		await act(async () => {});
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(screen.getByText(/tres puntos/i)).toBeInTheDocument();
		expect(screen.getByText(/añadir a pantalla de inicio/i)).toBeInTheDocument();
	});

	test('el respaldo móvil no aparece si llega beforeinstallprompt', async () => {
		vi.useFakeTimers();
		movil();
		render(BotonInstalar);
		await act(async () => {});
		window.dispatchEvent(new Event('beforeinstallprompt'));
		await act(async () => {});
		vi.advanceTimersByTime(2500);
		await act(async () => {});
		// El botón nativo sigue mostrándose (evento presente) y el respaldo no
		// añade una guía extra.
		expect(botonInstalar()).toBeInTheDocument();
	});

	// NOTA: no se añade aquí un test de render SSR (svelte/server) porque los
	// componentes compilados en modo cliente no son renderizables por el runtime
	// de servidor en este config (effect_orphan). La regresión del 500 queda
	// cubierta por los tests e2e, que cargan páginas bajo el layout compartido
	// contra un servidor real.
});
