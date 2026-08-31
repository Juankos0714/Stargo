/**
 * Tests de integración: Base Necesaria (Fase 21)
 *
 * Cubre: creación de pedido con base_necesaria, turnos de domiciliario,
 * matching/asignación, reserva/liberación, idempotencia e integridad.
 *
 * Ejecutar: npx vitest run tests/integration/base-necesaria.test.ts
 * Requiere: .env.test apuntando a un Supabase de pruebas (local o staging).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
	RLS_DISPONIBLE,
	crearDomiciliario,
	crearAdmin,
	crearCliente,
	sembrarCatalogo,
	clienteService,
	clienteComo,
	limpiarTodo,
	PREFIJO
} from '../rls/helpers';



// ════════════════════════════════════════════════════════════
// Helpers locales
// ════════════════════════════════════════════════════════════

function rpc(
	token: string,
	fn: string,
	args: Record<string, unknown> = {}
): Promise<{ data: unknown; error: { message: string; code: string } | null }> {
	const url = `${process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'}/rest/v1/rpc/${fn}`;
	return fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
			apikey: process.env.SUPABASE_ANON_KEY ?? ''
		},
		body: JSON.stringify(args)
	})
		.then((res) => res.json().then((json) => {
			if (!res.ok) return { data: null, error: { message: String(json.message ?? json), code: String(res.status) } };
			return { data: json, error: null };
		}));
}

function query(
	token: string,
	table: string,
	filter?: { column: string; value: string | number | null }
): Promise<{ data: unknown[]; error: unknown }> {
	let url = `${process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'}/rest/v1/${table}?select=*`;
	if (filter) url += `&${filter.column}=eq.${filter.value}`;
	return fetch(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			apikey: process.env.SUPABASE_ANON_KEY ?? ''
		}
	})
		.then((res) => res.json().then((json) => ({
			data: Array.isArray(json) ? json : [],
			error: res.ok ? null : json
		})));
}

// ════════════════════════════════════════════════════════════
// Setup global
// ════════════════════════════════════════════════════════════

let admin: Awaited<ReturnType<typeof crearAdmin>>;
let dom1: Awaited<ReturnType<typeof crearDomiciliario>>;
let dom2: Awaited<ReturnType<typeof crearDomiciliario>>;
let cliente: Awaited<ReturnType<typeof crearCliente>>;
let catalogo: Awaited<ReturnType<typeof sembrarCatalogo>>;

beforeAll(async () => {
	if (!RLS_DISPONIBLE) return;
	admin = await crearAdmin();
	dom1 = await crearDomiciliario();
	dom2 = await crearDomiciliario();
	cliente = await crearCliente();
	catalogo = await sembrarCatalogo();
}, 30_000);

afterAll(async () => {
	if (!RLS_DISPONIBLE) return;
	await limpiarTodo();
}, 15_000);

// ════════════════════════════════════════════════════════════
// SECCIÓN 1: CREACIÓN DE PEDIDO
// ════════════════════════════════════════════════════════════

describe.skipIf(!RLS_DISPONIBLE)('1. Creación de pedido con base_necesaria', () => {
	it('1.1 domicilio sin base_necesaria → debe ser 0', async () => {
		const r = await rpc(admin.token, 'crear_pedido', {
			p_barrio_origen_id: catalogo.barrioA,
			p_direccion_origen: `Origen ${PREFIJO} 1.1`,
			p_barrio_destino_id: catalogo.barrioB,
			p_direccion_destino: `Destino ${PREFIJO} 1.1`,
			p_tipo_servicio: 'domicilio'
		});
		expect(r.error).toBeNull();
		const d = r.data as Record<string, unknown>;
		expect(d.base_necesaria).toBe(0);
	});

	it('1.2 compra_diligencia sin base_necesaria → auto-calcula total', async () => {
		const r = await rpc(admin.token, 'crear_pedido', {
			p_barrio_origen_id: catalogo.barrioA,
			p_direccion_origen: `Origen ${PREFIJO} 1.2`,
			p_barrio_destino_id: catalogo.barrioB,
			p_direccion_destino: `Destino ${PREFIJO} 1.2`,
			p_tipo_servicio: 'compra_diligencia'
		});
		expect(r.error).toBeNull();
		const d = r.data as Record<string, unknown>;
		// La compra con recogida incluye la tarifa del trayecto; la base sugerida
		// debe cubrir el total completo, no solo los recargos.
		expect(d.base_necesaria).toBe(d.total);
	});

	it('1.3 compra_diligencia con base=0 explícito gana sobre auto', async () => {
		const r = await rpc(admin.token, 'crear_pedido', {
			p_barrio_origen_id: catalogo.barrioA,
			p_direccion_origen: `Origen ${PREFIJO} 1.3`,
			p_barrio_destino_id: catalogo.barrioB,
			p_direccion_destino: `Destino ${PREFIJO} 1.3`,
			p_tipo_servicio: 'compra_diligencia',
			p_base_necesaria: 0
		});
		expect(r.error).toBeNull();
		const d = r.data as Record<string, unknown>;
		expect(d.base_necesaria).toBe(0);
	});

	it('1.4 base_necesaria manual se almacena', async () => {
		const r = await rpc(admin.token, 'crear_pedido', {
			p_barrio_origen_id: catalogo.barrioA,
			p_direccion_origen: `Origen ${PREFIJO} 1.4`,
			p_barrio_destino_id: catalogo.barrioB,
			p_direccion_destino: `Destino ${PREFIJO} 1.4`,
			p_tipo_servicio: 'compra_diligencia',
			p_base_necesaria: 75000
		});
		expect(r.error).toBeNull();
		const d = r.data as Record<string, unknown>;
		expect(d.base_necesaria).toBe(75000);
	});
});

// ════════════════════════════════════════════════════════════
// SECCIÓN 2: TURNO DE DOMICILIARIO
// ════════════════════════════════════════════════════════════

describe.skipIf(!RLS_DISPONIBLE)('2. Turno de domiciliario', () => {
	it('2.1 abrir turno con base válida', async () => {
		// Cerrar si hay uno abierto
		await rpc(dom1.token, 'finalizar_turno').catch(() => {});

		const r = await rpc(dom1.token, 'iniciar_turno', { p_base_declarada: 50000 });
		expect(r.error).toBeNull();
		const d = r.data as Record<string, unknown>;
		expect(d.base_declarada).toBe(50000);
		expect(d.base_disponible_actual).toBe(50000);
	});

	it('2.2 turno_activo devuelve el turno recién creado', async () => {
		const r = await rpc(dom1.token, 'turno_activo');
		expect(r.error).toBeNull();
		const d = r.data as Record<string, unknown>;
		expect(d).toBeTruthy();
		expect(d.base_disponible_actual).toBe(50000);
	});

	it('2.4 segundo turno simultáneo → debe fallar', async () => {
		const r = await rpc(dom1.token, 'iniciar_turno', { p_base_declarada: 30000 });
		expect(r.error).not.toBeNull();
		expect(r.error!.message).toMatch(/ya tienes un turno/i);
	});

	it('2.5 cerrar turno sin pedidos pendientes → éxito', async () => {
		const r = await rpc(dom1.token, 'finalizar_turno');
		expect(r.error).toBeNull();
		const d = r.data as Record<string, unknown>;
		expect(d.finalizado_en).toBeTruthy();
	});
});

// ════════════════════════════════════════════════════════════
// SECCIÓN 3: MATCHING / ASIGNACIÓN
// ════════════════════════════════════════════════════════════

describe.skipIf(!RLS_DISPONIBLE)('3. Matching y asignación', () => {
	it('3.1 asignar a domiciliario sin base suficiente → falla', async () => {
		// Crear pedido con base_necesaria alta
		const p = await rpc(admin.token, 'crear_pedido', {
			p_barrio_origen_id: catalogo.barrioA,
			p_direccion_origen: `Origen ${PREFIJO} 3.1`,
			p_barrio_destino_id: catalogo.barrioB,
			p_direccion_destino: `Destino ${PREFIJO} 3.1`,
			p_tipo_servicio: 'compra_diligencia',
			p_base_necesaria: 999999
		});
		const pedidoId = (p.data as Record<string, unknown>).pedido_id;

		// Turno con base baja
		await rpc(dom1.token, 'finalizar_turno').catch(() => {});
		await rpc(dom1.token, 'iniciar_turno', { p_base_declarada: 5000 });

		const r = await rpc(admin.token, 'asignar_domiciliario', {
			p_pedido_id: pedidoId,
			p_domiciliario_id: dom1.domiciliarioId
		});
		expect(r.error).not.toBeNull();
		expect(r.error!.message).toMatch(/no tiene base suficiente/i);
	});

	it('3.2 base exacta (==) permite asignación', async () => {
		// Crear pedido con base = 5000
		const p = await rpc(admin.token, 'crear_pedido', {
			p_barrio_origen_id: catalogo.barrioA,
			p_direccion_origen: `Origen ${PREFIJO} 3.2`,
			p_barrio_destino_id: catalogo.barrioB,
			p_direccion_destino: `Destino ${PREFIJO} 3.2`,
			p_tipo_servicio: 'compra_diligencia',
			p_base_necesaria: 5000
		});
		const pedidoId = (p.data as Record<string, unknown>).pedido_id;

		// Turno con base exacta
		await rpc(dom1.token, 'finalizar_turno').catch(() => {});
		await rpc(dom1.token, 'iniciar_turno', { p_base_declarada: 5000 });

		const r = await rpc(admin.token, 'asignar_domiciliario', {
			p_pedido_id: pedidoId,
			p_domiciliario_id: dom1.domiciliarioId
		});
		expect(r.error).toBeNull();
		const d = r.data as Record<string, unknown>;
		expect(d.pedido_id).toBe(pedidoId);
	});

	it('3.4 base_necesaria=0 no requiere turno', async () => {
		// Crear pedido domicilio (base=0)
		const p = await rpc(admin.token, 'crear_pedido', {
			p_barrio_origen_id: catalogo.barrioA,
			p_direccion_origen: `Origen ${PREFIJO} 3.4`,
			p_barrio_destino_id: catalogo.barrioB,
			p_direccion_destino: `Destino ${PREFIJO} 3.4`,
			p_tipo_servicio: 'domicilio'
		});
		const pedidoId = (p.data as Record<string, unknown>).pedido_id;

		// Cerrar turno
		await rpc(dom1.token, 'finalizar_turno').catch(() => {});

		const r = await rpc(admin.token, 'asignar_domiciliario', {
			p_pedido_id: pedidoId,
			p_domiciliario_id: dom1.domiciliarioId
		});
		expect(r.error).toBeNull();
	});
});

// ════════════════════════════════════════════════════════════
// SECCIÓN 5: LIBERACIÓN
// ════════════════════════════════════════════════════════════

describe.skipIf(!RLS_DISPONIBLE)('5. Liberación de base', () => {
	it('5.1 cancelar pedido reservado → liberar base', async () => {
		// Setup: turno + pedido con base + asignar + aceptar
		await rpc(dom1.token, 'finalizar_turno').catch(() => {});
		await rpc(dom1.token, 'iniciar_turno', { p_base_declarada: 50000 });

		const p = await rpc(admin.token, 'crear_pedido', {
			p_barrio_origen_id: catalogo.barrioA,
			p_direccion_origen: `Origen ${PREFIJO} 5.1`,
			p_barrio_destino_id: catalogo.barrioB,
			p_direccion_destino: `Destino ${PREFIJO} 5.1`,
			p_tipo_servicio: 'compra_diligencia',
			p_base_necesaria: 10000
		});
		const pedidoId = (p.data as Record<string, unknown>).pedido_id;

		await rpc(admin.token, 'asignar_domiciliario', {
			p_pedido_id: pedidoId,
			p_domiciliario_id: dom1.domiciliarioId
		});
		await rpc(dom1.token, 'transicionar_pedido', {
			p_pedido_id: pedidoId,
			p_estado: 'aceptado'
		});

		// Base después de reserva
		const t1 = await rpc(dom1.token, 'turno_activo');
		const baseDespuesReserva = (t1.data as Record<string, unknown>).base_disponible_actual as number;

		// Cancelar → debe liberar
		await rpc(admin.token, 'transicionar_pedido', {
			p_pedido_id: pedidoId,
			p_estado: 'cancelado'
		});

		const t2 = await rpc(dom1.token, 'turno_activo');
		const baseDespuesLiberar = (t2.data as Record<string, unknown>).base_disponible_actual as number;

		expect(baseDespuesLiberar).toBe(baseDespuesReserva + 10000);
	});

	it('5.3 idempotencia: doble liberación no duplica', async () => {
		await rpc(dom1.token, 'finalizar_turno').catch(() => {});
		await rpc(dom1.token, 'iniciar_turno', { p_base_declarada: 50000 });

		const p = await rpc(admin.token, 'crear_pedido', {
			p_barrio_origen_id: catalogo.barrioA,
			p_direccion_origen: `Origen ${PREFIJO} 5.3`,
			p_barrio_destino_id: catalogo.barrioB,
			p_direccion_destino: `Destino ${PREFIJO} 5.3`,
			p_tipo_servicio: 'compra_diligencia',
			p_base_necesaria: 8000
		});
		const pedidoId = (p.data as Record<string, unknown>).pedido_id;

		await rpc(admin.token, 'asignar_domiciliario', {
			p_pedido_id: pedidoId,
			p_domiciliario_id: dom1.domiciliarioId
		});
		await rpc(dom1.token, 'transicionar_pedido', { p_pedido_id: pedidoId, p_estado: 'aceptado' });
		await rpc(dom1.token, 'transicionar_pedido', { p_pedido_id: pedidoId, p_estado: 'recogido' });
		await rpc(dom1.token, 'transicionar_pedido', { p_pedido_id: pedidoId, p_estado: 'en_camino' });

		const t1 = await rpc(dom1.token, 'turno_activo');
		const baseAntes = (t1.data as Record<string, unknown>).base_disponible_actual as number;

		// Entregar
		await rpc(dom1.token, 'transicionar_pedido', { p_pedido_id: pedidoId, p_estado: 'entregado' });

		const t2 = await rpc(dom1.token, 'turno_activo');
		const baseDespues = (t2.data as Record<string, unknown>).base_disponible_actual as number;

		// Solo 1 liberación
		expect(baseDespues).toBe(baseAntes + 8000);

		// Verificar movimientos (solo 1 reserva + 1 liberación)
		const s = clienteService();
		const { data: movs } = await s
			.from('base_movimientos')
			.select('tipo')
			.eq('pedido_id', pedidoId);
		const tipos = (movs ?? []).map((m: { tipo: string }) => m.tipo).sort();
		expect(tipos).toEqual(['liberacion', 'reserva']);
	});
});

// ════════════════════════════════════════════════════════════
// SECCIÓN 6: RLS
// ════════════════════════════════════════════════════════════

describe.skipIf(!RLS_DISPONIBLE)('6. RLS / Seguridad', () => {
	it('6.6 admin puede ver todos los turnos', async () => {
		const s = clienteService();
		const { data, error } = await s.from('turnos').select('*');
		expect(error).toBeNull();
		expect(data).toBeDefined();
		expect(data!.length).toBeGreaterThan(0);
	});

	it('6.7 admin puede ver todos los movimientos', async () => {
		const s = clienteService();
		const { data, error } = await s.from('base_movimientos').select('*');
		expect(error).toBeNull();
		expect(data).toBeDefined();
	});

	it('6.1 domiciliario no ve turnos de otro', async () => {
		// dom1 solo debe ver sus turnos
		const { data, error } = await query(dom1.token, 'turnos');
		expect(error).toBeNull();
		for (const turno of data) {
			expect((turno as Record<string, unknown>).domiciliario_id).toBe(dom1.domiciliarioId);
		}
	});
});
