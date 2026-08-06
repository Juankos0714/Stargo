/**
 * Parte 5 — Flujo de ERROR.
 *
 * El cliente intenta pedir entre barrios SIN tarifa configurada (ambos en la
 * misma zona A, y la matriz solo define A→B): debe ver un mensaje claro y el
 * botón de confirmar deshabilitado — nunca un crash ni un "loading" infinito.
 */
import { test, expect } from '@playwright/test';
import { elegirBarrio, estadoE2E } from './helpers';

const estado = estadoE2E();
test.skip(!estado, 'Sin credenciales Supabase — suite omitida (corre bun run test:e2e).');

test('cliente ve un mensaje claro si la ruta no tiene tarifa', async ({ page }) => {
	const e = estado!;

	await page.goto('/nuevo-pedido');
	await page.getByText('Hacer un pedido').waitFor({ timeout: 15_000 });

	// Barrio A y Barrio Sin Tarifa están en la misma zona A: no hay tarifa A→A.
	await elegirBarrio(page, 'ped-origen', `Barrio E2E A ${e.prefijo}`);
	await elegirBarrio(page, 'ped-destino', `Barrio E2E Sin Tarifa ${e.prefijo}`);

	// Mensaje claro, sin crash.
	await expect(
		page.getByText(/No disponible: este trayecto no tiene tarifa o pasa por una zona sin servicio/)
	).toBeVisible({ timeout: 15_000 });

	// El botón queda deshabilitado y no se puede confirmar.
	await expect(page.getByRole('button', { name: 'Confirmar pedido' })).toBeDisabled();
});
