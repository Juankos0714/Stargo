/**
 * Parte 5 — Flujo del ADMINISTRADOR.
 *
 * login → ver un pedido pendiente → asignarle un domiciliario → verificar que
 * pasa a la pestaña "Asignados" con el estado "Asignado".
 */
import { test, expect } from '@playwright/test';
import { crearPedidoAPI, estadoE2E, loginUI } from './helpers';

const estado = estadoE2E();
test.skip(!estado, 'Sin credenciales Supabase — suite omitida (corre bun run test:e2e).');

test('admin asigna un pedido pendiente y lo ve en Asignados', async ({ page }) => {
	const e = estado!;

	// Un cliente creó el pedido (por API, determinista).
	const codigo = await crearPedidoAPI(e);

	await loginUI(page, e.usuarios.admin.email, e.password, '/admin');
	await page.goto('/admin/pedidos');

	// Aparece en la pestaña "Pendientes" (la default) con el código visible.
	const fila = page.locator('tr', { hasText: codigo });
	await expect(fila).toBeVisible({ timeout: 15_000 });
	await expect(fila.getByText('Pendiente')).toBeVisible();

	// Asignar el domiciliario E2E.
	const nombreDom = `E2E Domiciliario ${e.prefijo}`;
	await fila.locator('select').selectOption({ label: nombreDom });
	await fila.getByRole('button', { name: 'Asignar' }).click();
	await expect(page.getByText(`Pedido ${codigo} asignado.`)).toBeVisible({ timeout: 15_000 });

	// Pestaña "Asignados": el pedido aparece con estado Asignado y su domiciliario.
	await page.getByRole('button', { name: /Asignados/ }).click();
	const filaAsignada = page.locator('tr', { hasText: codigo });
	await expect(filaAsignada).toBeVisible({ timeout: 15_000 });
	await expect(filaAsignada.getByText('Asignado')).toBeVisible();
	await expect(filaAsignada.getByText(nombreDom)).toBeVisible();
});
