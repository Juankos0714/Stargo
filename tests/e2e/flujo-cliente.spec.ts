/**
 * Parte 5 — Flujo del CLIENTE.
 *
 * La app no tiene registro público de clientes: el administrador crea las
 * cuentas (el globalSetup siembra la de prueba) y el cliente usa la app de
 * forma anónima: crea el pedido sin sesión y lo sigue por su código.
 *
 * Cubre: crear pedido → ver tarifa calculada → confirmar → ver el estado
 * inicial en consultar-estado. El seguimiento en TIEMPO REAL hasta
 * "Entregado" se cubre en realtime.spec.ts (tres sesiones simultáneas).
 */
import { test, expect } from '@playwright/test';
import { crearPedidoUI, estadoE2E } from './helpers';

const estado = estadoE2E();
test.skip(!estado, 'Sin credenciales Supabase — suite omitida (corre bun run test:e2e).');

test('cliente crea un pedido, ve la tarifa calculada y lo confirma', async ({ page }) => {
	const e = estado!;

	const codigo = await crearPedidoUI(page, e);

	// El pedido se confirmó y el código quedó visible.
	await expect(page.getByTestId('codigo-pedido')).toHaveText(codigo);
	// El desglose muestra la tarifa base (6000) y el total.
	await expect(page.getByText(/6\.000/).first()).toBeVisible();

	// Consultar estado: el pedido nace en "Pendiente". El link del CTA lleva el
	// ?numero= (el del nav del header no), por eso se apunta por href.
	await page.locator('a[href^="/consultar-estado?numero="]').click();
	await expect(page.getByTestId('estado-pedido')).toHaveText('Pendiente', { timeout: 15_000 });
});

test('cliente puede repetir el flujo con un recargo opcional', async ({ page }) => {
	const e = estado!;

	const codigo = await crearPedidoUI(page, e, { recargo: true });

	await expect(page.getByTestId('codigo-pedido')).toHaveText(codigo);
	// Tarifa 6000 + recargo 2000 = 8000 (aparece en el desglose).
	await expect(page.getByText(/8\.000/).first()).toBeVisible();
});
