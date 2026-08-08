/**
 * Parte 5 — Flujo de CONFIGURACIÓN del catálogo.
 *
 * El admin crea un sector (zona) → un barrio → una tarifa nueva y el cliente
 * verifica que el cálculo automático usa esa tarifa (en /calculadora).
 *
 * Corre solo en desktop (la matriz de tarifas es una tabla ancha).
 */
import { test, expect } from '@playwright/test';	import { clienteService, elegirBarrio, estadoE2E, loginUI, sufijoUnico } from './helpers';

const estado = estadoE2E();
test.skip(!estado, 'Sin credenciales Supabase — suite omitida (corre bun run test:e2e).');	test('admin crea zona, barrio y tarifa; el cliente calcula con ella', { tag: '@desktop' }, async ({ page }) => {
	const e = estado!;
	// Sufijo único por invocación: la matriz comparte el prefijo E2E entre
	// proyectos (chromium-desktop y webkit-desktop corren este spec @desktop),
	// y el panel crea la zona con insert SIMPLE — sin sufijo, el segundo
	// proyecto en correr falla por duplicado y el mensaje de éxito no aparece.
	const sufijo = sufijoUnico();
	const zonaId = `e2e_${e.prefijo}_nueva_${sufijo}`;
	const nombreZona = `Zona E2E Nueva ${e.prefijo} ${sufijo}`;
	const nombreBarrio = `Barrio E2E Nuevo ${e.prefijo} ${sufijo}`;

	await loginUI(page, e.usuarios.admin.email, e.password, '/admin');

	// ---- 1. Crear la zona (sector) en /admin/zonas.
	await page.goto('/admin/zonas');
	await page.getByRole('button', { name: 'Nueva zona' }).click();
	await page.locator('#zona-id').fill(zonaId);
	await page.locator('#zona-nombre').fill(nombreZona);
	await page.locator('#zona-tipo').selectOption('urbana');
	await page.getByRole('button', { name: 'Crear zona' }).click();
	await expect(page.getByText('Zona creada correctamente.')).toBeVisible({ timeout: 15_000 });

	// ---- 2. Crear el barrio en esa zona (/admin/barrios).
	await page.goto('/admin/barrios');
	await page.locator('#nuevo-nombre').fill(nombreBarrio);
	await page.locator('#nuevo-zona').selectOption({ label: nombreZona });
	await page.getByRole('button', { name: '+ Agregar' }).click();
	await expect(page.getByText(`Barrio «${nombreBarrio}» agregado.`)).toBeVisible({ timeout: 15_000 });

	// ---- 3. Definir la tarifa A → Nueva = 4500 en la matriz (/admin/tarifas).
	await page.goto('/admin/tarifas');
	const celda = page.getByLabel(`Zona E2E A ${e.prefijo} a ${nombreZona}`);
	await celda.fill('4500');
	await celda.press('Enter');
	// El guardado es asíncrono; se verifica contra la BD real (autoridad final).
	await expect
		.poll(async () => {
			const { data } = await clienteService()
				.from('tarifas')
				.select('valor')
				.match({ zona_origen_id: e.catalogo.zonaA, zona_destino_id: zonaId })
				.maybeSingle();
			return data?.valor ?? null;
		}, { timeout: 15_000 })
		.toBe(4500);

	// ---- 4. El cliente calcula Barrio A → Barrio Nuevo y ve la tarifa nueva.
	await page.goto('/calculadora');
	await elegirBarrio(page, 'origen', `Barrio E2E A ${e.prefijo}`);
	await elegirBarrio(page, 'destino', nombreBarrio);
	await expect(page.getByText(/4\.500/)).toBeVisible({ timeout: 15_000 });
});
