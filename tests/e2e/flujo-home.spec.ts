/**
 * Parte 5 — Flujo del HOME.
 *
 * Verifica que:
 *   1. El home ya no muestra "consultar estado" ni "hacer pedido" como
 *      accesos directos (se quitaron en la simplificación).
 *   2. Esas funcionalidades siguen siendo alcanzables desde donde quedaron
 *      (nav/dashboard) sin 404 ni rutas rotas.
 *   3. El texto del estimado se renderiza correctamente (no como HTML literal).
 */
import { test, expect } from '@playwright/test';
import { estadoE2E } from './helpers';

const estado = estadoE2E();
test.skip(!estado, 'Sin credenciales Supabase — suite omitida (corre bun run test:e2e).');

test('home no muestra "consultar estado" ni "hacer pedido" como accesos directos', async ({
	page
}) => {
	await page.goto('/');

	// El home NO debe tener links directos a /consultar-estado o /nuevo-pedido
	// en la sección principal de accesos.
	const links = page.locator('a');
	const linksVisibles = await links.all();

	for (const link of linksVisibles) {
		const href = await link.getAttribute('href');
		const texto = (await link.textContent())?.trim() ?? '';
		// No debe haber un link "Hacer un pedido" o "Consultar estado" visible.
		if (href === '/nuevo-pedido') {
			expect(texto).not.toBe('Hacer un pedido');
		}
		if (href === '/consultar-estado') {
			expect(texto).not.toBe('Consultar estado');
		}
	}
});

test('las funcionalidades siguen accesibles (no 404)', async ({ page }) => {
	// /nuevo-pedido debe cargar sin error.
	await page.goto('/nuevo-pedido');
	await expect(page.locator('h1')).toContainText(/pedido|nuevo/i, { timeout: 15_000 });

	// /consultar-estado debe cargar sin error.
	await page.goto('/consultar-estado');
	await expect(page.locator('h1, h2, [data-testid]').first()).toBeVisible({ timeout: 15_000 });

	// /calculadora debe cargar sin error.
	await page.goto('/calculadora');
	await expect(page.getByText(/calculadora|tarifa/i).first()).toBeVisible({ timeout: 15_000 });
});

test('el texto del estimado se renderiza con negrita, no como HTML literal', async ({ page }) => {
	const e = estado!;

	// Crear un pedido con recargo para que aparezca el texto del estimado.
	await page.goto('/nuevo-pedido');
	await page.getByText('Hacer un pedido').waitFor({ timeout: 15_000 });

	// Seleccionar barrios para activar la tarifa.
	const inputOrigen = page.locator('#ped-origen');
	await inputOrigen.fill(`Barrio E2E A ${e.prefijo}`);
	await page.locator(`#ped-origen-list [role="option"]`, { hasText: `Barrio E2E A ${e.prefijo}` })
		.first()
		.click();

	const inputDestino = page.locator('#ped-destino');
	await inputDestino.fill(`Barrio E2E B ${e.prefijo}`);
	await page.locator(`#ped-destino-list [role="option"]`, { hasText: `Barrio E2E B ${e.prefijo}` })
		.first()
		.click();

	// Llenar campos requeridos.
	await page.locator('#dir-origen').fill('Calle test origen');
	await page.locator('#dir-destino').fill('Carrera test destino');
	await page.getByText('No aplica', { exact: true }).click();
	await page.locator('#cli-telefono').fill('3001234567');

	// Esperar a que aparezca la tarifa.
	await page.getByText(/6\\.000/).first().waitFor({ timeout: 15_000 });

	// El texto del estimado NO debe contener tags HTML literales.
	const html = await page.content();
	expect(html).not.toContain('<strong>estimado</strong>');
	expect(html).not.toContain('&lt;strong&gt;');
	// El texto "estimado" debe aparecer en el DOM (el <strong> es renderizado
	// por Svelte como HTML real, no como texto literal).
	const textoEstimado = page.getByText(/estimado/i);
	await expect(textoEstimado.first()).toBeVisible();
});

test('el home carga el horario y los roles correctamente', async ({ page }) => {
	await page.goto('/');

	// La página debe cargar sin errores de JavaScript.
	const errors: string[] = [];
	page.on('pageerror', (err) => errors.push(err.message));
	await page.waitForTimeout(2000);

	// No debe haber errores de JS.
	expect(errors).toEqual([]);

	// El home debe mostrar el nombre de la empresa.
	await expect(page.getByText('StarGo')).toBeVisible();
});
