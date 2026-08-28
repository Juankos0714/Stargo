/**
 * Helpers de la suite de RLS (Parte 2).
 *
 * La suite corre contra un proyecto Supabase de PRUEBAS (por defecto Supabase
 * local vía CLI + Docker). Lee las credenciales de .env.test:
 *
 *   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
 *   TEST_USERS_PASSWORD (opcional, default 'stargo-test-2026')
 *
 * Sin credenciales, `RLS_DISPONIBLE` es false y los suites se auto-saltan
 * (describe.skipIf), de modo que `bun run test:rls` no rompe sin base local.
 *
 * ⚠️ NUNCA apuntes estos tests a producción: la suite crea usuarios y datos.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect } from 'vitest';

// ---------- Entorno ---------------------------------------------------------

interface EntornoRls {
	url: string;
	anonKey: string;
	serviceKey: string;
	password: string;
}

function leerEntorno(): EntornoRls | null {
	const url = process.env.SUPABASE_URL;
	const anonKey = process.env.SUPABASE_ANON_KEY;
	const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !anonKey || !serviceKey) return null;
	return {
		url,
		anonKey,
		serviceKey,
		password: process.env.TEST_USERS_PASSWORD ?? 'stargo-test-2026'
	};
}

export const ENTORNO = leerEntorno();
/** false si faltan credenciales: los suites se saltan (describe.skipIf). */
export const RLS_DISPONIBLE = ENTORNO !== null;

function requerirEntorno(): EntornoRls {
	if (!ENTORNO) {
		throw new Error(
			'Faltan SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY. ' +
				'Copia .env.test.example a .env.test (o exporta las variables) antes de correr la suite de RLS.'
		);
	}
	return ENTORNO;
}

// ---------- Clientes --------------------------------------------------------

