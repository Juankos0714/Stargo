/**
 * Parte 5 — Flujo del DOMICILIARIO.
 *
 * login → ver el pedido asignado → aceptar → marcar recogido → marcar en
 * camino → marcar entregado (con el confirm del navegador) → aparece en
 * "Completadas" como Entregado.
 */
import { test, expect, type Page } from '@playwright/test';
import { asignarPedidoAPI, crearPedidoAPI, estadoE2E, loginUI } from './helpers';

const estado = estadoE2E();
test.skip(!estado, 'Sin credenciales Supabase — suite omitida (corre bun run test:e2e).');

/** El botón de la acción siguiente dentro de la tarjeta del pedido. */
function botonAccion(page: Page, codigo: string, nombre: string) {
	return page.locator('div.rounded-2xl', { hasText: codigo }).getByRole('button', { name: nombre });
}

test('domiciliario avanza el pedido asignado hasta Entregado', async ({ page }) => {
	const e = estado!;

	// Un cliente creó el pedido y el admin lo asignó a este domiciliario.
	const codigo = await crearPedidoAPI(e);
	await asignarPedidoAPI(codigo, e.usuarios.domiciliario.domiciliarioId, e);

	await loginUI(page, e.usuarios.domiciliario.email, e.password, '/domiciliario');

	// Ve el pedido asignado en "En curso".
	const card = page.locator('div.rounded-2xl', { hasText: codigo });
	await expect(card).toBeVisible({ timeout: 15_000 });
	await expect(card.getByText('Asignado')).toBeVisible();

	// Aceptar → Recogido → En camino → Entregado.
	await botonAccion(page, codigo, 'Aceptar pedido').click();
	await expect(card.getByText('Aceptado')).toBeVisible({ timeout: 15_000 });

	await botonAccion(page, codigo, 'Marcar recogido').click();
	await expect(card.getByText('Recogido')).toBeVisible({ timeout: 15_000 });

	await botonAccion(page, codigo, 'Marcar en camino').click();
	await expect(card.getByText('En camino')).toBeVisible({ timeout: 15_000 });

	// El último paso pide confirmación (window.confirm).
	page.once('dialog', (d) => void d.accept());
	await botonAccion(page, codigo, 'Marcar entregado').click();

	// Pasa a la pestaña "Completadas" con estado Entregado.
	await page.getByRole('button', { name: /Completadas/ }).click();
	const fila = page.locator('div.rounded-2xl', { hasText: codigo });
	await expect(fila).toBeVisible({ timeout: 15_000 });
	await expect(fila.getByText('Entregado')).toBeVisible();
});
