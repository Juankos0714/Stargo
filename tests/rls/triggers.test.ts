import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import {
	RLS_DISPONIBLE,
	clienteAnon,
	clienteService,
	crearDomiciliario,
	sembrarCatalogo,
	sembrarPedido,
	seleccion,
	esperaPermitido,
	limpiarTodo,
	type Catalogo
} from './helpers';

/**
 * Triggers:
 *   - trg_pedidos_updated_at / trg_domiciliarios_updated_at → set_updated_at()
 *     (BEFORE UPDATE; actualiza updated_at y deja created_at intacto).
 *   - trg_pedido_evento (AFTER INSERT en historial_estados) → inserta una fila
 *     pública en pedido_eventos con numero + estado (Realtime del cliente).
 */
describe.skipIf(!RLS_DISPONIBLE)('Triggers', () => {
	let cat: Catalogo;
	let servicio: ReturnType<typeof clienteService>;
	let anon: ReturnType<typeof clienteAnon>;

	beforeAll(async () => {
		servicio = clienteService();
		anon = clienteAnon();
		cat = await sembrarCatalogo();
	});

	afterAll(async () => {
		await limpiarTodo();
	});

	test('set_updated_at: updated_at cambia al actualizar, created_at no', async () => {
		const pedido = await sembrarPedido({
			barrioOrigenId: cat.barrioA,
			barrioDestinoId: cat.barrioB,
			estado: 'pendiente'
		});
		const { data: antes } = await servicio
			.from('pedidos')
			.select('created_at, updated_at')
			.eq('id', pedido.id)
			.single();
		expect(antes, 'pedido sembrado sin fechas').not.toBeNull();

		// Pequeña pausa para que NOW() avance de forma medible.
		await new Promise((r) => setTimeout(r, 20));

		const { error } = await servicio
			.from('pedidos')
			.update({ observaciones: 'trigger updated_at' })
			.eq('id', pedido.id);
		expect(error, `update falló: ${error?.message}`).toBeNull();

		const { data: despues } = await servicio
			.from('pedidos')
			.select('created_at, updated_at')
			.eq('id', pedido.id)
			.single();
		expect(despues, 'pedido actualizado sin fechas').not.toBeNull();
		expect(new Date(despues!.updated_at).getTime()).toBeGreaterThan(
			new Date(antes!.updated_at).getTime()
		);
		expect(despues!.created_at).toBe(antes!.created_at);
	});

	test('trg_pedido_evento: cada estado del historial emite un evento público', async () => {
		const pedido = await sembrarPedido({
			barrioOrigenId: cat.barrioA,
			barrioDestinoId: cat.barrioB,
			estado: 'pendiente'
		});
		const { error } = await servicio.from('historial_estados').insert({
			pedido_id: pedido.id,
			estado: 'asignado',
			notas: 'Evento test'
		});
		expect(error, `insert historial falló: ${error?.message}`).toBeNull();

		// El evento es de solo-lectura pública (lo consume el panel del cliente).
		esperaPermitido(
			await seleccion(anon, 'pedido_eventos', { columna: 'numero', valor: pedido.numero }),
			'anon SELECT pedido_eventos'
		);
		const { data: eventos } = await anon
			.from('pedido_eventos')
			.select('numero, estado')
			.eq('numero', pedido.numero)
			.order('id', { ascending: false })
			.limit(1);
		expect(eventos ?? []).toHaveLength(1); // solo el evento 'asignado' (la siembra directa no crea historial)
		expect(eventos?.[0]?.estado).toBe('asignado');
		expect(eventos?.[0]?.numero).toBe(pedido.numero);
	});

	test('domiciliarios también actualiza updated_at automáticamente', async () => {
		const dom = await crearDomiciliario();
		const { data: antes } = await servicio
			.from('domiciliarios')
			.select('updated_at')
			.eq('id', dom.domiciliarioId)
			.single();
		expect(antes, 'domiciliario sin updated_at').not.toBeNull();

		await new Promise((r) => setTimeout(r, 20));

		const { error } = await servicio
			.from('domiciliarios')
			.update({ nombre: `Dom trigger ${Date.now()}` })
			.eq('id', dom.domiciliarioId);
		expect(error, `update domiciliario falló: ${error?.message}`).toBeNull();

		const { data: despues } = await servicio
			.from('domiciliarios')
			.select('updated_at')
			.eq('id', dom.domiciliarioId)
			.single();
		expect(despues, 'domiciliario actualizado sin updated_at').not.toBeNull();
		expect(new Date(despues!.updated_at).getTime()).toBeGreaterThan(
			new Date(antes!.updated_at).getTime()
		);
	});
});
