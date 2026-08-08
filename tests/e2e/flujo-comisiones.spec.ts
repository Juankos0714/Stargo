/**
 * E2E — Flujo completo de COMISIONES.
 *
 * Configurar la comisión en el admin → el domiciliario entrega → ve la
 * comisión generada y su deuda → el admin registra un abono → la deuda se
 * reduce y el abono aparece en el panel del domiciliario.
 *
 * AISLAMIENTO DE CUENTA: la matriz E2E corre varios proyectos (desktop,
 * mobile) EN PARALELO con el mismo prefijo E2E. Si todos usaran el
 * domiciliario sembrado, los totales de su cuenta (comisión, deuda, abonos)
 * se mezclarían entre corridas y los asserts serían frágiles. Por eso este
 * spec registra un DOMICILIARIO DEDICADO por invocación (email único) vía la
 * API del admin, lo usa para el flujo completo y lo elimina al final.
 *
 * Usa DOS contextos de navegador (admin y domiciliario) para que cada sesión
 * tenga sus propias cookies (igual que realtime.spec.ts).
 */
import { test, expect, type Browser } from '@playwright/test';
import { clienteService } from '../rls/helpers';	import {
		asignarPedidoAPI,
		crearPedidoAPI,
		estadoE2E,
		loginEnApp,
		loginUI,
		peticion,
		sufijoUnico,
		BASE_E2E
	} from './helpers';

const estado = estadoE2E();
test.skip(!estado, 'Sin credenciales Supabase — suite omitida (corre bun run test:e2e).');

/** Contexto aislado por rol (cookies propias). */
async function sesion(browser: Browser) {
	return await browser.newContext({ baseURL: BASE_E2E });
}

