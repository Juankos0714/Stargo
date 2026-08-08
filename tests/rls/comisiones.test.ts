import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import {
	RLS_DISPONIBLE,
	clienteAnon,
	clienteService,
	clienteComo,
	crearAdmin,
	crearDomiciliario,
	crearCliente,
	sembrarCatalogo,
	sembrarPedido,
	seleccion,
	actualizacion,
	esperaPermitido,
	esperaVacio,
	esperaDenegado,
	limpiarTodo,
	type Catalogo,
	type UsuarioRol
} from './helpers';

/** Id fijo de la fila única de comision_config (Fase 12). */
const CONFIG_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Fase 11 + 12 — Comisiones por NIVELES, abonos y bloqueo por falta de pago.
 *
 * Modelo: la comisión depende del VALOR del pedido entregado
 * (total = tarifa + recargos). Cada nivel cubre un rango (nivel 1 hasta
 * $10.000, nivel 2 hasta $20.000, …) con un valor configurable solo por el
 * admin. Al entregar se congela el valor del nivel en pedidos.comision.
 *
 * Fase 12: la escalera es CONFIGURABLE — comision_config guarda el paso
 * entre niveles (cuánto abarca cada uno) y la cantidad de niveles; el RPC
 * reconfigurar_escalera reacomoda toda la escalera conservando los valores
 * por posición. La config solo la lee/escribe el admin.
 *
 * Flujo verificado:
 *   1) comision_niveles: solo el admin escribe; admin y domiciliarios leen;
 *      el cliente (sin rol) no ve la tabla y anon no tiene grants.
 *   1b) comision_config: solo el admin la lee y escribe; el RPC
 *      reconfigurar_escalera solo lo ejecuta el admin (anon sin grants).
 *   2) comision_para_total: ejecutable por autenticados (el cron/domi), no
 *      por anon; asigna el nivel correcto (incl. totales sobre el último).
 *   3) Al ENTREGAR se congela el snapshot del nivel (cambiar un nivel
 *      después no altera lo ya generado).
 *   4) El admin registra abonos (pagos_domiciliarios) contra la deuda.
 *   5) El admin bloquea/desbloquea; un bloqueado NO recibe pedidos nuevos
 *      pero puede terminar los que ya tiene.
 *   6) RLS: cada domiciliario solo ve sus propios pagos.
 */
