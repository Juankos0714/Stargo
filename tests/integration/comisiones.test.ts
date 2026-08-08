import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { INTEGRACION_DISPONIBLE, peticion } from './http';	import {
	PASSWORD_TEST,
	loginEnApp,
	sesionConToken,
	limpiarIntegracion,
	crearAdmin,
	crearCliente,
	crearDomiciliario,
	sembrarCatalogo,
	sembrarPedido,
	clienteService,
	type Catalogo,
	type SesionApp,
	type UsuarioRol
} from './helpers';

/**
 * Flujo completo de comisiones por NIVELES (Fase 11 + 12) por los endpoints
 * reales:
 *
 *   niveles (admin) → entrega con snapshot por nivel → mi-cuenta (el domi
 *   ve los niveles y su deuda) → abono → bloqueo → rechazo de asignación
 *   → termina pedidos en curso → desbloqueo.
 *
 * Fase 12: la escalera es configurable (paso y cantidad) vía
 * PUT /api/comisiones/config, que reacomoda todos los niveles conservando
 * los valores por posición.
 *
 * Cada paso se verifica contra la base REAL (service_role), no solo contra
 * la respuesta del endpoint.
 */

/** Id fijo de la fila única de comision_config (Fase 12). */
const CONFIG_ID = '00000000-0000-0000-0000-000000000001';
describe.skipIf(!INTEGRACION_DISPONIBLE)('Comisiones por niveles y bloqueo (Fase 11) — flujo por endpoints', () => {
	let cat: Catalogo;
	let admin: UsuarioRol;
	let domA: UsuarioRol & { domiciliarioId: string };
	let cliente: UsuarioRol;
	let sesionAdmin: SesionApp;
	let sesionDomA: SesionApp;
	let sesionCliente: SesionApp;

	const ABONO = 1500;

	function mensaje(r: { data: unknown }): string {
		const d = r.data as { message?: string; error?: string } | null;
		return d?.error ?? d?.message ?? '';
	}

	interface Cuenta {
		niveles: { nivel: number; hasta: number; valor: number }[];
		bloqueado: boolean;
		total_comision: number;
		total_pagos: number;
		deuda: number;
		hoy: { fecha: string; total: number; nivel: number | null; comision: number };
	}

	async function nivelesAdmin(): Promise<{ id: string; nivel: number; hasta: number; valor: number }[]> {
		const r = await peticion<{ data: { id: string; nivel: number; hasta: number; valor: number }[]; error?: string }>(
			'/api/comisiones',
			{ jar: sesionAdmin.jar }
		);
		expect(r.status, `GET comisiones: ${r.data?.error}`).toBe(200);
		return r.data?.data ?? [];
	}

	async function cuentaDomA(): Promise<Cuenta> {
		const r = await peticion<{ data: Cuenta; error?: string }>('/api/domiciliarios/mi-cuenta', {
			jar: sesionDomA.jar
		});
		expect(r.status, `mi-cuenta: ${r.data?.error}`).toBe(200);
		return r.data!.data;
	}

	/** Crea un pedido, lo asigna por el endpoint admin y lo entrega el domi. */
	async function crearYEntregar(tarifaBase = 6000): Promise<{ id: string; numero: string }> {
		const pedido = await sembrarPedido({
			barrioOrigenId: cat.barrioA,
			barrioDestinoId: cat.barrioB,
			estado: 'pendiente',
			tarifaBase
		});
		const asignar = await peticion<{ error?: string }>(`/api/pedidos/${pedido.id}/asignar`, {
			metodo: 'POST',
			cuerpo: { domiciliario_id: domA.domiciliarioId },
			jar: sesionAdmin.jar
		});
		expect(asignar.status, `asignar: ${asignar.data?.error}`).toBe(200);

		for (const siguiente of ['aceptado', 'recogido', 'en_camino', 'entregado']) {
			const r = await peticion<{ error?: string }>(`/api/pedidos/${pedido.id}/estado`, {
				metodo: 'POST',
				cuerpo: { estado: siguiente },
				jar: sesionDomA.jar
			});
			expect(r.status, `→ ${siguiente}: ${r.data?.error}`).toBe(200);
		}
		return pedido;
	}

	beforeAll(async () => {
		cat = await sembrarCatalogo();
		admin = await crearAdmin();
		domA = await crearDomiciliario();
		cliente = await crearCliente();
		sesionAdmin = await loginEnApp(admin.email, PASSWORD_TEST);
		sesionDomA = await loginEnApp(domA.email, PASSWORD_TEST);
		sesionCliente = sesionConToken(cliente.token);

		// Normaliza los niveles a un estado conocido para la corrida.
		const s = clienteService();
		await s.from('comision_niveles').delete().gte('nivel', 0);
		const { error } = await s.from('comision_niveles').insert([
			{ nivel: 1, hasta: 10000, valor: 1300 },
			{ nivel: 2, hasta: 20000, valor: 1300 },
			{ nivel: 3, hasta: 30000, valor: 1300 }
		]);
		if (error) throw new Error(`Siembra de niveles falló: ${error.message}`);

		// Config de la escalera en un estado conocido (default de la migración;
		// upsert por id fijo).
		const { error: errCfg } = await s.from('comision_config').upsert({
			id: CONFIG_ID,
			paso: 10000,
			niveles: 20
		});
		if (errCfg) throw new Error(`Siembra de config falló: ${errCfg.message}`);
	});

	afterAll(async () => {
		await limpiarIntegracion();
	});

	test('admin ve los niveles sembrados por la migración (GET /api/comisiones)', async () => {
		const niveles = await nivelesAdmin();
		expect(niveles.length).toBe(3);
		expect(niveles[0]).toMatchObject({ nivel: 1, hasta: 10000, valor: 1300 });
		expect(niveles[1]).toMatchObject({ nivel: 2, hasta: 20000, valor: 1300 });
	});

	test('admin cambia el valor de un nivel y agrega otro (PUT/POST /api/comisiones)', async () => {
		const niveles = await nivelesAdmin();
		const nivel2 = niveles.find((n) => n.nivel === 2);
		expect(nivel2).toBeDefined();

		const r = await peticion<{ error?: string; data?: { valor: number } }>(
			`/api/comisiones?id=${nivel2!.id}`,
			{ metodo: 'PUT', cuerpo: { valor: 2200 }, jar: sesionAdmin.jar }
		);
		expect(r.status, r.data?.error).toBe(200);
		expect(r.data?.data?.valor).toBe(2200);

		// Agregar nivel: continúa la escalera (nivel 4, hasta 40.000, último valor).
		const creado = await peticion<{ error?: string; data?: { nivel: number; hasta: number; valor: number } }>(
			'/api/comisiones',
			{ metodo: 'POST', cuerpo: {}, jar: sesionAdmin.jar }
		);
		expect(creado.status, creado.data?.error).toBe(200);
		expect(creado.data?.data).toMatchObject({ nivel: 4, hasta: 40000, valor: 1300 });

		const finales = await nivelesAdmin();
		expect(finales.length).toBe(4);
		expect(finales.find((n) => n.nivel === 2)?.valor).toBe(2200);
	});

	test('entrega: congela la comisión del nivel según el total del pedido', async () => {
		const barato = await crearYEntregar(6000); // total 6000 → nivel 1 (1300)
		const caro = await crearYEntregar(15000); // total 15000 → nivel 2 (2200)

		const { data: filas } = await clienteService()
			.from('pedidos')
			.select('id, comision')
			.in('id', [barato.id, caro.id]);
		const porId = new Map((filas ?? []).map((f) => [f.id, f.comision]));
		expect(porId.get(barato.id)).toBe(1300);
		expect(porId.get(caro.id)).toBe(2200);
	});

	test('el domiciliario ve los niveles, su deuda DIARIA y el resumen de hoy', async () => {
		const cuenta = await cuentaDomA();
		expect(cuenta.niveles.length).toBe(4);
		expect(cuenta.niveles.find((n) => n.nivel === 2)?.valor).toBe(2200);
		// Fase 13: comisión por DÍA. Ambos pedidos se entregaron hoy (mismo
		// día en Bogotá): total 6.000 + 15.000 = 21.000 → nivel 3 →
		// comisión del día = 1.300 + 2.200 + 1.300 = 4.800.
		expect(cuenta.hoy.total).toBe(21000);
		expect(cuenta.hoy.nivel).toBe(3);
		expect(cuenta.hoy.comision).toBe(4800);
		expect(cuenta.total_comision).toBe(4800);
		expect(cuenta.total_pagos).toBe(0);
		expect(cuenta.deuda).toBe(4800);
		expect(cuenta.bloqueado).toBe(false);
	});

	test('admin registra un abono (POST /api/pagos) y la deuda se reduce', async () => {
		const r = await peticion<{ error?: string; data?: { valor: number; nota: string | null } }>('/api/pagos', {
			metodo: 'POST',
			cuerpo: { domiciliario_id: domA.domiciliarioId, valor: ABONO, nota: 'Abono en efectivo' },
			jar: sesionAdmin.jar
		});
		expect(r.status, r.data?.error).toBe(200);
		expect(r.data?.data?.valor).toBe(ABONO);

		const cuenta = await cuentaDomA();
		expect(cuenta.total_pagos).toBe(ABONO);
		expect(cuenta.deuda).toBe(4800 - ABONO);

		const listado = await peticion<{ data: { valor: number }[] }>(
			`/api/pagos?domiciliario_id=${domA.domiciliarioId}`,
			{ jar: sesionAdmin.jar }
		);
		expect((listado.data?.data ?? []).map((p) => p.valor)).toContain(ABONO);
	});

	test('bloqueo: no recibe pedidos nuevos pero termina los en curso', async () => {
		const r = await peticion<{ error?: string; data?: { bloqueado: boolean } }>(
			`/api/domiciliarios?id=${domA.domiciliarioId}`,
			{ metodo: 'PUT', cuerpo: { bloqueado: true }, jar: sesionAdmin.jar }
		);
		expect(r.status, r.data?.error).toBe(200);
		expect(r.data?.data?.bloqueado).toBe(true);
		expect((await cuentaDomA()).bloqueado).toBe(true);

		// Pedido nuevo → rechazado con el motivo.
		const pedido = await sembrarPedido({
			barrioOrigenId: cat.barrioA,
			barrioDestinoId: cat.barrioB,
			estado: 'pendiente'
		});
		const asignar = await peticion<{ error: string }>(`/api/pedidos/${pedido.id}/asignar`, {
			metodo: 'POST',
			cuerpo: { domiciliario_id: domA.domiciliarioId },
			jar: sesionAdmin.jar
		});
		expect(asignar.status).toBe(400);
		expect(asignar.data?.error).toMatch(/bloqueado por falta de pago/);
		const { data: fila } = await clienteService()
			.from('pedidos')
			.select('estado, domiciliario_id')
			.eq('id', pedido.id)
			.single();
		expect(fila?.estado).toBe('pendiente');
		expect(fila?.domiciliario_id).toBeNull();

		// El que ya tenía asignado sí lo termina (y genera comisión).
		const enCurso = await sembrarPedido({
			barrioOrigenId: cat.barrioA,
			barrioDestinoId: cat.barrioB,
			estado: 'asignado',
			domiciliarioId: domA.domiciliarioId,
			tarifaBase: 6000
		});
		for (const siguiente of ['aceptado', 'recogido', 'en_camino', 'entregado']) {
			const t = await peticion<{ error?: string }>(`/api/pedidos/${enCurso.id}/estado`, {
				metodo: 'POST',
				cuerpo: { estado: siguiente },
				jar: sesionDomA.jar
			});
			expect(t.status, `→ ${siguiente}: ${t.data?.error}`).toBe(200);
		}
		// El tercer pedido (6.000) se entrega el MISMO día: total del día
		// 21.000 + 6.000 = 27.000 → sigue en nivel 3 → comisión del día 4.800.
		expect((await cuentaDomA()).total_comision).toBe(4800);
	});

	test('solo el admin desbloquea y el domiciliario vuelve a recibir pedidos', async () => {
		const intento = await peticion<{ error: string }>(`/api/domiciliarios?id=${domA.domiciliarioId}`, {
			metodo: 'PUT',
			cuerpo: { bloqueado: false },
			jar: sesionDomA.jar
		});
		expect(intento.status).toBe(403);

		const r = await peticion<{ error?: string; data?: { bloqueado: boolean } }>(
			`/api/domiciliarios?id=${domA.domiciliarioId}`,
			{ metodo: 'PUT', cuerpo: { bloqueado: false }, jar: sesionAdmin.jar }
		);
		expect(r.status, r.data?.error).toBe(200);
		expect(r.data?.data?.bloqueado).toBe(false);

		const pedido = await sembrarPedido({
			barrioOrigenId: cat.barrioA,
			barrioDestinoId: cat.barrioB,
			estado: 'pendiente'
		});
		const asignar = await peticion<{ error?: string }>(`/api/pedidos/${pedido.id}/asignar`, {
			metodo: 'POST',
			cuerpo: { domiciliario_id: domA.domiciliarioId },
			jar: sesionAdmin.jar
		});
		expect(asignar.status, asignar.data?.error).toBe(200);
	});

	test('seguridad: anónimo → 401 y cliente sin rol → 403 en niveles y bloqueo', async () => {
		const rAnon = await peticion('/api/comisiones?id=x', { metodo: 'PUT', cuerpo: { valor: 5000 } });
		expect(rAnon.status).toBe(401);

		const rAnonPago = await peticion('/api/pagos', {
			metodo: 'POST',
			cuerpo: { domiciliario_id: domA.domiciliarioId, valor: 1000 }
		});
		expect(rAnonPago.status).toBe(401);

		const rCliente = await peticion<{ message: string }>('/api/comisiones?id=x', {
			metodo: 'PUT',
			cuerpo: { valor: 5000 },
			jar: sesionCliente.jar
		});
		expect(rCliente.status).toBe(403);
		expect(mensaje(rCliente)).toMatch(/No eres administrador/);
	});

	test('la escalera expone su config (paso y cantidad) en GET /api/comisiones', async () => {
		const r = await peticion<{
			data: { nivel: number }[];
			meta?: { config?: { paso: number; niveles: number } };
		}>('/api/comisiones', { jar: sesionAdmin.jar });
		expect(r.status).toBe(200);
		// Tras los tests anteriores hay 4 niveles y el POST sincronizó la config
		// (la cantidad de niveles de la config refleja el conteo real).
		expect(r.data?.meta?.config?.paso).toBe(10000);
		expect(r.data?.meta?.config?.niveles).toBe((r.data?.data ?? []).length);
	});

	test('admin reacomoda la escalera con paso y cantidad nuevos (PUT /api/comisiones/config)', async () => {
		const r = await peticion<{ error?: string; data?: { paso: number; niveles: number } }>(
			'/api/comisiones/config',
			{ metodo: 'PUT', cuerpo: { paso: 15000, niveles: 3 }, jar: sesionAdmin.jar }
		);
		expect(r.status, r.data?.error).toBe(200);
		expect(r.data?.data).toMatchObject({ paso: 15000, niveles: 3 });

		const finales = await nivelesAdmin();
		expect(finales).toHaveLength(3);
		expect(finales.map((n) => n.hasta)).toEqual([15000, 30000, 45000]);
		// Conserva los valores por posición (el nivel 2 quedó en 2200 antes).
		expect(finales.map((n) => n.valor)).toEqual([1300, 2200, 1300]);
	});

	test('POST /api/comisiones continúa la escalera con el paso configurado', async () => {
		const creado = await peticion<{ error?: string; data?: { nivel: number; hasta: number; valor: number } }>(
			'/api/comisiones',
			{ metodo: 'POST', cuerpo: {}, jar: sesionAdmin.jar }
		);
		expect(creado.status, creado.data?.error).toBe(200);
		// El paso vigente es 15.000 → nivel 4 hasta 60.000, con el último valor.
		expect(creado.data?.data).toMatchObject({ nivel: 4, hasta: 60000, valor: 1300 });
	});		test('DELETE /api/comisiones sincroniza la cantidad en la config', async () => {
			const niveles = await nivelesAdmin();
			const ultimo = niveles[niveles.length - 1];
			const r = await peticion<{ error?: string }>(`/api/comisiones?id=${ultimo.id}`, {
				metodo: 'DELETE',
				jar: sesionAdmin.jar
			});
			expect(r.status, r.data?.error).toBe(200);

			const verifica = await peticion<{
				data: { nivel: number }[];
				meta?: { config?: { niveles: number } };
			}>('/api/comisiones', { jar: sesionAdmin.jar });
			expect(verifica.status).toBe(200);
			expect(verifica.data?.meta?.config?.niveles).toBe((verifica.data?.data ?? []).length);
		});

		test('la reconfiguración valida los parámetros (400)', async () => {
		const r = await peticion<{ error: string }>('/api/comisiones/config', {
			metodo: 'PUT',
			cuerpo: { paso: 0, niveles: 3 },
			jar: sesionAdmin.jar
		});
		expect(r.status).toBe(400);
		expect(r.data?.error ?? '').toMatch(/paso/i);
	});

	test('seguridad: solo el admin reacomoda la escalera (config)', async () => {
		const rAnon = await peticion('/api/comisiones/config', { metodo: 'PUT', cuerpo: { paso: 1000, niveles: 2 } });
		expect(rAnon.status).toBe(401);

		const rDomi = await peticion('/api/comisiones/config', {
			metodo: 'PUT',
			cuerpo: { paso: 1000, niveles: 2 },
			jar: sesionDomA.jar
		});
		expect(rDomi.status).toBe(403);

		const rCliente = await peticion<{ message: string }>('/api/comisiones/config', {
			metodo: 'PUT',
			cuerpo: { paso: 1000, niveles: 2 },
			jar: sesionCliente.jar
		});
		expect(rCliente.status).toBe(403);
		expect(mensaje(rCliente)).toMatch(/No eres administrador/);
	});

	test('restaura la escalera y la config para no contaminar otras corridas', async () => {
		const s = clienteService();
		await s.from('comision_niveles').delete().gte('nivel', 4);
		await s.from('comision_config').update({ paso: 10000, niveles: 3 }).eq('id', CONFIG_ID);

		const r = await peticion<{
			data: { nivel: number }[];
			meta?: { config?: { paso: number; niveles: number } };
		}>('/api/comisiones', { jar: sesionAdmin.jar });
		expect(r.status).toBe(200);
		expect((r.data?.data ?? []).length).toBe(3);
		expect(r.data?.meta?.config).toMatchObject({ paso: 10000, niveles: 3 });
	});
});