/** Cliente anónimo (sin sesión): RLS como rol `anon`. */
export function clienteAnon(): SupabaseClient {
	const env = requerirEntorno();
	return createClient(env.url, env.anonKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
}

/** Cliente service_role: omite RLS (solo para sembrar/verificar/limpiar). */
export function clienteService(): SupabaseClient {
	const env = requerirEntorno();
	return createClient(env.url, env.serviceKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
}

/** Cliente autenticado como un usuario concreto (su JWT). */
export function clienteComo(token: string): SupabaseClient {
	const env = requerirEntorno();
	return createClient(env.url, env.anonKey, {
		auth: { persistSession: false, autoRefreshToken: false },
		global: { headers: { Authorization: `Bearer ${token}` } }
	});
}

// ---------- Prefijo único por corrida (limpieza determinista) ---------------

/** Prefijo de esta corrida: todos los datos sembrados lo incluyen. */
export const PREFIJO = `rls${Date.now().toString(36)}`;
const USUARIOS_CREADOS: string[] = [];

function emailTest(sufijo: string): string {
	return `rlstest_${PREFIJO}_${sufijo}@example.com`;
}

// ---------- Provisión de usuarios por rol -----------------------------------

let _userCounter = 0;

async function crearUsuario(sufijo: string): Promise<{ id: string; email: string }> {
	const env = requerirEntorno();
	const email = emailTest(`${sufijo}${_userCounter++}`);
	const { data, error } = await clienteService().auth.admin.createUser({
		email,
		password: env.password,
		email_confirm: true
	});
	if (error || !data.user) {
		throw new Error(`No se pudo crear el usuario de prueba ${email}: ${error?.message ?? 'sin datos'}`);
	}
	USUARIOS_CREADOS.push(data.user.id);
	return { id: data.user.id, email };
}

async function iniciarSesion(email: string): Promise<string> {
	const env = requerirEntorno();
	const { data, error } = await clienteAnon().auth.signInWithPassword({
		email,
		password: env.password
	});
	if (error || !data.session) {
		throw new Error(`No se pudo iniciar sesión como ${email}: ${error?.message ?? 'sin sesión'}`);
	}
	return data.session.access_token;
}

export interface UsuarioRol {
	token: string;
	email: string;
	userId: string;
}

/** Usuario autenticado SIN rol (cliente anónimo de la app). */
export async function crearCliente(): Promise<UsuarioRol> {
	const { id, email } = await crearUsuario('cli');
	return { token: await iniciarSesion(email), email, userId: id };
}

/** Usuario en public.admins (rol admin). */
export async function crearAdmin(): Promise<UsuarioRol> {
	const { id, email } = await crearUsuario('adm');
	const { error } = await clienteService().from('admins').insert({ user_id: id, email });
	if (error) throw new Error(`No se pudo registrar el admin: ${error.message}`);
	return { token: await iniciarSesion(email), email, userId: id };
}

/** Contador local: un mismo beforeAll crea VARIOS domiciliarios y el email
 * debe ser único (auth.users no permite duplicados). */
let contadorDomiciliario = 0;

/** Usuario en public.domiciliarios (rol domiciliario, activo por defecto). */
export async function crearDomiciliario(activo = true): Promise<UsuarioRol & { domiciliarioId: string }> {
	const { id, email } = await crearUsuario(`dom${++contadorDomiciliario}`);
	const { data, error } = await clienteService()
		.from('domiciliarios')
		.insert({ user_id: id, nombre: `Domiciliario ${PREFIJO}`, email, activo })
		.select('id')
		.single();
	if (error || !data) throw new Error(`No se pudo registrar el domiciliario: ${error?.message}`);
	return { token: await iniciarSesion(email), email, userId: id, domiciliarioId: data.id };
}

// ---------- Siembra del catálogo (zona/barrio/tarifa/recargo) ----------------

export interface Catalogo {
	zonaA: string;
	zonaB: string;
	barrioA: string;
	barrioB: string;
	barrioRojo: string;
	barrioSinSector: string;
	recargoCompra: { codigo: string; nombre: string; valor: number };
	recargoPeso: { codigo: string; nombre: string; valor: number };
	recargoInactivo: { codigo: string; nombre: string; valor: number };
}

/** Siembra zonas/barrios/tarifas/recargos de prueba (service_role, sin RLS). */
export async function sembrarCatalogo(): Promise<Catalogo> {
	const s = clienteService();
	const zonaA = `zona_${PREFIJO}_a`;
	const zonaB = `zona_${PREFIJO}_b`;
	const recargoCompra = { codigo: `rc_${PREFIJO}_compra`, nombre: 'Compra test', valor: 2000 };
	const recargoPeso = { codigo: `rc_${PREFIJO}_peso`, nombre: 'Peso test', valor: 3000 };
	const recargoInactivo = { codigo: `rc_${PREFIJO}_inactivo`, nombre: 'Inactivo test', valor: 999 };

	const { error: errZonas } = await s.from('zonas').insert([
		{ id: zonaA, nombre: 'Zona A test', tipo: 'urbana' },
		{ id: zonaB, nombre: 'Zona B test', tipo: 'urbana' },
		// La zona roja usa el id canónico (la lógica compara contra 'zona_roja').
		{ id: 'zona_roja', nombre: 'Zona Roja test', tipo: 'no_disponible' }
	]);
	if (errZonas) throw new Error(`Siembra de zonas falló: ${errZonas.message}`);

	const { data: barrios, error: errBarrios } = await s
		.from('barrios')
		.insert([
			{ nombre: `Barrio A ${PREFIJO}`, zona_id: zonaA },
			{ nombre: `Barrio B ${PREFIJO}`, zona_id: zonaB },
			{ nombre: `Barrio Rojo ${PREFIJO}`, zona_id: 'zona_roja' },
			{ nombre: `Barrio Sin Sector ${PREFIJO}`, zona_id: null }
		])
		.select('id, nombre');
	if (errBarrios || !barrios) throw new Error(`Siembra de barrios falló: ${errBarrios?.message}`);

	const porNombre = new Map(barrios.map((b) => [b.nombre, b.id]));
	const { error: errTarifa } = await s.from('tarifas').insert([
		{ zona_origen_id: zonaA, zona_destino_id: zonaA, valor: 6000 },
		{ zona_origen_id: zonaA, zona_destino_id: zonaB, valor: 6000 }
	]);
	if (errTarifa) throw new Error(`Siembra de tarifa falló: ${errTarifa.message}`);

	const { error: errRecargos } = await s.from('recargos').insert([
		{ ...recargoCompra, tipo: 'compra', activo: true },
		{ ...recargoPeso, tipo: 'peso', activo: true },
		{ ...recargoInactivo, tipo: 'otro', activo: false }
	]);
	if (errRecargos) throw new Error(`Siembra de recargos falló: ${errRecargos.message}`);

	// Horario permisivo: crear_pedido() exige estar dentro del horario.
	await sembrarHorarioPermisivo();

	return {
		zonaA,
		zonaB,
		barrioA: porNombre.get(`Barrio A ${PREFIJO}`) as string,
		barrioB: porNombre.get(`Barrio B ${PREFIJO}`) as string,
		barrioRojo: porNombre.get(`Barrio Rojo ${PREFIJO}`) as string,
		barrioSinSector: porNombre.get(`Barrio Sin Sector ${PREFIJO}`) as string,
		recargoCompra,
		recargoPeso,
		recargoInactivo
	};
}

/**
 * Deja el horario de operación PERMISIVO (00:00–23:59 todos los días): la
 * Fase 13 bloquea crear_pedido() fuera de horario y los tests crean pedidos
 * a cualquier hora. Lo llama sembrarCatalogo(); los tests de horario lo
 * anulan después con sus propias filas/excepciones.
 */
export async function sembrarHorarioPermisivo(): Promise<void> {
	const s = clienteService();
	await s.from('horario_operacion').upsert(
		Array.from({ length: 7 }, (_, i) => ({
			dia_semana: i + 1,
			apertura: '00:00',
			cierre: '23:59',
			activo: true
		})),
		{ onConflict: 'dia_semana' }
	);
}

/** Inserta un pedido directo (service_role) para los tests de aislamiento. */
export async function sembrarPedido(opts: {
	barrioOrigenId: string;
	barrioDestinoId: string;
	estado: string;
	domiciliarioId?: string | null;
	tarifaBase?: number;
}): Promise<{ id: string; numero: string }> {
	const numero = `T${PREFIJO}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
	const tarifa = opts.tarifaBase ?? 6000;
	const { data, error } = await clienteService()
		.from('pedidos')
		.insert({
			numero,
			barrio_origen_id: opts.barrioOrigenId,
			direccion_origen: 'Dirección origen test',
			barrio_destino_id: opts.barrioDestinoId,
			direccion_destino: 'Dirección destino test',
			observaciones: null,
			tarifa_base: tarifa,
			recargos: null,
			recargo_total: 0,
			total: tarifa,
			zona_origen_id: null,
			zona_destino_id: null,
			estado: opts.estado,
			domiciliario_id: opts.domiciliarioId ?? null
		})
		.select('id, numero')
		.single();
	if (error || !data) throw new Error(`Siembra de pedido falló: ${error?.message}`);
	return { id: data.id, numero: data.numero };
}

// ---------- Aserciones de acceso (RLS) --------------------------------------

export interface ResultadoCrud {
	error: { message: string; code: string } | null;
	filas: number;
}

interface RespuestaCrud {
	error: { message?: string; code?: string } | null;
	data: unknown;
	count?: number | null;
}

async function crud(accion: () => PromiseLike<RespuestaCrud>): Promise<ResultadoCrud> {
	const r = await accion();
	const error = r.error ? { message: String(r.error.message ?? r.error), code: String(r.error.code ?? '') } : null;
	const data = r.data as unknown;
	const filas =
		r.count ?? (Array.isArray(data) ? data.length : data != null ? 1 : 0);
	return { error, filas };
}

export function seleccion(
	cliente: SupabaseClient,
	tabla: string,
	filtro?: { columna: string; valor: string | number | null }
): Promise<ResultadoCrud> {
	return crud(() => {
		let q = cliente.from(tabla).select('*', { count: 'exact', head: true });
		if (filtro) q = q.eq(filtro.columna, filtro.valor);
		return q;
	});
}

export function insercion(cliente: SupabaseClient, tabla: string, fila: Record<string, unknown>): Promise<ResultadoCrud> {
	return crud(() => cliente.from(tabla).insert(fila).select());
}

export function actualizacion(
	cliente: SupabaseClient,
	tabla: string,
	columna: string,
	valor: string | number,
	datos: Record<string, unknown>
): Promise<ResultadoCrud> {
	return crud(() => cliente.from(tabla).update(datos).eq(columna, valor).select());
}

export function eliminacion(
	cliente: SupabaseClient,
	tabla: string,
	columna: string,
	valor: string | number
): Promise<ResultadoCrud> {
	return crud(() => cliente.from(tabla).delete().eq(columna, valor).select());
}

/**
 * El acceso debe estar DENEGADO. RLS deniega de dos formas que hay que
 * tratar igual: error visible (grants/política) o 0 filas (denegación
 * silenciosa, el caso que no lanza excepción).
 */
export function esperaDenegado(r: ResultadoCrud, detalle: string) {
	expect(
		r.error !== null || r.filas === 0,
		`${detalle}: se esperaba acceso denegado (error u 0 filas), pero se obtuvieron ${r.filas} fila(s)`
	).toBe(true);
}

/** El acceso debe estar PERMITIDO y devolver al menos 1 fila. */
export function esperaPermitido(r: ResultadoCrud, detalle: string) {
	expect(r.error, `${detalle}: error inesperado: ${r.error?.message}`).toBeNull();
	expect(r.filas, `${detalle}: se esperaban filas, pero no hubo ninguna`).toBeGreaterThan(0);
}

/** El acceso está permitido pero no debe devolver ninguna fila. */
export function esperaVacio(r: ResultadoCrud, detalle: string) {
	expect(r.error, `${detalle}: error inesperado: ${r.error?.message}`).toBeNull();
	expect(r.filas, `${detalle}: se esperaban 0 filas`).toBe(0);
}

/** Debe fallar con un error (opcionalmente con un mensaje que matchea). */
export function esperaError(r: ResultadoCrud, detalle: string, mensaje?: RegExp) {
	expect(r.error, `${detalle}: se esperaba un error, pero se obtuvieron ${r.filas} fila(s)`).not.toBeNull();
	if (mensaje && r.error) expect(r.error.message, `${detalle} (mensaje)`).toMatch(mensaje);
}

// ---------- Limpieza ---------------------------------------------------------

/**
 * Borra todo lo sembrado en esta corrida: pedidos (cascada a historial y
 * pedido_eventos), catálogo, filas de rol y usuarios de prueba. Best-effort:
 * contra un Supabase local basta `supabase db reset` para empezar limpio.
 */
/** Ejecuta la promesa ignorando errores (limpieza best-effort). */
async function intentar(fn: () => PromiseLike<unknown>): Promise<void> {
	try {
		await fn();
	} catch {
		// La limpieza nunca debe romper la corrida.
	}
}

export async function limpiarTodo(): Promise<void> {
	const s = clienteService();
	// Pedidos de esta corrida (borra en cascada historial_estados y
	// pedido_eventos). Se borran por los barrios que referencian, ANTES que
	// los barrios (FK ON DELETE RESTRICT): así se cubren tanto los sembrados
	// con numero `T<prefijo>` (guardado en MAYÚSCULAS: el LIKE por prefijo
	// minúscula nunca los matchea) como los creados vía RPC (código sin
	// prefijo, p. ej. '68C3E9').
	await intentar(async () => {
		const { data: barrios } = await s.from('barrios').select('id').like('nombre', `%${PREFIJO}%`);
		const ids = (barrios ?? []).map((b) => b.id as string);
		if (ids.length > 0) {
			await s.from('pedidos').delete().in('barrio_origen_id', ids);
		}
	});
	// Red de seguridad: pedidos sembrados con numero `T<prefijo>...` (guardado
	// en MAYÚSCULAS, por eso el prefijo en mayúsculas) por si el barrio ya no
	// existiera o el id no estuviera disponible.
	await intentar(() => s.from('pedidos').delete().like('numero', `T${PREFIJO.toUpperCase()}%`));
	// Catálogo (barrios por nombre, tarifas/zonas/recargos por prefijo).
	await intentar(() => s.from('barrios').delete().like('nombre', `%${PREFIJO}%`));
	await intentar(() => s.from('tarifas').delete().like('zona_origen_id', `zona_${PREFIJO}%`));
	await intentar(() => s.from('zonas').delete().like('id', `zona_${PREFIJO}%`));
	await intentar(() => s.from('zonas').delete().eq('id', 'zona_roja'));
	await intentar(() => s.from('recargos').delete().like('codigo', `rc_${PREFIJO}%`));
	// Horario: se restaura el default de la migración (08:00–20:00) y se
	// limpian las excepciones que pudieron dejar los tests de horario.
	await intentar(() =>
		s.from('horario_operacion').upsert(
			Array.from({ length: 7 }, (_, i) => ({
				dia_semana: i + 1,
				apertura: '08:00',
				cierre: '20:00',
				activo: true
			})),
			{ onConflict: 'dia_semana' }
		)
	);
	await intentar(() => s.from('horario_excepcion').delete().neq('fecha', '0001-01-01'));
	// Filas de rol.
	await intentar(() => s.from('domiciliarios').delete().like('nombre', `%${PREFIJO}%`));
	await intentar(() => s.from('admins').delete().like('email', `rlstest_${PREFIJO}%`));
	// Usuarios de Supabase Auth.
	for (const id of USUARIOS_CREADOS) {
		await intentar(() => s.auth.admin.deleteUser(id));
	}
	USUARIOS_CREADOS.length = 0;
}
