/**
 * Helpers de la suite E2E (Partes 5 y 6) — tests/e2e/*
 *
 * Reutiliza la infraestructura de las Partes 2 y 3:
 *   - clientes de Supabase (anon/service) y peticiones HTTP con cookies
 *     (tests/rls/helpers.ts y tests/integration/helpers.ts, vía re-export).
 *   - login a través de la app real (POST /api/login).
 *
 * A eso suma lo propio del E2E:
 *   - Estado compartido entre procesos (global-setup → specs → teardown) a
 *     través de tests/e2e/.state.json: usuarios y catálogo sembrados con un
 *     prefijo único por corrida (PREFIJO_E2E) y limpieza determinista.
 *   - Acciones de UI (login, elegir barrio, crear pedido) con selectores
 *     estables de los componentes reales.
 *
 * ⚠️ NUNCA apuntes la suite a un Supabase de producción: crea usuarios y datos.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

export * from '../integration/helpers';
// peticion/CookieJar/loginEnApp no se re-exportan desde integration/helpers
// (solo se importan ahí), así que se importan y re-exportan desde su origen.
// El import local además crea el binding que estos helpers usan abajo.
import { peticion, peticionTexto, CookieJar } from '../integration/http';
import { loginEnApp } from '../integration/helpers';
export { peticion, peticionTexto, CookieJar, loginEnApp };

// ---------- Entorno y prefijo único por corrida -----------------------------

/** Prefijo E2E: lo fija el runner (scripts/e2e-run.mjs) para compartirlo
 *  entre global-setup, specs y teardown (procesos distintos). */
export const PREFIJO_E2E = process.env.E2E_PREFIJO ?? `e2e${Date.now().toString(36)}`;

/**
 * Sufijo ÚNICO por invocación de un spec. La matriz corre varios proyectos
 * (desktop/mobile, chromium/webkit) EN PARALELO con el MISMO prefijo E2E;
 * los specs que crean datos (domis dedicados, zonas de configuración, etc.)
 * usan este sufijo para no colisionar entre corridas de proyectos.
 */
