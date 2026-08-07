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
	PREFIJO,
	limpiarTodo,
	type Catalogo,
	type UsuarioRol
} from './helpers';

/**
 * RPCs contra la base REAL (mismos casos que la Parte 1, pero ejecutados
 * contra Postgres): calcular_tarifa, crear_pedido, consultar_pedido,
 * cancelar_pedido_cliente, transicionar_pedido y asignar_domiciliario.
 * La BD es la autoridad: toda validación se prueba aquí, no en el cliente.
 */
describe.skipIf(!RLS_DISPONIBLE)('RPCs (base real)', () => {
	let servicio: ReturnType<typeof clienteService>;
	let anon: ReturnType<typeof clienteAnon>;
	let cat: Catalogo;
	let admin: UsuarioRol;
	let domA: UsuarioRol & { domiciliarioId: string };
	let domB: UsuarioRol & { domiciliarioId: string };
	let cliente: UsuarioRol;
	// Pares extra para simetría y sin-tarifa.
	let zonaC: string;
	let zonaD: string;
	let zonaE: string;
	let barrioC: string;
	let barrioD: string;
	let barrioE: string;

	beforeAll(async () => {
		servicio = clienteService();
		anon = clienteAnon();
		cat = await sembrarCatalogo();
		admin = await crearAdmin();
		domA = await crearDomiciliario();
		domB = await crearDomiciliario();
		cliente = await crearCliente();

		// Par C→D con tarifa SOLO en sentido inverso (D→C = 7500) y par C→E sin tarifa.
		zonaC = `zona_${PREFIJO}_c`;
		zonaD = `zona_${PREFIJO}_d`;
		zonaE = `zona_${PREFIJO}_e`;
		const { error: errZonas } = await servicio.from('zonas').insert([
			{ id: zonaC, nombre: 'Zona C test', tipo: 'urbana' },
			{ id: zonaD, nombre: 'Zona D test', tipo: 'urbana' },
			{ id: zonaE, nombre: 'Zona E test', tipo: 'urbana' }
		]);
		if (errZonas) throw new Error(`zonas extra falló: ${errZonas.message}`);
		const { data: barrios, error: errBarrios } = await servicio
			.from('barrios')
			.insert([
				{ nombre: `Barrio C ${PREFIJO}`, zona_id: zonaC },
				{ nombre: `Barrio D ${PREFIJO}`, zona_id: zonaD },
				{ nombre: `Barrio E ${PREFIJO}`, zona_id: zonaE }
			])
			.select('id, nombre');
		if (errBarrios || !barrios) throw new Error(`barrios extra falló: ${errBarrios?.message}`);
		barrioC = barrios.find((b) => b.nombre === `Barrio C ${PREFIJO}`)!.id;
		barrioD = barrios.find((b) => b.nombre === `Barrio D ${PREFIJO}`)!.id;
		barrioE = barrios.find((b) => b.nombre === `Barrio E ${PREFIJO}`)!.id;
		const { error: errInversa } = await servicio.from('tarifas').insert({
			zona_origen_id: zonaD,
			zona_destino_id: zonaC,
			valor: 7500
		});
		if (errInversa) throw new Error(`tarifa inversa falló: ${errInversa.message}`);
	});

	afterAll(async () => {
		await limpiarTodo();
	});

	describe('calcular_tarifa (público)', () => {
		test('tarifa directa', async () => {
			const { data, error } = await anon.rpc('calcular_tarifa', {
				p_barrio_origen: cat.barrioA,
				p_barrio_destino: cat.barrioB
			});
			expect(error, `calcular_tarifa falló: ${error?.message}`).toBeNull();
			expect(data).toBe(6000);
		});

		test('fallback simétrico (sentido inverso)', async () => {
			const { data, error } = await anon.rpc('calcular_tarifa', {
				p_barrio_origen: barrioC,
				p_barrio_destino: barrioD
			});
			expect(error).toBeNull();
			expect(data).toBe(7500);
		});

		test('trayecto sin tarifa devuelve null (fallo controlado, no excepción)', async () => {
			const { data, error } = await anon.rpc('calcular_tarifa', {
				p_barrio_origen: barrioC,
				p_barrio_destino: barrioE
			});
			expect(error).toBeNull();
			expect(data).toBeNull();
		});

		test('barrio inexistente devuelve null', async () => {
			const { data } = await anon.rpc('calcular_tarifa', {
				p_barrio_origen: '00000000-0000-0000-0000-000000000000',
				p_barrio_destino: cat.barrioB
			});
			expect(data).toBeNull();
		});

		test('zona roja devuelve null', async () => {
			const { data } = await anon.rpc('calcular_tarifa', {
				p_barrio_origen: cat.barrioRojo,
				p_barrio_destino: cat.barrioB
			});
			expect(data).toBeNull();
		});

		test('barrio sin sector asignado devuelve null', async () => {
			const { data } = await anon.rpc('calcular_tarifa', {
				p_barrio_origen: cat.barrioSinSector,
				p_barrio_destino: cat.barrioB
			});
			expect(data).toBeNull();
		});
	});

	describe('crear_pedido (público): recalcula tarifa y total en la BD', () => {
		test('crea el pedido con la tarifa real y estado pendiente', async () => {
			const { data, error } = await anon.rpc('crear_pedido', {
				p_barrio_origen_id: cat.barrioA,
				p_direccion_origen: 'Calle 10 # 15-20',
				p_barrio_destino_id: cat.barrioB,
				p_direccion_destino: 'Carrera 19 # 20-30',
				p_observaciones: null,
				p_recargos: null
			});
			expect(error, `crear_pedido falló: ${error?.message}`).toBeNull();
			expect(data?.numero).toBeTruthy();
			expect(data?.tarifa_base).toBe(6000);
			expect(data?.total).toBe(6000);
			expect(data?.estado).toBe('pendiente');
			expect(data?.recargo_total).toBe(0);
			expect(data?.recargos).toEqual([]);
		});

		test('suma los recargos activos y guarda el snapshot con nombre y valor', async () => {
			const { data, error } = await anon.rpc('crear_pedido', {
				p_barrio_origen_id: cat.barrioA,
				p_direccion_origen: 'x',
				p_barrio_destino_id: cat.barrioB,
				p_direccion_destino: 'y',
				p_observaciones: null,
				p_recargos: [cat.recargoCompra.codigo, cat.recargoPeso.codigo]
			});
			expect(error, `crear_pedido falló: ${error?.message}`).toBeNull();
			expect(data?.tarifa_base).toBe(6000);
			expect(data?.recargo_total).toBe(2000 + 3000);
			expect(data?.total).toBe(6000 + 2000 + 3000);
			expect(data?.recargos).toEqual([
				{ codigo: cat.recargoCompra.codigo, nombre: cat.recargoCompra.nombre, valor: 2000 },
				{ codigo: cat.recargoPeso.codigo, nombre: cat.recargoPeso.nombre, valor: 3000 }
			]);
		});

		test('sin tarifa disponible devuelve null (el cliente nunca manda el precio)', async () => {
			const { data, error } = await anon.rpc('crear_pedido', {
				p_barrio_origen_id: barrioC,
				p_direccion_origen: 'x',
				p_barrio_destino_id: barrioE,
				p_direccion_destino: 'y',
				p_observaciones: null,
				p_recargos: null
			});
			expect(error).toBeNull();
			expect(data).toBeNull();
		});
	});

	describe('consultar_pedido (público, por código)', () => {
		test('devuelve el pedido con su historial para un código válido', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});
			const { data, error } = await anon.rpc('consultar_pedido', { p_numero: pedido.numero });
			expect(error, `consultar_pedido falló: ${error?.message}`).toBeNull();
			expect(data?.pedido?.numero).toBe(pedido.numero);
			expect(Array.isArray(data?.historial)).toBe(true);
		});

		test('código desconocido devuelve null', async () => {
			const { data, error } = await anon.rpc('consultar_pedido', {
				p_numero: 'NOEXISTE1'
			});
			expect(error).toBeNull();
			expect(data).toBeNull();
		});
	});

	describe('cancelar_pedido_cliente (público, solo pendiente)', () => {
		test('cancela un pedido pendiente y guarda el motivo', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});
			const { data, error } = await anon.rpc('cancelar_pedido_cliente', {
				p_numero: pedido.numero,
				p_motivo: 'Ya no necesito el servicio'
			});
			expect(error, `cancelar_pedido_cliente falló: ${error?.message}`).toBeNull();
			expect(data?.estado).toBe('cancelado');
			expect(data?.motivo_cancelacion).toBe('Ya no necesito el servicio');

			const { data: fila } = await servicio
				.from('pedidos')
				.select('estado, motivo_cancelacion')
				.eq('id', pedido.id)
				.single();
			expect(fila?.estado).toBe('cancelado');
			expect(fila?.motivo_cancelacion).toBe('Ya no necesito el servicio');
		});

		test('no puede cancelar un pedido ya asignado', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'asignado',
				domiciliarioId: domA.domiciliarioId
			});
			const { data, error } = await anon.rpc('cancelar_pedido_cliente', {
				p_numero: pedido.numero,
				p_motivo: 'Lo intento igual'
			});
			expect(data).toBeNull();
			expect(error).not.toBeNull();
			expect(error?.message ?? '').toMatch(/Solo se puede cancelar un pedido que siga pendiente/);
		});

		test('código desconocido es un error explícito', async () => {
			const { data, error } = await anon.rpc('cancelar_pedido_cliente', {
				p_numero: 'NOEXISTE2',
				p_motivo: 'x'
			});
			expect(data).toBeNull();
			expect(error).not.toBeNull();
		});
	});

	describe('transicionar_pedido (máquina de estados en la BD)', () => {
		test('el domiciliario dueño avanza toda su cadena asignado → … → entregado', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'asignado',
				domiciliarioId: domA.domiciliarioId
			});
			const cDom = clienteComo(domA.token);
			for (const siguiente of ['aceptado', 'recogido', 'en_camino', 'entregado']) {
				const { data, error } = await cDom.rpc('transicionar_pedido', {
					p_pedido_id: pedido.id,
					p_estado: siguiente,
					p_nota: null,
					p_motivo: null
				});
				expect(error, `→ ${siguiente} falló: ${error?.message}`).toBeNull();
				expect(data?.estado).toBe(siguiente);
			}
		});

		test('un domiciliario ajeno NO puede transicionar el pedido de otro', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'asignado',
				domiciliarioId: domA.domiciliarioId
			});
			const { data, error } = await clienteComo(domB.token).rpc('transicionar_pedido', {
				p_pedido_id: pedido.id,
				p_estado: 'aceptado',
				p_nota: null,
				p_motivo: null
			});
			expect(data).toBeNull();
			expect(error?.message ?? '').toMatch(/No tienes permisos para cambiar este pedido/);
		});

		test('el admin puede cancelar desde un estado activo y guarda el motivo', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'aceptado',
				domiciliarioId: domA.domiciliarioId
			});
			const { data, error } = await clienteComo(admin.token).rpc('transicionar_pedido', {
				p_pedido_id: pedido.id,
				p_estado: 'cancelado',
				p_nota: null,
				p_motivo: 'Cliente no pagó'
			});
			expect(error, `cancelación admin falló: ${error?.message}`).toBeNull();
			expect(data?.estado).toBe('cancelado');
			const { data: fila } = await servicio
				.from('pedidos')
				.select('motivo_cancelacion')
				.eq('id', pedido.id)
				.single();
			expect(fila?.motivo_cancelacion).toBe('Cliente no pagó');
		});

		test('transición inválida (sin saltos) es rechazada con el mensaje de la BD', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'asignado',
				domiciliarioId: domA.domiciliarioId
			});
			const { data, error } = await clienteComo(domA.token).rpc('transicionar_pedido', {
				p_pedido_id: pedido.id,
				p_estado: 'entregado',
				p_nota: null,
				p_motivo: null
			});
			expect(data).toBeNull();
			expect(error?.message ?? '').toMatch(/No se puede pasar de «asignado» a «entregado»/);
		});

		test('transicionar al mismo estado es rechazado', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'asignado',
				domiciliarioId: domA.domiciliarioId
			});
			const { data, error } = await clienteComo(admin.token).rpc('transicionar_pedido', {
				p_pedido_id: pedido.id,
				p_estado: 'asignado',
				p_nota: null,
				p_motivo: null
			});
			expect(data).toBeNull();
			expect(error?.message ?? '').toMatch(/ya está en/);
		});

		test('un cliente (sin rol) no puede transicionar nada', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'asignado',
				domiciliarioId: domA.domiciliarioId
			});
			const { data, error } = await clienteComo(cliente.token).rpc('transicionar_pedido', {
				p_pedido_id: pedido.id,
				p_estado: 'cancelado',
				p_nota: null,
				p_motivo: null
			});
			expect(data).toBeNull();
			expect(error).not.toBeNull();
		});
	});

	describe('asignar_domiciliario (solo admin)', () => {
		test('el admin asigna un pedido pendiente → asignado', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});
			const { data, error } = await clienteComo(admin.token).rpc('asignar_domiciliario', {
				p_pedido_id: pedido.id,
				p_domiciliario_id: domA.domiciliarioId
			});
			expect(error, `asignar falló: ${error?.message}`).toBeNull();
			expect(data?.estado).toBe('asignado');
		});

		test('un cliente NO puede asignar domiciliarios', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});
			const { data, error } = await clienteComo(cliente.token).rpc('asignar_domiciliario', {
				p_pedido_id: pedido.id,
				p_domiciliario_id: domA.domiciliarioId
			});
			expect(data).toBeNull();
			expect(error?.message ?? '').toMatch(/Solo un administrador puede asignar/);
		});

		test('asignar a un domiciliario inactivo es un error', async () => {
			const inactivo = await crearDomiciliario(false);
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});
			const { data, error } = await clienteComo(admin.token).rpc('asignar_domiciliario', {
				p_pedido_id: pedido.id,
				p_domiciliario_id: inactivo.domiciliarioId
			});
			expect(data).toBeNull();
			expect(error?.message ?? '').toMatch(/no existe o está inactivo/);
		});

		test('asignar un pedido ya entregado es un error', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'entregado',
				domiciliarioId: domA.domiciliarioId
			});
			const { data, error } = await clienteComo(admin.token).rpc('asignar_domiciliario', {
				p_pedido_id: pedido.id,
				p_domiciliario_id: domB.domiciliarioId
			});
			expect(data).toBeNull();
			expect(error?.message ?? '').toMatch(/Solo se pueden asignar pedidos pendientes/);
		});
	});
});
