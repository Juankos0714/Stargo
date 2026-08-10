import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import {
	RLS_DISPONIBLE,
	clienteAnon,
	clienteService,
	sembrarCatalogo,
	sembrarPedido,
	insercion,
	esperaError,
	limpiarTodo,
	type Catalogo
} from './helpers';

/**
 * Constraints e integridad (se prueban con service_role: RLS no aplica,
 * pero CHECK y FOREIGN KEY siempre se evalúan):
 *   - tarifas.valor >= 0
 *   - barrios.zona_id → zonas.id (FK)
 *   - tarifas.zona_* → zonas.id (FK)
 *   - pedidos.estado ∈ lista del CHECK
 *   - pedidos.tarifa_base >= 0
 *   - recargos.valor >= 0
 * Y las reglas del RPC crear_pedido: recargos válidos/activos y tope de 15.
 */
describe.skipIf(!RLS_DISPONIBLE)('Constraints e integridad', () => {
	let cat: Catalogo;
	let anon: ReturnType<typeof clienteAnon>;
	let servicio: ReturnType<typeof clienteService>;

	beforeAll(async () => {
		servicio = clienteService();
		anon = clienteAnon();
		cat = await sembrarCatalogo();
	});

	afterAll(async () => {
		await limpiarTodo();
	});

	describe('checks y foreign keys del catálogo', () => {
		test('tarifas.valor no puede ser negativo', async () => {
			esperaError(
				await insercion(servicio, 'tarifas', {
					zona_origen_id: cat.zonaA,
					zona_destino_id: cat.zonaB,
					valor: -100
				}),
				'tarifa negativa',
				/check|violat/i
			);
		});

		test('tarifas exige zonas existentes (FK)', async () => {
			esperaError(
				await insercion(servicio, 'tarifas', {
					zona_origen_id: 'zona_que_no_existe',
					zona_destino_id: cat.zonaB,
					valor: 5000
				}),
				'tarifa con zona inexistente',
				/foreign key|violat/i
			);
		});

		test('barrios.zona_id debe existir en zonas (FK)', async () => {
			esperaError(
				await insercion(servicio, 'barrios', {
					nombre: `Barrio FK malo ${Date.now()}`,
					zona_id: 'zona_que_no_existe'
				}),
				'barrio con zona inexistente',
				/foreign key|violat/i
			);
		});

		test('recargos.valor no puede ser negativo', async () => {
			esperaError(
				await insercion(servicio, 'recargos', {
					codigo: `rc_malo_${Date.now()}`,
					nombre: 'Recargo malo',
					tipo: 'otro',
					valor: -5
				}),
				'recargo negativo',
				/check|violat/i
			);
		});
	});

	describe('CHECK del estado de pedido', () => {
		test('estado fuera de la lista del CHECK es rechazado', async () => {
			esperaError(
				await insercion(servicio, 'pedidos', {
					numero: `X${Math.random().toString(36).slice(2, 8)}`,
					barrio_origen_id: cat.barrioA,
					direccion_origen: 'x',
					barrio_destino_id: cat.barrioB,
					direccion_destino: 'y',
					tarifa_base: 5000,
					estado: 'estado_inventado'
				}),
				'estado inválido',
				/check|violat/i
			);
		});

		test('tarifa_base no puede ser negativa', async () => {
			esperaError(
				await insercion(servicio, 'pedidos', {
					numero: `X${Math.random().toString(36).slice(2, 8)}`,
					barrio_origen_id: cat.barrioA,
					direccion_origen: 'x',
					barrio_destino_id: cat.barrioB,
					direccion_destino: 'y',
					tarifa_base: -500,
					estado: 'pendiente'
				}),
				'tarifa_base negativa',
				/check|violat/i
			);
		});

		test('pedido con barrio inexistente es rechazado (FK)', async () => {
			esperaError(
				await insercion(servicio, 'pedidos', {
					numero: `X${Math.random().toString(36).slice(2, 8)}`,
					barrio_origen_id: '00000000-0000-0000-0000-000000000000',
					direccion_origen: 'x',
					barrio_destino_id: cat.barrioB,
					direccion_destino: 'y',
					tarifa_base: 5000,
					estado: 'pendiente'
				}),
				'pedido con barrio inexistente',
				/foreign key|violat/i
			);
		});

		test('tipo_servicio fuera de la lista del CHECK es rechazado (Fase 14)', async () => {
			esperaError(
				await insercion(servicio, 'pedidos', {
					numero: `X${Math.random().toString(36).slice(2, 8)}`,
					barrio_origen_id: cat.barrioA,
					direccion_origen: 'x',
					barrio_destino_id: cat.barrioB,
					direccion_destino: 'y',
					tarifa_base: 5000,
					estado: 'pendiente',
					tipo_servicio: 'inventado'
				}),
				'tipo_servicio inválido',
				/check|violat/i
			);
		});

		test('recargos_confirmados_no_aplica acepta solo booleano (Fase 14)', async () => {
			esperaError(
				await insercion(servicio, 'pedidos', {
					numero: `X${Math.random().toString(36).slice(2, 8)}`,
					barrio_origen_id: cat.barrioA,
					direccion_origen: 'x',
					barrio_destino_id: cat.barrioB,
					direccion_destino: 'y',
					tarifa_base: 5000,
					estado: 'pendiente',
					tipo_servicio: 'domicilio',
					recargos_confirmados_no_aplica: 'si'
				}),
				'flag no booleano',
				/datatype|boolean|invalid/i
			);
		});
	});

	describe('borrar barrios con pedidos asociados (ON DELETE SET NULL)', () => {
		test('borrar un barrio con pedidos NO falla y deja el pedido sin barrio', async () => {
			// Barrio propio del test para no tocar el catálogo compartido.
			const { data: barrio, error: errBarrio } = await servicio
				.from('barrios')
				.insert({ nombre: `Barrio SET NULL ${Date.now()}`, zona_id: cat.zonaA })
				.select('id')
				.single();
			expect(errBarrio, `siembra del barrio: ${errBarrio?.message}`).toBeNull();
			expect(barrio?.id).toBeTruthy();
			if (!barrio?.id) throw new Error('No se pudo sembrar el barrio del test');

			const pedido = await sembrarPedido({
				barrioOrigenId: barrio.id,
				barrioDestinoId: cat.barrioB,
				estado: 'pendiente'
			});

			// Antes del fix (ON DELETE RESTRICT) esto fallaba con
			// «violates foreign key constraint pedidos_barrio_origen_fkey».
			const r = await servicio.from('barrios').delete().eq('id', barrio.id);
			expect(r.error, `borrar barrio con pedidos: ${r.error?.message}`).toBeNull();

			// El pedido sobrevive y queda sin barrio de origen (SET NULL).
			const { data: fila } = await servicio
				.from('pedidos')
				.select('barrio_origen_id, barrio_destino_id')
				.eq('id', pedido.id)
				.single();
			expect(fila?.barrio_origen_id).toBeNull();
			expect(fila?.barrio_destino_id).toBe(cat.barrioB);

			// El mismo mecanismo aplica a la FK de DESTINO: borrar un barrio que
			// es DESTINO de un pedido deja el pedido con barrio_destino_id NULL.
			// (Se usa un barrio propio, no cat.barrioB, que el resto de la suite
			// sigue necesitando.)
			const { data: barrioDest, error: errBarrioDest } = await servicio
				.from('barrios')
				.insert({ nombre: `Barrio SET NULL dest ${Date.now()}`, zona_id: cat.zonaB })
				.select('id')
				.single();
			expect(errBarrioDest, `siembra del barrio destino: ${errBarrioDest?.message}`).toBeNull();
			expect(barrioDest?.id).toBeTruthy();
			if (!barrioDest?.id) throw new Error('No se pudo sembrar el barrio destino del test');

			const pedidoDestino = await sembrarPedido({
				barrioOrigenId: cat.barrioA,
				barrioDestinoId: barrioDest.id,
				estado: 'pendiente'
			});
			const { error: errDestino } = await servicio.from('barrios').delete().eq('id', barrioDest.id);
			expect(errDestino, `borrar barrio destino: ${errDestino?.message}`).toBeNull();
			const { data: fila2 } = await servicio
				.from('pedidos')
				.select('barrio_destino_id')
				.eq('id', pedidoDestino.id)
				.single();
			expect(fila2?.barrio_destino_id).toBeNull();
		});
	});

	describe('RPC crear_pedido: validación de recargos en la BD', () => {
		const recargos = (n: number) =>
			Array.from({ length: n }, (_, i) => `rc_${Date.now().toString(36)}_tope_${i}`);

		test('recargo inexistente es un error (no se ignora en silencio)', async () => {
			const r = await anon.rpc('crear_pedido', {
				p_barrio_origen_id: cat.barrioA,
				p_direccion_origen: 'x',
				p_barrio_destino_id: cat.barrioB,
				p_direccion_destino: 'y',
				p_observaciones: null,
				p_recargos: ['codigo_inexistente'],
				p_telefono: '3001234567'
			});
			expect(r.error, 'se esperaba error por recargo inexistente').not.toBeNull();
			expect(r.error?.message ?? '').toMatch(/Recargo inválido o inactivo/);
		});

		test('recargo inactivo es un error', async () => {
			const r = await anon.rpc('crear_pedido', {
				p_barrio_origen_id: cat.barrioA,
				p_direccion_origen: 'x',
				p_barrio_destino_id: cat.barrioB,
				p_direccion_destino: 'y',
				p_observaciones: null,
				p_recargos: [cat.recargoInactivo.codigo],
				p_telefono: '3001234567'
			});
			expect(r.error, 'se esperaba error por recargo inactivo').not.toBeNull();
			expect(r.error?.message ?? '').toMatch(/Recargo inválido o inactivo/);
		});

		test('más de 15 recargos es un error (tope en la BD)', async () => {
			// El catálogo solo tiene 2 activos; generar 16 códigos igualmente
			// inválidos debe fallar por el tope ANTES de validar cada código.
			const r = await anon.rpc('crear_pedido', {
				p_barrio_origen_id: cat.barrioA,
				p_direccion_origen: 'x',
				p_barrio_destino_id: cat.barrioB,
				p_direccion_destino: 'y',
				p_observaciones: null,
				p_recargos: recargos(16),
				p_telefono: '3001234567'
			});
			expect(r.error, 'se esperaba error por exceso de recargos').not.toBeNull();
			expect(r.error?.message ?? '').toMatch(/Demasiados recargos/);
		});
	});
});