test('comisiones: configurar en admin → entregar → deuda → abono', async ({ browser }) => {
	const e = estado!;
	// Email y nombre ÚNICOS por invocación: aisla la cuenta aunque desktop y
	// mobile corran el mismo spec en paralelo (comparten el prefijo E2E, así
	// que el sufijo aleatorio evita colisiones de fila y de selector).
	const sufijo = sufijoUnico();
	const emailDomi = `e2e_${e.prefijo}_comi_${sufijo}@example.com`;
	const nombreDomi = `E2E Comisiones ${e.prefijo} ${sufijo}`;

	const ctxAdmin = await sesion(browser);
	const ctxDomi = await sesion(browser);
	const adminPage = await ctxAdmin.newPage();
	const domiPage = await ctxDomi.newPage();

	// Limpieza best-effort del domiciliario dedicado (fila + usuario de Auth).
	async function limpiarDomi(domiId?: string, userId?: string) {
		if (!domiId && !userId) return;
		try {
			const s = clienteService();
			// Primero la fila y luego el usuario de Auth: si deleteUser fallara, la
			// fila ya quedaría sin referencia y el teardown global también la
			// limpia por patrón de nombre (misma red por si acaso).
			if (domiId) await s.from('domiciliarios').delete().eq('id', domiId);
			if (userId) await s.auth.admin.deleteUser(userId);
		} catch {
			// El teardown global también limpia por patrón de nombre.
		}
	}

	let domiId: string | undefined;
	let domiUserId: string | undefined;
	try {
		// ---- 1. Admin: garantiza la escalera y fija la comisión del nivel 1. ----
		// El pedido del catálogo E2E (tarifa A→B = $6.000) cae en el nivel 1, así
		// que la comisión que se congela al entregar será la del nivel 1.
		await loginUI(adminPage, e.usuarios.admin.email, e.password, '/admin');
		await adminPage.goto('/admin/comisiones');
		// Exact: true — «nivel 1» es prefijo de «nivel 10…19».
		await adminPage.getByLabel('Comisión del nivel 1', { exact: true }).waitFor({ timeout: 15_000 });

		// Escalera determinista: 20 niveles de $10.000 (idempotente aunque otra
		// corrida haya dejado la escalera reconfigurada).
		await adminPage.getByLabel('Paso entre niveles').fill('10000');
		await adminPage.getByLabel('Cantidad de niveles').fill('20');
		adminPage.once('dialog', (d) => void d.accept());
		await adminPage.getByRole('button', { name: 'Reacomodar escalera' }).click();
		// \s* y no « ?»: el formato es-CO usa un espacio fino (U+202F) que
		// Playwright no normaliza.
		await expect(
			adminPage.getByText(/Escalera reacomodada: 20 niveles de \$\s*10\.000/)
		).toBeVisible({ timeout: 15_000 });

		// Comisión del nivel 1 = $1.500 (se congelará en la entrega).
		await adminPage.getByLabel('Comisión del nivel 1', { exact: true }).fill('1500');
		await adminPage.getByRole('button', { name: 'Guardar' }).first().click();
		await expect(adminPage.getByText(/Nivel 1 actualizado a \$\s*1\.500/)).toBeVisible({
			timeout: 15_000
		});

		// ---- 2. Registra el domiciliario dedicado (API con sesión admin). ----
		const admin = await loginEnApp(e.usuarios.admin.email, e.password);
		const rReg = await peticion<{
			data?: { id: string; user_id: string; email: string };
			error?: string;
		}>('/api/domiciliarios', {
			metodo: 'POST',
			cuerpo: { op: 'registrar', nombre: nombreDomi, email: emailDomi, password: e.password },
			jar: admin.jar
		});
		if (!rReg.ok || !rReg.data?.data?.id) {
			throw new Error(`E2E: no se pudo registrar el domi dedicado: ${rReg.data?.error ?? rReg.status}`);
		}
		domiId = rReg.data.data.id;
		domiUserId = rReg.data.data.user_id;

		// ---- 3. El cliente crea el pedido y el admin lo asigna (por API). ----
		const codigo = await crearPedidoAPI(e);
		await asignarPedidoAPI(codigo, domiId, e);

		// ---- 4. El domiciliario dedicado entrega el pedido. ----
		await loginUI(domiPage, emailDomi, e.password, '/domiciliario');
		const card = domiPage.locator('div.rounded-2xl', { hasText: codigo });
		await expect(card).toBeVisible({ timeout: 15_000 });
		// .first(): el estado aparece en el BadgeEstado y también en el historial.
		await expect(card.getByText('Asignado').first()).toBeVisible();

		await card.getByRole('button', { name: 'Aceptar pedido' }).click();
		await expect(card.getByText('Aceptado').first()).toBeVisible({ timeout: 15_000 });
		await card.getByRole('button', { name: 'Marcar recogido' }).click();
		await expect(card.getByText('Recogido').first()).toBeVisible({ timeout: 15_000 });
		await card.getByRole('button', { name: 'Marcar en camino' }).click();
		await expect(card.getByText('En camino').first()).toBeVisible({ timeout: 15_000 });

		domiPage.once('dialog', (d) => void d.accept());
		await card.getByRole('button', { name: 'Marcar entregado' }).click();
		await domiPage.getByRole('button', { name: /Completadas/ }).click();
		await expect(
			domiPage.locator('div.rounded-2xl', { hasText: codigo }).getByText('Entregado').first()
		).toBeVisible({ timeout: 15_000 });

		// ---- 5. Ve la comisión generada y la deuda pendiente (cuenta dedicada: exacto). ----
		const generado = domiPage.locator('div.rounded-2xl', { hasText: 'Generado en comisiones' });
		await expect(generado.getByText(/1\.500/)).toBeVisible({ timeout: 15_000 });
		const deuda = domiPage.locator('div.rounded-2xl', { hasText: 'Deuda pendiente' });
		await expect(deuda.getByText(/1\.500/)).toBeVisible();
		// La tabla de niveles resalta el nivel del último pedido (total $6.000 → nivel 1).
		await expect(domiPage.getByText('tu último pedido: nivel 1')).toBeVisible();

		// ---- 6. El admin registra un abono de $1.000. ----
		await adminPage.goto('/admin/domiciliarios');
		const filaDom = adminPage.locator('li', { hasText: nombreDomi });
		await expect(filaDom).toBeVisible({ timeout: 15_000 });
		await filaDom.getByRole('button', { name: 'Registrar abono' }).click();
		await adminPage.locator('#abono-valor').fill('1000');
		await adminPage.locator('#abono-nota').fill('E2E abono');
		await adminPage.getByRole('dialog').getByRole('button', { name: 'Registrar abono' }).click();
		await expect(adminPage.getByText(/Abono de \$\s*1\.000 registrado/)).toBeVisible({
			timeout: 15_000
		});

		// ---- 7. El domiciliario ve el abono y la deuda reducida (recarga). ----
		await domiPage.reload();
		const abonado = domiPage.locator('div.rounded-2xl', { hasText: 'Abonos registrados' });
		await expect(abonado.getByText(/1\.000/)).toBeVisible({ timeout: 15_000 });
		// Anclado con $ (y no /500/): si el abono fallara, la deuda seguiría en
		// $1.500 y «/500/» matchearía el «500» de «1.500» (falso positivo).
		await expect(
			domiPage.locator('div.rounded-2xl', { hasText: 'Deuda pendiente' }).getByText(/\$\s*500/)
		).toBeVisible();
		await expect(domiPage.getByText('Últimos abonos (1)')).toBeVisible();
		await expect(domiPage.getByText(/total abonado \$\s*1\.000/)).toBeVisible();
		await expect(domiPage.getByText('en deuda', { exact: true })).toBeVisible();
	} finally {
		await limpiarDomi(domiId, domiUserId);
		await ctxAdmin.close();
		await ctxDomi.close();
	}
});
