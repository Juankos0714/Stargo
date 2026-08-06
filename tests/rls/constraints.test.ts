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
				p_recargos: ['codigo_inexistente']
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
				p_recargos: [cat.recargoInactivo.codigo]
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
				p_recargos: recargos(16)
			});
			expect(r.error, 'se esperaba error por exceso de recargos').not.toBeNull();
			expect(r.error?.message ?? '').toMatch(/Demasiados recargos/);
		});
	});
});