export function sufijoUnico(): string {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const AQUI = join(fileURLToPath(new URL('.', import.meta.url)));
export const RUTA_ESTADO = join(AQUI, '.state.json');

export interface EstadoE2E {
	prefijo: string;
	password: string;
	usuarios: {
		admin: { email: string; userId: string };
		domiciliario: { email: string; userId: string; domiciliarioId: string };
		domiciliarioB: { email: string; userId: string; domiciliarioId: string };
	};
	catalogo: {
		zonaA: string;
		zonaB: string;
		zonaNueva: string;
		barrioA: string;
		barrioB: string;
		barrioSinTarifa: string;
		recargoPeso: { codigo: string; nombre: string; valor: number };
	};
}

/** Lee el estado sembrado por el global-setup (null si no hay). */
export function estadoE2E(): EstadoE2E | null {
	try {
		return JSON.parse(readFileSync(RUTA_ESTADO, 'utf-8')) as EstadoE2E;
	} catch {
		return null;
	}
}

function guardarEstado(estado: EstadoE2E): void {
	mkdirSync(AQUI, { recursive: true });
	writeFileSync(RUTA_ESTADO, JSON.stringify(estado, null, 2));
}

export function borrarEstado(): void {
	try {
		rmSync(RUTA_ESTADO, { force: true });
	} catch {
		// best-effort
	}
}

// ---------- Siembra (la usa el global-setup) --------------------------------

/** Email con prefijo: permite limpieza determinista por patrón. */
export function emailE2E(rol: string): string {
	return `e2e_${PREFIJO_E2E}_${rol}@example.com`;
}

/** Siembra usuarios por rol + catálogo y devuelve el estado (null sin credenciales). */
export async function sembrarE2E(): Promise<EstadoE2E | null> {
	// La siembra necesita un Supabase de prueba (credenciales en .env.test).
	// Sin credenciales, no hay nada que sembrar: los specs se auto-saltan.
	const { clienteService, ENTORNO } = await import('../rls/helpers');
	if (!clienteService || !ENTORNO) return null;

	const s = clienteService();
	const password = ENTORNO.password;

	// Purga best-effort de residuos `e2e_%` de corridas interrumpidas (un
	// teardown que no corrió deja recargos/barrios/zonas con el prefijo de su
	// corrida). Sin esto se acumulan y rompen selectores por texto duplicado
	// (p. ej. 'E2E Compra' resolvía 9 elementos). Solo catálogo y filas de
	// rol: los usuarios de Auth huérfanos no interfieren y no se tocan para
	// no romper una corrida paralela de la matriz.
	await intentar(async () => {
		const { data: barriosViejos } = await s.from('barrios').select('id').like('nombre', 'Barrio E2E %');
		const ids = (barriosViejos ?? []).map((b) => b.id as string);
		if (ids.length > 0) {
			await s.from('pedidos').delete().in('barrio_origen_id', ids);
		}
	});
	await intentar(() => s.from('barrios').delete().like('nombre', 'Barrio E2E %'));
	await intentar(() => s.from('tarifas').delete().like('zona_origen_id', 'e2e_%'));
	await intentar(() => s.from('zonas').delete().like('id', 'e2e_%'));
	await intentar(() => s.from('recargos').delete().like('codigo', 'e2e_%'));
	await intentar(() => s.from('domiciliarios').delete().like('nombre', 'E2E Domiciliario %'));
	await intentar(() => s.from('admins').delete().like('email', 'e2e_%'));

	const crearUsuario = async (rol: string): Promise<{ id: string; email: string }> => {
		const email = emailE2E(rol);
		const { data, error } = await s.auth.admin.createUser({
			email,
			password,
			email_confirm: true
		});
		if (error || !data.user) throw new Error(`E2E: no se pudo crear ${email}: ${error?.message}`);
		return { id: data.user.id, email };
	};

	// Nota: NO se siembra un usuario "cliente": en esta app el cliente es
	// anónimo (crea pedidos sin cuenta y los sigue por código) — los flujos
	// E2E del cliente no requieren login.
	const admin = await crearUsuario('admin');
	const dom = await crearUsuario('dom');
	const domB = await crearUsuario('domB');

	const { data: filaDom, error: errDom } = await s
		.from('domiciliarios')
		.insert({ user_id: dom.id, nombre: `E2E Domiciliario ${PREFIJO_E2E}`, email: dom.email, activo: true })
		.select('id')
		.single();
	if (errDom || !filaDom) throw new Error(`E2E: no se pudo registrar el domiciliario: ${errDom?.message}`);
	const { data: filaDomB, error: errDomB } = await s
		.from('domiciliarios')
		.insert({ user_id: domB.id, nombre: `E2E Domiciliario B ${PREFIJO_E2E}`, email: domB.email, activo: true })
		.select('id')
		.single();
	if (errDomB || !filaDomB) throw new Error(`E2E: no se pudo registrar el domiciliario B: ${errDomB?.message}`);
	const { error: errAdm } = await s.from('admins').insert({ user_id: admin.id, email: admin.email });
	if (errAdm) throw new Error(`E2E: no se pudo registrar el admin: ${errAdm.message}`);

	// Catálogo: zona A, zona B (tarifa 6000), zona_roja, barrios, recargos.
	const zonaA = `e2e_${PREFIJO_E2E}_a`;
	const zonaB = `e2e_${PREFIJO_E2E}_b`;
	const zonaRoja = 'zona_roja';
	const { error: errZonas } = await s.from('zonas').insert([
		{ id: zonaA, nombre: `Zona E2E A ${PREFIJO_E2E}`, tipo: 'urbana' },
		{ id: zonaB, nombre: `Zona E2E B ${PREFIJO_E2E}`, tipo: 'urbana' }
	]);
	if (errZonas) throw new Error(`E2E: siembra de zonas falló: ${errZonas.message}`);
	// La zona roja usa el id canónico: si otra suite (p. ej. RLS) ya la creó en
	// la misma BD local, el upsert no rompe la corrida.
	await s.from('zonas').upsert(
		{ id: zonaRoja, nombre: `Zona E2E Roja ${PREFIJO_E2E}`, tipo: 'no_disponible' },
		{ onConflict: 'id' }
	);

	const nombreBarrioA = `Barrio E2E A ${PREFIJO_E2E}`;
	const nombreBarrioB = `Barrio E2E B ${PREFIJO_E2E}`;
	const nombreSinTarifa = `Barrio E2E Sin Tarifa ${PREFIJO_E2E}`;
	const { data: barrios, error: errBarrios } = await s
		.from('barrios')
		.insert([
			{ nombre: nombreBarrioA, zona_id: zonaA },
			{ nombre: nombreBarrioB, zona_id: zonaB },
			// Mismo barrio origen/destino: A→A no tiene tarifa diagonal → flujo de error.
			{ nombre: nombreSinTarifa, zona_id: zonaA }
		])
		.select('id, nombre');
	if (errBarrios || !barrios) throw new Error(`E2E: siembra de barrios falló: ${errBarrios?.message}`);
	const porNombre = new Map(barrios.map((b) => [b.nombre, b.id]));

	const { error: errTarifa } = await s.from('tarifas').insert({
		zona_origen_id: zonaA,
		zona_destino_id: zonaB,
		valor: 6000
	});
	if (errTarifa) throw new Error(`E2E: siembra de tarifa falló: ${errTarifa.message}`);

	// Recargo ACTIVO no-compra: en el flujo de Domicilio los recargos de tipo
	// «compra» se ocultan (solo aplican a compras/diligencias), así que el
	// único recargo visible del formulario debe ser de otro tipo ('peso').
	const recargoPeso = { codigo: `e2e_${PREFIJO_E2E}_peso`, nombre: 'E2E Peso', valor: 2000 };
	const { error: errRecargos } = await s.from('recargos').insert([
		{ ...recargoPeso, tipo: 'peso', activo: true },
		{ codigo: `e2e_${PREFIJO_E2E}_inactivo`, nombre: 'E2E Inactivo', valor: 999, tipo: 'otro', activo: false }
	]);
	if (errRecargos) throw new Error(`E2E: siembra de recargos falló: ${errRecargos.message}`);

	// Horario permisivo: crear_pedido() (Fase 13) bloquea fuera del horario
	// y los E2E crean pedidos a cualquier hora.
	await s.from('horario_operacion').upsert(
		Array.from({ length: 7 }, (_, i) => ({
			dia_semana: i + 1,
			apertura: '00:00',
			cierre: '23:59',
			activo: true
		})),
		{ onConflict: 'dia_semana' }
	);

	const estado: EstadoE2E = {
		prefijo: PREFIJO_E2E,
		password,
		usuarios: {
			admin: { email: admin.email, userId: admin.id },
			domiciliario: { email: dom.email, userId: dom.id, domiciliarioId: filaDom.id },
			domiciliarioB: { email: domB.email, userId: domB.id, domiciliarioId: filaDomB.id }
		},
		catalogo: {
			zonaA,
			zonaB,
			zonaNueva: `e2e_${PREFIJO_E2E}_nueva`,
			barrioA: porNombre.get(nombreBarrioA) as string,
			barrioB: porNombre.get(nombreBarrioB) as string,
			barrioSinTarifa: porNombre.get(nombreSinTarifa) as string,
			recargoPeso
		}
	};
	guardarEstado(estado);
	return estado;
}

// ---------- Limpieza (la usa el global-teardown) ----------------------------

/** Ejecuta la promesa ignorando errores (limpieza best-effort). */
async function intentar(fn: () => PromiseLike<unknown>): Promise<void> {
	try {
		await fn();
	} catch {
		// La limpieza nunca debe romper la corrida.
	}
}

/** Borra todo lo sembrado por esta corrida E2E (usuarios, catálogo, pedidos). */
export async function limpiarE2E(): Promise<void> {
	const estado = estadoE2E();
	const { clienteService } = await import('../rls/helpers');
	if (!estado || !clienteService) {
		borrarEstado();
		return;
	}
	const s = clienteService();
	const p = estado.prefijo;

	// Pedidos de la corrida: los del catálogo E2E usan barrios con prefijo,
	// así que se borran por los barrios asociados (los del API tienen
	// direcciones distintivas y los de UI se asocian por barrio_origen).
	const { data: barrios } = await s.from('barrios').select('id').like('nombre', `%${p}%`);
	const ids = (barrios ?? []).map((b) => b.id);
	if (ids.length > 0) {
		await intentar(() => s.from('pedidos').delete().in('barrio_origen_id', ids));
	}
	await intentar(() => s.from('pedidos').delete().like('direccion_origen', `Dir e2e ${p}%`));

	// Catálogo.
	await intentar(() => s.from('barrios').delete().like('nombre', `%${p}%`));
	await intentar(() => s.from('tarifas').delete().like('zona_origen_id', `e2e_${p}%`));
	await intentar(() => s.from('zonas').delete().like('id', `e2e_${p}%`));
	await intentar(() => s.from('zonas').delete().eq('id', 'zona_roja'));
	await intentar(() => s.from('recargos').delete().like('codigo', `e2e_${p}%`));

	// Filas de rol y usuarios de Auth.
	await intentar(() => s.from('domiciliarios').delete().like('nombre', `%${p}%`));
	await intentar(() => s.from('admins').delete().like('email', `e2e_${p}%`));
	for (const u of [
		estado.usuarios.admin,
		estado.usuarios.domiciliario,
		estado.usuarios.domiciliarioB
	]) {
		await intentar(() => s.auth.admin.deleteUser(u.userId));
	}

	borrarEstado();
}

// ---------- Acciones por API (setup determinista de los specs) -------------- 

/** Base URL de la app en pruebas (la misma que usa Playwright). */
export const BASE_E2E = process.env.TEST_BASE_URL || 'http://127.0.0.1:4176';

/** Crea un pedido por la API pública y devuelve su código de seguimiento. */
export async function crearPedidoAPI(
	e: EstadoE2E,
	opts: { recargos?: string[] } = {}
): Promise<string> {
	// El endpoint responde { data: { numero, ... } } (la respuesta del RPC).
	const recargos = opts.recargos ?? [];
	const r = await peticion<{ data?: { numero: string }; error?: string }>('/api/pedidos', {
		metodo: 'POST',
		cuerpo: {
			barrio_origen: e.catalogo.barrioA,
			direccion_origen: `Dir e2e ${e.prefijo} origen API`,
			barrio_destino: e.catalogo.barrioB,
			direccion_destino: `Dir e2e ${e.prefijo} destino API`,
			observaciones: 'creado por API E2E',
			recargos,
			// Fase 14: el API exige decisión explícita de recargos (elegir o «No
			// aplica»). Sin recargos se marca «no aplica».
			recargos_confirmados_no_aplica: recargos.length === 0,
			// Fase 19: el teléfono es obligatorio.
			telefono: '3001234567'
		}
	});
	const creado = r.data?.data;
	if (!r.ok || !creado?.numero) {
		throw new Error(`E2E: no se pudo crear el pedido por API: ${r.data?.error ?? r.status}`);
	}
	return creado.numero;
}

/** ID del pedido a partir de su código (vía el endpoint público de consulta). */
export async function idDePedido(numero: string): Promise<string> {
	// El endpoint responde { data: { pedido: { id, ... }, historial } }.
	const r = await peticion<{ data?: { pedido?: { id: string } } }>(
		`/api/pedidos/consultar?numero=${encodeURIComponent(numero)}`
	);
	const id = r.data?.data?.pedido?.id;
	if (!id) throw new Error(`E2E: no se encontró el pedido ${numero}`);
	return id;
}

/** Asigna el pedido a un domiciliario (sesión admin real por la app). */
export async function asignarPedidoAPI(
	numero: string,
	domiciliarioId: string,
	e: EstadoE2E
): Promise<void> {
	const admin = await loginEnApp(e.usuarios.admin.email, e.password);
	const id = await idDePedido(numero);
	const r = await peticion<{ error?: string }>(`/api/pedidos/${id}/asignar`, {
		metodo: 'POST',
		cuerpo: { domiciliario_id: domiciliarioId },
		jar: admin.jar
	});
	if (!r.ok) {
		throw new Error(`E2E: no se pudo asignar ${numero}: ${r.data?.error ?? r.status}`);
	}
}

// ---------- Acciones de UI (selectores estables de los componentes) ---------

/** Login real por la UI (/login). Espera la URL destino del rol. */
export async function loginUI(page: Page, email: string, password: string, destino: string): Promise<void> {
	await page.goto('/login');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Contraseña').fill(password);
	await page.getByRole('button', { name: 'Iniciar sesión' }).click();
	await page.waitForURL(`**${destino}**`, { timeout: 15_000 });
}

/**
 * Elige un barrio en un SearchSelect escribiendo su nombre y haciendo clic en
 * la opción filtrada (los componentes reales usan <li role="option">).
 */
export async function elegirBarrio(page: Page, idInput: string, nombre: string): Promise<void> {
	const input = page.locator(`#${idInput}`);
	await input.fill(nombre);
	await page.locator(`#${idInput}-list [role="option"]`, { hasText: nombre }).first().click();
}

/**
 * Crea un pedido por la UI real (nuevo-pedido) y devuelve el código de
 * seguimiento. La tarifa A→B del catálogo E2E es 6000 (formato "$ 6.000").
 */
export async function crearPedidoUI(
	page: Page,
	estado: EstadoE2E,
	opts: { recargo?: boolean } = {}
): Promise<string> {
	await page.goto('/nuevo-pedido');
	await page.getByText('Hacer un pedido').waitFor({ timeout: 15_000 });
	await elegirBarrio(page, 'ped-origen', `Barrio E2E A ${estado.prefijo}`);
	await elegirBarrio(page, 'ped-destino', `Barrio E2E B ${estado.prefijo}`);
	await page.locator('#dir-origen').fill('Dir e2e ' + estado.prefijo + ' origen');
	await page.locator('#dir-destino').fill('Dir e2e ' + estado.prefijo + ' destino');
	// Fase 14: el formulario exige decisión explícita de recargos — elegir el
	// recargo activo del catálogo («E2E Peso») o marcar «No aplica».
	if (opts.recargo) {
		await page.getByText('E2E Peso', { exact: true }).click();
	} else {
		await page.getByText('No aplica', { exact: true }).click();
	}
	// Fase 19: contacto del cliente (nombre opcional + celular obligatorio).
	await page.locator('#cli-nombre').fill('Ana E2E');
	await page.locator('#cli-telefono').fill('3001234567');
	// La tarifa calculada aparece al tener ambos barrios (A→B = 6000).
	await page.getByText(/6\.000/).first().waitFor({ timeout: 15_000 });
	await page.getByRole('button', { name: 'Confirmar pedido' }).click();
	await page.getByText('¡Pedido confirmado!').waitFor({ timeout: 15_000 });
	const codigo = (await page.getByTestId('codigo-pedido').textContent())?.trim() ?? '';
	if (!/^[A-Z0-9]{6}$/.test(codigo)) throw new Error(`E2E: código de pedido inesperado «${codigo}»`);
	return codigo;
}
