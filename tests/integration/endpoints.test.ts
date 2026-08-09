import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { INTEGRACION_DISPONIBLE, peticion } from './http';
import {
	PASSWORD_TEST,		PEDIDOS_HTTP,
		loginEnApp,
		sesionConToken,
		limpiarIntegracion,
	direccionOrigenTest,
	direccionDestinoTest,
	clienteService,		crearAdmin,
		crearDomiciliario,
		crearCliente,
		sembrarCatalogo,
		sembrarPedido,
		PREFIJO,
	type Catalogo,
	type SesionApp,
	type UsuarioRol
} from './helpers';

/**
 * Flujo completo de pedidos a través de los endpoints reales de la app:
 * request → validación → Supabase (RPCs + RLS reales) → response. Cubre la
 * exigencia de la Parte 3 de que cada acción valide los datos de entrada
 * ANTES de tocar la base de datos (los 400 no crean filas) y que los errores
 * de Supabase lleguen a la UI como mensajes legibles, no como 500.
 */
describe.skipIf(!INTEGRACION_DISPONIBLE)('Endpoints de pedidos (SvelteKit ↔ Supabase real)', () => {
	let cat: Catalogo;
	let admin: UsuarioRol;
	let domA: UsuarioRol & { domiciliarioId: string };
	let domB: UsuarioRol & { domiciliarioId: string };
	let cliente: UsuarioRol;
	let sesionAdmin: SesionApp;
	let sesionDomA: SesionApp;
	let sesionCliente: SesionApp;

	/** Mensaje de error de la respuesta (SvelteKit usa {message} en los throw error). */
	function mensaje(r: { data: unknown }): string {
		const d = r.data as { message?: string; error?: string } | null;
		return d?.error ?? d?.message ?? '';
	}

	/** Cuenta pedidos creados vía endpoint (direcciones distintivas de la corrida). */
	async function contarPedidosEndpoint(): Promise<number> {
		const { count, error } = await clienteService()
			.from('pedidos')
			.select('*', { count: 'exact', head: true })
			.like('direccion_origen', `Dir origen integración ${PREFIJO}%`);
		if (error) throw new Error(`contar pedidos falló: ${error.message}`);
		return count ?? 0;
	}

	async function crearPedidoHttp(extra: Record<string, unknown> = {}) {
		const r = await peticion<{ error?: string; data?: { numero: string } }>('/api/pedidos', {
			metodo: 'POST',
			cuerpo: {
				barrio_origen: cat.barrioA,
				barrio_destino: cat.barrioB,
				direccion_origen: direccionOrigenTest(),
				direccion_destino: direccionDestinoTest(),
				// Fase 14: decisión explícita de recargos.
				recargos_confirmados_no_aplica: true,
				...extra
			}
		});
		if (r.data?.data?.numero) PEDIDOS_HTTP.push(r.data.data.numero);
		return r;
	}

	beforeAll(async () => {
		cat = await sembrarCatalogo();
		admin = await crearAdmin();
		domA = await crearDomiciliario();
		domB = await crearDomiciliario();
		cliente = await crearCliente();
		sesionAdmin = await loginEnApp(admin.email, PASSWORD_TEST);
		sesionDomA = await loginEnApp(domA.email, PASSWORD_TEST);
		// El cliente no puede hacer login por la app (no tiene rol): se usa su
		// token de Supabase directamente (sesión de Supabase activa en el navegador).
		sesionCliente = sesionConToken(cliente.token);
	});

	afterAll(async () => {
		await limpiarIntegracion();
	});

	describe('POST /api/pedidos — crear pedido (público)', () => {
		test('crea el pedido y la BD recalcula tarifa + recargos (el cliente nunca manda el precio)', async () => {
			const r = await crearPedidoHttp({
				recargos: [cat.recargoCompra.codigo, cat.recargoPeso.codigo]
			});
			expect(r.status).toBe(200);
			const d = r.data!.data!;
			expect(d.numero).toMatch(/^[A-Z0-9]{6}$/);
			expect(d).toMatchObject({
				tarifa_base: 6000,
				recargo_total: 2000 + 3000,
				total: 6000 + 2000 + 3000,
				estado: 'pendiente'
			});

			// Verificado contra la base REAL, no contra la respuesta.
			const { data: fila, error } = await clienteService()
				.from('pedidos')
				.select('numero, tarifa_base, recargo_total, total, estado')
				.eq('numero', d.numero)
				.single();
			expect(error).toBeNull();
			expect(fila).toMatchObject({ tarifa_base: 6000, recargo_total: 5000, total: 11000, estado: 'pendiente' });
		});

		test('dirección faltante → 400 y NO crea ninguna fila', async () => {
			const antes = await contarPedidosEndpoint();
			const r = await crearPedidoHttp({ direccion_destino: '' });
			expect(r.status).toBe(400);
			expect(mensaje(r)).toMatch(/dirección de destino es obligatoria/);
			expect(await contarPedidosEndpoint()).toBe(antes);
		});

		test('sin recargos y sin «No aplica» → 400 (decisión obligatoria, Fase 14)', async () => {
			const antes = await contarPedidosEndpoint();
			const r = await crearPedidoHttp({ recargos_confirmados_no_aplica: false });
			expect(r.status).toBe(400);
			expect(mensaje(r)).toMatch(/No aplica/);
			expect(await contarPedidosEndpoint()).toBe(antes);
		});

		test('compra/diligencia sin origen → 200 con tarifa_base 0 (sin tarifa automática)', async () => {
			const r = await crearPedidoHttp({
				tipo_servicio: 'compra_diligencia',
				barrio_origen: '',
				direccion_origen: ''
			});
			expect(r.status, mensaje(r)).toBe(200);
			expect(r.data?.data).toMatchObject({ tarifa_base: 0, estado: 'pendiente' });

			const { data: fila, error } = await clienteService()
				.from('pedidos')
				.select('tipo_servicio, tarifa_base, barrio_origen_id, recargos_confirmados_no_aplica')
				.eq('numero', r.data?.data?.numero)
				.single();
			expect(error).toBeNull();
			expect(fila).toMatchObject({
				tipo_servicio: 'compra_diligencia',
				tarifa_base: 0,
				barrio_origen_id: null,
				recargos_confirmados_no_aplica: true
			});
		});

		test('domicilio sin origen → 400 (el origen sigue siendo obligatorio)', async () => {
			const antes = await contarPedidosEndpoint();
			const r = await crearPedidoHttp({ barrio_origen: '', direccion_origen: '' });
			expect(r.status).toBe(400);
			expect(mensaje(r)).toMatch(/barrio de origen/);
			expect(await contarPedidosEndpoint()).toBe(antes);
		});

		test('más de 15 recargos → 400 y no crea fila', async () => {
			const antes = await contarPedidosEndpoint();
			const muchos = Array.from({ length: 16 }, (_, i) => `codigo_${i}`);
			const r = await crearPedidoHttp({ recargos: muchos });
			expect(r.status).toBe(400);
			expect(await contarPedidosEndpoint()).toBe(antes);
		});

		test('recargo inactivo → 400 con error legible de la BD (integridad, no silencio)', async () => {
			const antes = await contarPedidosEndpoint();
			const r = await crearPedidoHttp({ recargos: [cat.recargoInactivo.codigo] });
			expect(r.status).toBe(400);
			expect(mensaje(r)).toMatch(/Recargo inválido o inactivo/);
			expect(await contarPedidosEndpoint()).toBe(antes);
		});

		test('barrio inexistente / zona no disponible → 400 con mensaje claro (no 500)', async () => {
			for (const barrio of ['00000000-0000-0000-0000-000000000000', cat.barrioRojo]) {
				const r = await peticion<{ error: string }>('/api/pedidos', {
					metodo: 'POST',
					cuerpo: {
						barrio_origen: barrio,
						barrio_destino: cat.barrioB,
						direccion_origen: direccionOrigenTest(),
						direccion_destino: direccionDestinoTest(),
						recargos_confirmados_no_aplica: true
					}
				});
				expect(r.status).toBe(400);
				expect(r.data?.error).toMatch(/No hay tarifa disponible/);
			}
		});

		test('dirección demasiado larga → 400', async () => {
			const r = await crearPedidoHttp({ direccion_origen: 'x'.repeat(301) });
			expect(r.status).toBe(400);
			expect(mensaje(r)).toMatch(/demasiado largas/);
		});
	});

	describe('POST /api/calcular_tarifa', () => {
		test('trajecto con tarifa → 200 con precio y motivo ok', async () => {
			const r = await peticion<{ data: number | null; meta: { motivo: string } }>('/api/calcular_tarifa', {
				metodo: 'POST',
				cuerpo: { barrio_origen: cat.barrioA, barrio_destino: cat.barrioB }
			});
			expect(r.status).toBe(200);
			expect(r.data?.data).toBe(6000);
			expect(r.data?.meta.motivo).toBe('ok');
		});

		test('zona roja / sin tarifa → fallo controlado con motivo, no excepción', async () => {
			const roja = await peticion<{ data: number | null; meta: { motivo: string } }>('/api/calcular_tarifa', {
				metodo: 'POST',
				cuerpo: { barrio_origen: cat.barrioRojo, barrio_destino: cat.barrioB }
			});
			expect(roja.status).toBe(200);
			expect(roja.data?.data).toBeNull();
			expect(roja.data?.meta.motivo).toBe('zona_no_disponible');

			const sinTarifa = await peticion<{ data: number | null; meta: { motivo: string } }>('/api/calcular_tarifa', {
				metodo: 'POST',
				cuerpo: { barrio_origen: cat.barrioA, barrio_destino: cat.barrioA }
			});
			expect(sinTarifa.status).toBe(200);
			expect(sinTarifa.data?.data).toBeNull();
			expect(sinTarifa.data?.meta.motivo).toBe('sin_tarifa');
		});

		test('faltan barrios → 400', async () => {
			const r = await peticion('/api/calcular_tarifa', { metodo: 'POST', cuerpo: {} });
			expect(r.status).toBe(400);
		});
	});

	describe('POST /api/pedidos/[id]/estado — máquina de estados', () => {
		test('admin cancela un pedido pendiente y guarda el motivo (BD + historial)', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});
			const r = await peticion<{ error?: string; data?: { estado: string } }>(`/api/pedidos/${pedido.id}/estado`, {
				metodo: 'POST',
				cuerpo: { estado: 'cancelado', motivo: 'Cliente no pagó' },
				jar: sesionAdmin.jar
			});
			expect(r.status).toBe(200);
			expect(r.data?.data?.estado).toBe('cancelado');

			const { data: fila } = await clienteService()
				.from('pedidos')
				.select('estado, motivo_cancelacion')
				.eq('id', pedido.id)
				.single();
			expect(fila?.estado).toBe('cancelado');
			expect(fila?.motivo_cancelacion).toBe('Cliente no pagó');
			const { data: historial } = await clienteService()
				.from('historial_estados')
				.select('estado')
				.eq('pedido_id', pedido.id);
			expect(historial?.map((h) => h.estado)).toContain('cancelado');
		});

		test('estado inválido → 400 sin tocar la BD', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});
			const r = await peticion<{ error: string }>(`/api/pedidos/${pedido.id}/estado`, {
				metodo: 'POST',
				cuerpo: { estado: 'entregadox' },
				jar: sesionAdmin.jar
			});
			expect(r.status).toBe(400);
			expect(r.data?.error).toMatch(/Estado inválido/);
			const { data: fila } = await clienteService()
				.from('pedidos')
				.select('estado')
				.eq('id', pedido.id)
				.single();
			expect(fila?.estado).toBe('pendiente');
		});

		test('transición prohibida para el rol → 400 con el mensaje de la máquina (fail-fast, BD intacta)', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});
			const r = await peticion<{ error: string }>(`/api/pedidos/${pedido.id}/estado`, {
				metodo: 'POST',
				cuerpo: { estado: 'entregado' },
				jar: sesionAdmin.jar
			});
			expect(r.status).toBe(400);
			expect(r.data?.error).toMatch(/No se puede pasar de «pendiente» a «entregado»/);
		});

		test('el domiciliario asignado avanza toda su cadena asignado → … → entregado', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'asignado',
				domiciliarioId: domA.domiciliarioId
			});
			for (const siguiente of ['aceptado', 'recogido', 'en_camino', 'entregado']) {
				const r = await peticion<{ error?: string; data?: { estado: string } }>(
					`/api/pedidos/${pedido.id}/estado`,
					{ metodo: 'POST', cuerpo: { estado: siguiente }, jar: sesionDomA.jar }
				);
				expect(r.status, `→ ${siguiente}: ${r.data?.error}`).toBe(200);
				expect(r.data?.data?.estado).toBe(siguiente);
			}
			const { data: fila } = await clienteService()
				.from('pedidos')
				.select('estado')
				.eq('id', pedido.id)
				.single();
			expect(fila?.estado).toBe('entregado');
		});

		test('un domiciliario ajeno no puede transicionar el pedido de otro (RLS/RPC real)', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'asignado',
				domiciliarioId: domB.domiciliarioId
			});
			const r = await peticion<{ error: string }>(`/api/pedidos/${pedido.id}/estado`, {
				metodo: 'POST',
				cuerpo: { estado: 'aceptado' },
				jar: sesionDomA.jar
			});
			expect(r.status).toBe(400);
			expect(r.data?.error).toMatch(/No tienes permisos para cambiar este pedido/);
		});

		test('cliente sin rol → 403; anónimo → 401 (sin 500)', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});
			const rCliente = await peticion<{ message: string }>(`/api/pedidos/${pedido.id}/estado`, {
				metodo: 'POST',
				cuerpo: { estado: 'cancelado' },
				jar: sesionCliente.jar
			});
			expect(rCliente.status).toBe(403);
			expect(rCliente.data?.message).toMatch(/No tienes un rol registrado/);

			const rAnon = await peticion(`/api/pedidos/${pedido.id}/estado`, {
				metodo: 'POST',
				cuerpo: { estado: 'cancelado' }
			});
			expect(rAnon.status).toBe(401);
		});
	});

	describe('POST /api/pedidos/[id]/asignar — solo admin', () => {
		test('admin asigna un pedido pendiente → estado asignado en la BD', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});
			const r = await peticion<{ error?: string; data?: { estado: string } }>(
				`/api/pedidos/${pedido.id}/asignar`,
				{ metodo: 'POST', cuerpo: { domiciliario_id: domA.domiciliarioId }, jar: sesionAdmin.jar }
			);
			expect(r.status, r.data?.error).toBe(200);
			expect(r.data?.data?.estado).toBe('asignado');
			const { data: fila } = await clienteService()
				.from('pedidos')
				.select('estado, domiciliario_id')
				.eq('id', pedido.id)
				.single();
			expect(fila?.estado).toBe('asignado');
			expect(fila?.domiciliario_id).toBe(domA.domiciliarioId);
		});

		test('falta el domiciliario → 400 (valida antes de la BD)', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});
			const r = await peticion<{ error: string }>(`/api/pedidos/${pedido.id}/asignar`, {
				metodo: 'POST',
				cuerpo: {},
				jar: sesionAdmin.jar
			});
			expect(r.status).toBe(400);
			expect(r.data?.error).toMatch(/Falta el domiciliario/);
		});

		test('domiciliario inactivo o pedido no pendiente → 400 con mensaje de la BD', async () => {
			const inactivo = await crearDomiciliario(false);
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});
			const r1 = await peticion<{ error: string }>(`/api/pedidos/${pedido.id}/asignar`, {
				metodo: 'POST',
				cuerpo: { domiciliario_id: inactivo.domiciliarioId },
				jar: sesionAdmin.jar
			});
			expect(r1.status).toBe(400);
			expect(r1.data?.error).toMatch(/no existe o está inactivo/);

			const entregado = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'entregado',
				domiciliarioId: domB.domiciliarioId
			});
			const r2 = await peticion<{ error: string }>(`/api/pedidos/${entregado.id}/asignar`, {
				metodo: 'POST',
				cuerpo: { domiciliario_id: domA.domiciliarioId },
				jar: sesionAdmin.jar
			});
			expect(r2.status).toBe(400);
			expect(r2.data?.error).toMatch(/Solo se pueden asignar pedidos pendientes/);
		});

		test('cliente → 403; anónimo → 401', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});
			const rCliente = await peticion<{ message: string }>(`/api/pedidos/${pedido.id}/asignar`, {
				metodo: 'POST',
				cuerpo: { domiciliario_id: domA.domiciliarioId },
				jar: sesionCliente.jar
			});
			expect(rCliente.status).toBe(403);
			expect(rCliente.data?.message).toMatch(/No eres administrador/);
			const rAnon = await peticion(`/api/pedidos/${pedido.id}/asignar`, {
				metodo: 'POST',
				cuerpo: { domiciliario_id: domA.domiciliarioId }
			});
			expect(rAnon.status).toBe(401);
		});
	});

	describe('GET /api/pedidos — visibilidad por rol (RLS real)', () => {
		test('el domiciliario solo ve los pedidos asignados a él', async () => {
			const mio = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'asignado',
				domiciliarioId: domA.domiciliarioId
			});
			const ajeno = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'asignado',
				domiciliarioId: domB.domiciliarioId
			});
			const r = await peticion<{ data: { id: string; numero: string }[] }>('/api/pedidos', {
				jar: sesionDomA.jar
			});
			expect(r.status).toBe(200);
			const numeros = (r.data?.data ?? []).map((p) => p.numero);
			expect(numeros).toContain(mio.numero);
			expect(numeros).not.toContain(ajeno.numero);
		});

		test('admin los ve todos; cliente → 403; anónimo → 401', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});
			const rAdmin = await peticion<{ data: { numero: string }[] }>('/api/pedidos', { jar: sesionAdmin.jar });
			expect(rAdmin.status).toBe(200);
			expect(rAdmin.data?.data?.map((p) => p.numero)).toContain(pedido.numero);

			const rCliente = await peticion<{ message: string }>('/api/pedidos', { jar: sesionCliente.jar });
			expect(rCliente.status).toBe(403);
			// El GET /api/pedidos responde { error: ... } (json), no { message }.
			expect(mensaje(rCliente)).toMatch(/No tienes un rol registrado/);

			const rAnon = await peticion('/api/pedidos');
			expect(rAnon.status).toBe(401);
		});
	});

	describe('DELETE /api/pedidos — solo admin', () => {
		test('admin elimina un pedido y lo borra en cascada', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});
			const r = await peticion<{ data?: { id: string }; error?: string }>(`/api/pedidos?id=${pedido.id}`, {
				metodo: 'DELETE',
				jar: sesionAdmin.jar
			});
			expect(r.status, r.data?.error).toBe(200);
			expect(r.data?.data?.id).toBe(pedido.id);
			const { data: fila } = await clienteService().from('pedidos').select('id').eq('id', pedido.id).maybeSingle();
			expect(fila).toBeNull();
		});

		test('cliente → 403; anónimo → 401; id inexistente → 404', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});
			const rCliente = await peticion<{ message: string }>(`/api/pedidos?id=${pedido.id}`, {
				metodo: 'DELETE',
				jar: sesionCliente.jar
			});
			expect(rCliente.status).toBe(403);
			const rAnon = await peticion(`/api/pedidos?id=${pedido.id}`, { metodo: 'DELETE' });
			expect(rAnon.status).toBe(401);
			const r404 = await peticion<{ error: string }>(
				'/api/pedidos?id=00000000-0000-0000-0000-000000000000',
				{ metodo: 'DELETE', jar: sesionAdmin.jar }
			);
			expect(r404.status).toBe(404);
			expect(r404.data?.error).toMatch(/Pedido no encontrado/);
		});
	});

	describe('POST /api/pedidos/cancelar — el cliente por código', () => {
		test('cancela un pedido pendiente creado por el endpoint', async () => {
			const creado = await crearPedidoHttp();
			expect(creado.status).toBe(200);
			const numero = creado.data!.data!.numero;

			const r = await peticion<{ error?: string; data?: { estado: string; motivo_cancelacion: string | null } }>(
				'/api/pedidos/cancelar',
				{ metodo: 'POST', cuerpo: { numero, motivo: 'Ya no necesito el servicio' } }
			);
			expect(r.status, r.data?.error).toBe(200);
			expect(r.data?.data?.estado).toBe('cancelado');
			expect(r.data?.data?.motivo_cancelacion).toBe('Ya no necesito el servicio');

			// Verificado vía el endpoint público de consulta (flujo del cliente real).
			const consulta = await peticion<{ data: { pedido: { estado: string; motivo_cancelacion: string | null } } }>(
				`/api/pedidos/consultar?numero=${numero}`
			);
			expect(consulta.status).toBe(200);
			expect(consulta.data?.data?.pedido.estado).toBe('cancelado');
			expect(consulta.data?.data?.pedido.motivo_cancelacion).toBe('Ya no necesito el servicio');
		});

		test('no puede cancelar un pedido ya asignado (mensaje claro de la BD)', async () => {
			const pedido = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: cat.barrioB,
				estado: 'asignado',
				domiciliarioId: domA.domiciliarioId
			});
			const r = await peticion<{ error: string }>('/api/pedidos/cancelar', {
				metodo: 'POST',
				cuerpo: { numero: pedido.numero, motivo: 'Lo intento igual' }
			});
			expect(r.status).toBe(400);
			expect(r.data?.error).toMatch(/Solo se puede cancelar un pedido que siga pendiente/);
		});

		test('sin código → 400; motivo inválido → 400', async () => {
			const rSin = await peticion<{ error: string }>('/api/pedidos/cancelar', {
				metodo: 'POST',
				cuerpo: { motivo: 'x' }
			});
			expect(rSin.status).toBe(400);
			expect(rSin.data?.error).toMatch(/Falta el código/);

			const rMotivo = await peticion<{ error: string }>('/api/pedidos/cancelar', {
				metodo: 'POST',
				cuerpo: { numero: 'ABC123', motivo: 'm'.repeat(400) }
			});
			expect(rMotivo.status).toBe(400);
		});
	});
});