describe.skipIf(!RLS_DISPONIBLE)('Comisiones por niveles y bloqueo (Fase 11)', () => {
	let servicio: ReturnType<typeof clienteService>;
	let anon: ReturnType<typeof clienteAnon>;
	let cat: Catalogo;
	let admin: UsuarioRol;
	let domA: UsuarioRol & { domiciliarioId: string };
	let domB: UsuarioRol & { domiciliarioId: string };
	let cliente: UsuarioRol;

	beforeAll(async () => {
		servicio = clienteService();
		anon = clienteAnon();
		cat = await sembrarCatalogo();
		admin = await crearAdmin();
		domA = await crearDomiciliario();
		domB = await crearDomiciliario();
		cliente = await crearCliente();

		// Normaliza la tabla de niveles a un estado conocido para la corrida
		// (la migración siembra 20 niveles; aquí bastan 3 para las pruebas).
		await servicio.from('comision_niveles').delete().gte('nivel', 0);
		const { error } = await servicio.from('comision_niveles').insert([
			{ nivel: 1, hasta: 10000, valor: 1300 },
			{ nivel: 2, hasta: 20000, valor: 1300 },
			{ nivel: 3, hasta: 30000, valor: 1300 }
		]);
		if (error) throw new Error(`Siembra de niveles falló: ${error.message}`);
		// Config de la escalera en un estado conocido (upsert por id fijo).
		const { error: errCfg } = await servicio
			.from('comision_config')
			.upsert({ id: CONFIG_ID, paso: 10000, niveles: 3 });
		if (errCfg) throw new Error(`Siembra de config falló: ${errCfg.message}`);
	});

	afterAll(async () => {
		await limpiarTodo();
	});

	async function valorNivel(nivel: number): Promise<number> {
		const { data } = await servicio.from('comision_niveles').select('valor').eq('nivel', nivel).single();
		return data?.valor ?? -1;
	}

	/** Entrega un pedido sembrado (asignado a domA) transicionando hasta entregado. */
	async function entregarPedido(tarifaBase: number): Promise<{ id: string; numero: string }> {
		const pedido = await sembrarPedido({
			barrioOrigenId: cat.barrioA,
			barrioDestinoId: cat.barrioB,
			estado: 'asignado',
			domiciliarioId: domA.domiciliarioId,
			tarifaBase
		});
		const cDom = clienteComo(domA.token);
		for (const siguiente of ['aceptado', 'recogido', 'en_camino', 'entregado']) {
			const { error } = await cDom.rpc('transicionar_pedido', {
				p_pedido_id: pedido.id,
				p_estado: siguiente,
				p_nota: null,
				p_motivo: null
			});
			expect(error, `→ ${siguiente} falló: ${error?.message}`).toBeNull();
		}
		return pedido;
	}

	describe('comision_niveles: solo el admin escribe', () => {
		test('el admin actualiza el valor de un nivel', async () => {
			const { error } = await clienteComo(admin.token)
				.from('comision_niveles')
				.update({ valor: 2200 })
				.eq('nivel', 2);
			expect(error, `update admin falló: ${error?.message}`).toBeNull();
			expect(await valorNivel(2)).toBe(2200);
		});

		test('un domiciliario o cliente NO pueden escribir (0 filas y valor intacto)', async () => {
			const r1 = await clienteComo(domA.token).from('comision_niveles').update({ valor: 999 }).eq('nivel', 2);
			expect(r1.error).toBeNull();
			expect((r1.data ?? []).length).toBe(0);
			const r2 = await clienteComo(cliente.token).from('comision_niveles').update({ valor: 999 }).eq('nivel', 2);
			expect(r2.error).toBeNull();
			expect((r2.data ?? []).length).toBe(0);
			expect(await valorNivel(2)).toBe(2200);
		});

		test('anon NO puede escribir en comision_niveles', async () => {
			const { error } = await anon.from('comision_niveles').insert({ nivel: 99, hasta: 990000, valor: 100 });
			expect(error, 'anon INSERT debería estar denegado').not.toBeNull();
		});
	});

	describe('RLS de lectura de comision_niveles', () => {
		test('admin y domiciliarios leen los niveles; el cliente ve 0; anon denegado', async () => {
			esperaPermitido(await seleccion(clienteComo(admin.token), 'comision_niveles'), 'admin SELECT niveles');
			esperaPermitido(await seleccion(clienteComo(domA.token), 'comision_niveles'), 'domiciliario SELECT niveles');
			esperaVacio(await seleccion(clienteComo(cliente.token), 'comision_niveles'), 'cliente SELECT niveles');
			esperaDenegado(await seleccion(anon, 'comision_niveles'), 'anon SELECT niveles');
		});
	});

	describe('comision_para_total', () => {
		test('asigna el nivel correcto por el total (límites incluidos)', async () => {
			const cAdmin = clienteComo(admin.token);
			expect((await cAdmin.rpc('comision_para_total', { p_total: 5000 })).data).toBe(1300);
			expect((await cAdmin.rpc('comision_para_total', { p_total: 10000 })).data).toBe(1300); // tope incluido
			expect((await cAdmin.rpc('comision_para_total', { p_total: 15000 })).data).toBe(2200); // nivel 2 actualizado
			expect((await cAdmin.rpc('comision_para_total', { p_total: 25000 })).data).toBe(1300); // nivel 3
			expect((await cAdmin.rpc('comision_para_total', { p_total: 999999 })).data).toBe(1300); // sobre el último
		});

		test('ejecutable por el domiciliario, no por anon', async () => {
			const rDomi = await clienteComo(domA.token).rpc('comision_para_total', { p_total: 15000 });
			expect(rDomi.error).toBeNull();
			expect(rDomi.data).toBe(2200);
			const rAnon = await anon.rpc('comision_para_total', { p_total: 15000 });
			expect(rAnon.error, 'anon no debería ejecutar comision_para_total').not.toBeNull();
		});
	});

	describe('la entrega congela el snapshot del nivel', () => {
		test('al entregar se guarda el valor del nivel según el total del pedido', async () => {
			const barato = await entregarPedido(6000); // total 6000 → nivel 1
			const caro = await entregarPedido(15000); // total 15000 → nivel 2 (2200)
			const { data: filas } = await servicio
				.from('pedidos')
				.select('id, comision')
				.in('id', [barato.id, caro.id]);
			const porId = new Map((filas ?? []).map((f) => [f.id, f.comision]));
			expect(porId.get(barato.id)).toBe(1300);
			expect(porId.get(caro.id)).toBe(2200);
		});

		test('cambiar un nivel después no altera los pedidos ya entregados', async () => {
			// Sube el nivel 2 a 9999 después de las entregas.
			await clienteComo(admin.token).from('comision_niveles').update({ valor: 9999 }).eq('nivel', 2);
			expect(await valorNivel(2)).toBe(9999);

			const { data: entregados } = await servicio
				.from('pedidos')
				.select('comision')
				.eq('domiciliario_id', domA.domiciliarioId)
				.eq('estado', 'entregado');
			expect(entregados?.length).toBeGreaterThan(0);
			for (const p of entregados ?? []) expect(p.comision).toBeGreaterThan(0); // snapshots intactos
			// El pedido de 15.000 conserva su snapshot de 2200.
			const { data: caro } = await servicio
				.from('pedidos')
				.select('comision')
				.eq('total', 15000)
				.eq('estado', 'entregado')
				.limit(1)
				.single();
			expect(caro?.comision).toBe(2200);
		});
	});

	describe('abonos (pagos_domiciliarios, solo admin)', () => {
		test('el admin registra un abono contra la deuda', async () => {
			const { data, error } = await clienteComo(admin.token).rpc('registrar_pago_domiciliario', {
				p_domiciliario_id: domA.domiciliarioId,
				p_valor: 1500,
				p_nota: 'Abono en efectivo'
			});
			expect(error, `RPC falló: ${error?.message}`).toBeNull();
			expect(data?.valor).toBe(1500);
			expect(data?.nota).toBe('Abono en efectivo');
			expect(data?.domiciliario_id).toBe(domA.domiciliarioId);

			const { data: pago } = await servicio
				.from('pagos_domiciliarios')
				.select('valor, nota, registrado_por')
				.eq('id', data.id)
				.single();
			expect(pago?.registrado_por).toBe(admin.userId);
			expect(pago?.valor).toBe(1500);
		});

		test('un abono no válido (≤ 0) es rechazado', async () => {
			const { data, error } = await clienteComo(admin.token).rpc('registrar_pago_domiciliario', {
				p_domiciliario_id: domA.domiciliarioId,
				p_valor: 0,
				p_nota: null
			});
			expect(data).toBeNull();
			expect(error?.message ?? '').toMatch(/mayor que cero/);
		});

		test('un domiciliario o cliente no pueden registrar abonos', async () => {
			const r1 = await clienteComo(domA.token).rpc('registrar_pago_domiciliario', {
				p_domiciliario_id: domA.domiciliarioId,
				p_valor: 100,
				p_nota: null
			});
			expect(r1.data).toBeNull();
			expect(r1.error?.message ?? '').toMatch(/Solo un administrador/);

			const r2 = await clienteComo(cliente.token).rpc('registrar_pago_domiciliario', {
				p_domiciliario_id: domA.domiciliarioId,
				p_valor: 100,
				p_nota: null
			});
			expect(r2.data).toBeNull();
			expect(r2.error?.message ?? '').toMatch(/Solo un administrador/);
		});
	});

	describe('bloqueo por falta de pago', () => {
		test('el admin bloquea al domiciliario', async () => {
			const { data, error } = await clienteComo(admin.token).rpc('bloquear_domiciliario', {
				p_domiciliario_id: domA.domiciliarioId,
				p_bloqueado: true
			});
			expect(error).toBeNull();
			expect(data?.bloqueado).toBe(true);
			const { data: fila } = await servicio
				.from('domiciliarios')
				.select('bloqueado')
				.eq('id', domA.domiciliarioId)
				.single();
			expect(fila?.bloqueado).toBe(true);
		});

		test('un bloqueado NO recibe pedidos nuevos (asignar falla con el motivo)', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});
			const { data, error } = await clienteComo(admin.token).rpc('asignar_domiciliario', {
				p_pedido_id: pedido.id,
				p_domiciliario_id: domA.domiciliarioId
			});
			expect(data).toBeNull();
			expect(error?.message ?? '').toMatch(/bloqueado por falta de pago/);
		});

		test('un bloqueado SÍ puede terminar los pedidos que ya tiene en curso', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'asignado',
				domiciliarioId: domA.domiciliarioId
			});
			const { data, error } = await clienteComo(domA.token).rpc('transicionar_pedido', {
				p_pedido_id: pedido.id,
				p_estado: 'aceptado',
				p_nota: null,
				p_motivo: null
			});
			expect(error, `transición bloqueado falló: ${error?.message}`).toBeNull();
			expect(data?.estado).toBe('aceptado');
		});

		test('solo el admin puede bloquear/desbloquear', async () => {
			const r = await clienteComo(domA.token).rpc('bloquear_domiciliario', {
				p_domiciliario_id: domA.domiciliarioId,
				p_bloqueado: false
			});
			expect(r.data).toBeNull();
			expect(r.error?.message ?? '').toMatch(/Solo un administrador/);
		});

		test('el admin desbloquea y el domiciliario vuelve a recibir pedidos', async () => {
			const { error } = await clienteComo(admin.token).rpc('bloquear_domiciliario', {
				p_domiciliario_id: domA.domiciliarioId,
				p_bloqueado: false
			});
			expect(error).toBeNull();

			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});
			const { data, error: errAsignar } = await clienteComo(admin.token).rpc('asignar_domiciliario', {
				p_pedido_id: pedido.id,
				p_domiciliario_id: domA.domiciliarioId
			});
			expect(errAsignar, `asignar tras desbloqueo falló: ${errAsignar?.message}`).toBeNull();
			expect(data?.estado).toBe('asignado');
		});
	});

	describe('RLS: pagos aislados por domiciliario', () => {
		test('el dueño ve sus pagos; otro domiciliario ve 0; el admin ve todos', async () => {
			esperaPermitido(
				await seleccion(clienteComo(domA.token), 'pagos_domiciliarios', {
					columna: 'domiciliario_id',
					valor: domA.domiciliarioId
				}),
				'domiciliario dueño SELECT pagos'
			);
			esperaVacio(
				await seleccion(clienteComo(domB.token), 'pagos_domiciliarios', {
					columna: 'domiciliario_id',
					valor: domA.domiciliarioId
				}),
				'domiciliario ajeno SELECT pagos del dueño'
			);
			esperaPermitido(await seleccion(clienteComo(admin.token), 'pagos_domiciliarios'), 'admin SELECT pagos');
		});

		test('anon no puede leer pagos', async () => {
			esperaDenegado(await seleccion(anon, 'pagos_domiciliarios'), 'anon SELECT pagos');
		});
	});

	describe('comision_config: solo el admin la lee y escribe (Fase 12)', () => {
		test('admin lee la config; domiciliario y cliente ven 0; anon denegado', async () => {
			esperaPermitido(await seleccion(clienteComo(admin.token), 'comision_config'), 'admin SELECT config');
			esperaVacio(await seleccion(clienteComo(domA.token), 'comision_config'), 'domiciliario SELECT config');
			esperaVacio(await seleccion(clienteComo(cliente.token), 'comision_config'), 'cliente SELECT config');
			esperaDenegado(await seleccion(anon, 'comision_config'), 'anon SELECT config');
		});

		test('solo el admin puede actualizar la config', async () => {
			const r = await actualizacion(clienteComo(admin.token), 'comision_config', 'id', CONFIG_ID, {
				paso: 12000
			});
			expect(r.error, `update admin config falló: ${r.error?.message}`).toBeNull();
			expect(r.filas).toBe(1);

			const rDomi = await actualizacion(clienteComo(domA.token), 'comision_config', 'id', CONFIG_ID, { paso: 999 });
			expect(rDomi.error).toBeNull();
			expect(rDomi.filas).toBe(0);
			const rCli = await actualizacion(clienteComo(cliente.token), 'comision_config', 'id', CONFIG_ID, { paso: 999 });
			expect(rCli.error).toBeNull();
			expect(rCli.filas).toBe(0);

			const { data } = await servicio.from('comision_config').select('paso').eq('id', CONFIG_ID).single();
			expect(data?.paso).toBe(12000);
			// Restaura el paso para no afectar otras corridas.
			await servicio.from('comision_config').update({ paso: 10000 }).eq('id', CONFIG_ID);
		});

		test('anon no puede escribir en comision_config', async () => {
			const { error } = await anon.from('comision_config').insert({ id: CONFIG_ID, paso: 100, niveles: 1 });
			expect(error, 'anon INSERT config debería estar denegado').not.toBeNull();
		});
	});

	describe('reconfigurar_escalera: reacomoda toda la escalera (Fase 12)', () => {
		test('el admin cambia el paso y la cantidad; conserva valores por posición', async () => {
			const r = await clienteComo(admin.token).rpc('reconfigurar_escalera', { p_paso: 15000, p_niveles: 3 });
			expect(r.error, `reconfig falló: ${r.error?.message}`).toBeNull();
			expect(r.data).toMatchObject({ paso: 15000, niveles: 3 });

			const { data: niveles } = await servicio.from('comision_niveles').select('nivel, hasta, valor').order('nivel');
			expect(niveles).toHaveLength(3);
			expect(niveles?.map((n) => n.hasta)).toEqual([15000, 30000, 45000]);
			// Valores preservados por posición (el nivel 2 quedó en 9999 en una prueba anterior).
			expect(niveles?.map((n) => n.valor)).toEqual([1300, 9999, 1300]);

			const { data: cfg } = await servicio
				.from('comision_config')
				.select('paso, niveles')
				.eq('id', CONFIG_ID)
				.single();
			expect(cfg).toMatchObject({ paso: 15000, niveles: 3 });
		});

		test('comision_para_total usa la escalera reacomodada', async () => {
			// Tras el test anterior: nivel 1 hasta 15.000 (1300), nivel 2 hasta
			// 30.000 (9999), nivel 3 hasta 45.000 (1300).
			const cAdmin = clienteComo(admin.token);
			expect((await cAdmin.rpc('comision_para_total', { p_total: 10000 })).data).toBe(1300);
			expect((await cAdmin.rpc('comision_para_total', { p_total: 20000 })).data).toBe(9999);
			expect((await cAdmin.rpc('comision_para_total', { p_total: 40000 })).data).toBe(1300);
			expect((await cAdmin.rpc('comision_para_total', { p_total: 999999 })).data).toBe(1300); // sobre el último
		});

		test('agregar y quitar niveles al cambiar la cantidad', async () => {
			// De 3 a 5: crea los faltantes con el valor del último nivel vigente.
			const r5 = await clienteComo(admin.token).rpc('reconfigurar_escalera', { p_paso: 10000, p_niveles: 5 });
			expect(r5.error).toBeNull();
			const { data: n5 } = await servicio.from('comision_niveles').select('nivel, hasta, valor').order('nivel');
			expect(n5).toHaveLength(5);
			expect(n5?.map((n) => n.hasta)).toEqual([10000, 20000, 30000, 40000, 50000]);
			expect(n5?.map((n) => n.valor)).toEqual([1300, 9999, 1300, 1300, 1300]);

			// De 5 a 2: elimina los que sobran.
			const r2 = await clienteComo(admin.token).rpc('reconfigurar_escalera', { p_paso: 10000, p_niveles: 2 });
			expect(r2.error).toBeNull();
			const { data: n2 } = await servicio.from('comision_niveles').select('nivel, hasta').order('nivel');
			expect(n2?.map((n) => n.hasta)).toEqual([10000, 20000]);
		});

		test('parámetros inválidos son rechazados (paso ≤ 0, niveles < 1)', async () => {
			const r0 = await clienteComo(admin.token).rpc('reconfigurar_escalera', { p_paso: 0, p_niveles: 3 });
			expect(r0.data).toBeNull();
			expect(r0.error?.message ?? '').toMatch(/paso/i);
			const rN = await clienteComo(admin.token).rpc('reconfigurar_escalera', { p_paso: 10000, p_niveles: 0 });
			expect(rN.data).toBeNull();
			expect(rN.error?.message ?? '').toMatch(/cantidad de niveles/i);
		});

		test('domiciliario y cliente no pueden reconfigurar; anon tampoco', async () => {
			const rD = await clienteComo(domA.token).rpc('reconfigurar_escalera', { p_paso: 10000, p_niveles: 2 });
			expect(rD.data).toBeNull();
			expect(rD.error?.message ?? '').toMatch(/Solo un administrador/);
			const rC = await clienteComo(cliente.token).rpc('reconfigurar_escalera', { p_paso: 10000, p_niveles: 2 });
			expect(rC.data).toBeNull();
			expect(rC.error?.message ?? '').toMatch(/Solo un administrador/);
			const rA = await anon.rpc('reconfigurar_escalera', { p_paso: 10000, p_niveles: 2 });
			expect(rA.error, 'anon no debería ejecutar reconfigurar_escalera').not.toBeNull();
		});

		test('restaura la escalera al estado de la corrida', async () => {
			// El test anterior dejó 2 niveles; al volver a 3, el nivel 3 se recrea
			// con el valor del tope vigente (9999, el del nivel 2 personalizado).
			const r = await clienteComo(admin.token).rpc('reconfigurar_escalera', { p_paso: 10000, p_niveles: 3 });
			expect(r.error).toBeNull();
			const { data: niveles } = await servicio.from('comision_niveles').select('nivel, hasta, valor').order('nivel');
			expect(niveles?.map((n) => n.hasta)).toEqual([10000, 20000, 30000]);
			expect(niveles?.map((n) => n.valor)).toEqual([1300, 9999, 9999]);
		});
	});
});
