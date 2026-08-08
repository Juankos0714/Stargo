/**
 * Parte 5 — Flujo de CANCELACIÓN.
 *
 * a) El cliente cancela un pedido en "Pendiente" (vía consultar-estado) con
 *    motivo, y ve el estado final "Cancelado" + motivo en el historial.
 * b) El admin cancela un pedido en estado ACTIVO (asignado) desde el panel
 *    de pedidos, con motivo, y ve el estado final en la pestaña Cancelados.
 */
import { test, expect } from '@playwright/test';
import {
	asignarPedidoAPI,
	crearPedidoAPI,
	crearPedidoUI,
	estadoE2E,
	loginUI
} from './helpers';

const estado = estadoE2E();
test.skip(!estado, 'Sin credenciales Supabase — suite omitida (corre bun run test:e2e).');

test('cliente cancela su pedido pendiente con motivo', async ({ page }) => {
	const e = estado!;
	const codigo = await crearPedidoUI(page, e);

	await page.locator('a[href^="/consultar-estado?numero="]').click();
	await expect(page.getByTestId('estado-pedido')).toHaveText('Pendiente', { timeout: 15_000 });

	// Cancelar con motivo.
	await page.getByRole('button', { name: 'Cancelar pedido' }).click();
	await page.locator('select').selectOption('Ya no necesito el servicio');
	await page.getByRole('button', { name: 'Confirmar cancelación' }).click();

	// Estado final + motivo + historial registrado.
	await expect(page.getByTestId('estado-pedido')).toHaveText('Cancelado', { timeout: 15_000 });
	await expect(page.getByText(/Motivo de cancelación: Ya no necesito el servicio/)).toBeVisible();
});

test('admin cancela un pedido en estado activo con motivo', async ({ page }) => {
	const e = estado!;

	// Pedido creado y asignado (estado activo "Asignado").
	const codigo = await crearPedidoAPI(e);
	await asignarPedidoAPI(codigo, e.usuarios.domiciliario.domiciliarioId, e);

	await loginUI(page, e.usuarios.admin.email, e.password, '/admin');
	await page.goto('/admin/pedidos');

	// La pestaña default es Pendientes; pasamos a Asignados para verlo.
	await page.getByRole('button', { name: /Asignados/ }).click();
	const fila = page.locator('tr', { hasText: codigo });
	await expect(fila).toBeVisible({ timeout: 15_000 });
	await expect(fila.locator('span.rounded-full', { hasText: 'Asignado' })).toBeVisible();

	// Cancelar con motivo (modal).
	await fila.getByRole('button', { name: 'Cancelar' }).click();
	await page.locator('#motivo-cancel').selectOption('El cliente ya no necesita el servicio');
	await page.getByRole('button', { name: 'Confirmar cancelación' }).click();
	await expect(page.getByText(`Pedido ${codigo} cancelado.`)).toBeVisible({ timeout: 15_000 });

	// Aparece en la pestaña Cancelados con el badge y el motivo en el historial.
	await page.getByRole('button', { name: /Cancelados/ }).click();
	const filaCancelada = page.locator('tr', { hasText: codigo });
	await expect(filaCancelada).toBeVisible({ timeout: 15_000 });
	await expect(filaCancelada.locator('span.rounded-full', { hasText: 'Cancelado' })).toBeVisible();
	// El historial (details) registra la transición a Cancelado con el motivo.
	// Nota: se usa locator('li', { hasText }) y no getByText(regex): en el li el
	// «Cancelado» vive en un <span> hijo y el resto en text nodes directos, así
	// que el texto combinado nunca es «own text» de un solo elemento para
	// getByText. Y se matchea por STRING (no regex): Playwright normaliza los
	// espacios del string pero no los del regex, y el DOM tiene un espacio
	// extra entre el span «Cancelado» y el «·» (p. ej. «Cancelado  · El»).
	await filaCancelada.locator('summary').click();
	await expect(
		filaCancelada.locator('li', { hasText: 'El cliente ya no necesita el servicio' })
	).toBeVisible();
});
