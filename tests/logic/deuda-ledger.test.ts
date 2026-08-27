/**
 * Tests: Ledger de deuda (Fase 23)
 *
 * Verifica la lógica de acumulación de deuda y abonos usando un ledger
 * en memoria que simula el comportamiento de las RPCs de PostgreSQL.
 *
 * La lógica real vive en las RPCs (registrar_generacion_deuda,
 * registrar_abono_deuda). Estos tests validan las REGLAS DE NEGOCIO
 * usando una simulación en TypeScript que espeja la lógica SQL.
 *
 * Fase 23 (idempotencia): la simulación ahora incluye verificación
 * de duplicados, igual que la RPC real con ON CONFLICT.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ============================================================
// Simulación del ledger (espeja las RPCs de PostgreSQL)
// ============================================================

interface Domiciliario {
	id: string;
	nombre: string;
	nivel: number;
	deuda_actual: number;
	credito_favor: number;
}

interface MovimientoDeuda {
	id: number;
	domiciliario_id: string;
	tipo: 'generacion' | 'abono';
	monto: number;
	saldo_resultante: number;
	referencia_tipo: string | null;
	referencia_id: string | null;
	notas: string | null;
	nivel: number | null;
	tarifa_aplicada: number | null;
	creado_en: Date;
}

let nextId = 1;
let domiciliarios: Map<string, Domiciliario>;
let movimientos: MovimientoDeuda[];

function reset() {
	nextId = 1;
	domiciliarios = new Map();
	movimientos = [];
}

function crearDomiciliario(id: string, nombre: string, nivel: number = 1): Domiciliario {
	const dom = { id, nombre, nivel, deuda_actual: 0, credito_favor: 0 };
	domiciliarios.set(id, dom);
	return dom;
}

function obtenerDomiciliario(id: string): Domiciliario | undefined {
	return domiciliarios.get(id);
}

/**
 * Simula registrar_generacion_deuda (con idempotencia):
 * 1. Verifica si ya existe un movimiento para este pedido
 * 2. Aplica crédito a favor primero
 * 3. Incrementa deuda_actual con el monto efectivo
 * 4. Registra en el ledger
 */
function registrarGeneracionDeuda(
	domiciliarioId: string,
	pedidoId: string,
	monto: number,
	nivel: number | null = null,
	tarifa: number | null = null
): { monto: number; monto_efectivo: number; credito_aplicado: number; deuda_actual: number; credito_favor: number; ya_registrado: boolean } {
	const dom = domiciliarios.get(domiciliarioId);
	if (!dom) throw new Error('Domiciliario no encontrado');
	if (monto < 0) throw new Error('El monto no puede ser negativo');
	if (monto === 0) {
		return { monto: 0, monto_efectivo: 0, credito_aplicado: 0, deuda_actual: dom.deuda_actual, credito_favor: dom.credito_favor, ya_registrado: false };
	}

	// Idempotencia: verificar si ya existe un movimiento para este pedido
	const yaExiste = movimientos.some(
		(m) => m.domiciliario_id === domiciliarioId && m.referencia_tipo === 'pedido' && m.referencia_id === pedidoId
	);
	if (yaExiste) {
		return {
			monto, monto_efectivo: 0, credito_aplicado: 0,
			deuda_actual: dom.deuda_actual, credito_favor: dom.credito_favor,
			ya_registrado: true
		};
	}

	// Aplicar crédito primero
	const creditoAplicado = Math.min(dom.credito_favor, monto);
	const montoEfectivo = monto - creditoAplicado;

	dom.credito_favor -= creditoAplicado;

	if (montoEfectivo > 0) {
		dom.deuda_actual += montoEfectivo;
		movimientos.push({
			id: nextId++,
			domiciliario_id: domiciliarioId,
			tipo: 'generacion',
			monto: montoEfectivo,
			saldo_resultante: dom.deuda_actual,
			referencia_tipo: 'pedido',
			referencia_id: pedidoId,
			notas: 'Comisión por servicio completado',
			nivel: nivel ?? dom.nivel,
			tarifa_aplicada: tarifa ?? montoEfectivo,
			creado_en: new Date()
		});
	}

	return {
		monto,
		monto_efectivo: montoEfectivo,
		credito_aplicado: creditoAplicado,
		deuda_actual: dom.deuda_actual,
		credito_favor: dom.credito_favor,
		ya_registrado: false
	};
}

/**
 * Simula registrar_abono_deuda:
 * 1. Si abono <= deuda: deuda -= abono
 * 2. Si abono > deuda: credito += excedente; deuda = 0
 * 3. Registra en el ledger
 */
function registrarAbonoDeuda(
	domiciliarioId: string,
	valor: number,
	nota: string | null = null
): { pago_id: string; valor: number; deuda_actual: number; credito_favor: number; excedente: number } {
	const dom = domiciliarios.get(domiciliarioId);
	if (!dom) throw new Error('Domiciliario no encontrado');
	if (valor <= 0) throw new Error('El abono debe ser mayor que cero');

	const deudaRestante = dom.deuda_actual;
	let excedente = 0;

	if (valor <= deudaRestante) {
		// Abono cubierto por la deuda
		dom.deuda_actual -= valor;
		movimientos.push({
			id: nextId++,
			domiciliario_id: domiciliarioId,
			tipo: 'abono',
			monto: valor,
			saldo_resultante: dom.deuda_actual,
			referencia_tipo: 'abono',
			referencia_id: null,
			notas: nota,
			creado_en: new Date()
		});
	} else {
		// Abono excede la deuda
		if (deudaRestante > 0) {
			movimientos.push({
				id: nextId++,
				domiciliario_id: domiciliarioId,
				tipo: 'abono',
				monto: deudaRestante,
				saldo_resultante: 0,
				referencia_tipo: 'abono',
				referencia_id: null,
				notas: nota,
				creado_en: new Date()
			});
		}
		excedente = valor - deudaRestante;
		dom.deuda_actual = 0;
		dom.credito_favor += excedente;
	}

	const pagoId = `pago-${nextId}`;
	return {
		pago_id: pagoId,
		valor,
		deuda_actual: dom.deuda_actual,
		credito_favor: dom.credito_favor,
		excedente
	};
}

/**
 * Simula el cálculo incremental de comisión por día (espeja
 * registrarComisionDeuda en estado/+server.ts).
 *
 * Dado un conjunto de pedidos entregados y una escalera, calcula
 * la comisión incremental de cada pedido individual.
 */
function calcularComisionIncremental(
	pedidos: { id: string; total: number }[],
	niveles: { nivel: number; hasta: number; valor: number }[]
): { id: string; incremental: number }[] {
	const resultados: { id: string; incremental: number }[] = [];

	for (const pedido of pedidos) {
		const totalDia = pedidos.reduce((acc, p) => acc + p.total, 0);
		const totalDiaSinEste = totalDia - pedido.total;

		const comisionCon = comisionDiariaSimple(niveles, totalDia);
		const comisionSin = comisionDiariaSimple(niveles, totalDiaSinEste);
		const incremental = Math.max(0, comisionCon - comisionSin);

		resultados.push({ id: pedido.id, incremental });
	}

	return resultados;
}

function comisionDiariaSimple(
	niveles: { nivel: number; hasta: number; valor: number }[],
	totalDia: number
): number {
	if (totalDia <= 0 || niveles.length === 0) return 0;
	const ordenados = [...niveles].sort((a, b) => a.nivel - b.nivel);
	const alcanzado = ordenados.find((n) => totalDia <= n.hasta) ?? ordenados[ordenados.length - 1];
	return ordenados
		.filter((n) => n.nivel <= alcanzado.nivel)
		.reduce((acc, n) => acc + n.valor, 0);
}

// ============================================================
// Tests
// ============================================================

describe('Fase 23 — Ledger de deuda', () => {
	beforeEach(() => reset());

	describe('Acumulación de deuda', () => {
		it('una generación crea deuda', () => {
			crearDomiciliario('dom1', 'Carlos');
			const r = registrarGeneracionDeuda('dom1', 'ped1', 5200);

			expect(r.deuda_actual).toBe(5200);
			expect(r.credito_favor).toBe(0);
			expect(movimientos).toHaveLength(1);
			expect(movimientos[0].tipo).toBe('generacion');
			expect(movimientos[0].monto).toBe(5200);
			expect(movimientos[0].saldo_resultante).toBe(5200);
		});

		it('varias generaciones acumulan la deuda', () => {
			crearDomiciliario('dom1', 'Carlos');

			registrarGeneracionDeuda('dom1', 'ped1', 3900);
			registrarGeneracionDeuda('dom1', 'ped2', 5200);
			registrarGeneracionDeuda('dom1', 'ped3', 2600);

			const dom = domiciliarios.get('dom1')!;
			expect(dom.deuda_actual).toBe(3900 + 5200 + 2600);
			expect(movimientos).toHaveLength(3);
		});

		it('generación de monto 0 no crea movimiento', () => {
			crearDomiciliario('dom1', 'Carlos');
			const r = registrarGeneracionDeuda('dom1', 'ped1', 0);

			expect(r.deuda_actual).toBe(0);
			expect(movimientos).toHaveLength(0);
		});
	});

	describe('Abonos', () => {
		it('abono parcial reduce la deuda', () => {
			crearDomiciliario('dom1', 'Carlos');
			registrarGeneracionDeuda('dom1', 'ped1', 10000);

			const r = registrarAbonoDeuda('dom1', 3000, 'Abono parcial');

			expect(r.deuda_actual).toBe(7000);
			expect(r.excedente).toBe(0);
			expect(movimientos).toHaveLength(2); // 1 generación + 1 abono
			expect(movimientos[1].tipo).toBe('abono');
			expect(movimientos[1].monto).toBe(3000);
		});

		it('abono exacto deja deuda en 0', () => {
			crearDomiciliario('dom1', 'Carlos');
			registrarGeneracionDeuda('dom1', 'ped1', 10000);

			const r = registrarAbonoDeuda('dom1', 10000, 'Abono total');

			expect(r.deuda_actual).toBe(0);
			expect(r.excedente).toBe(0);
		});

		it('abono con excedente crea crédito a favor', () => {
			crearDomiciliario('dom1', 'Carlos');
			registrarGeneracionDeuda('dom1', 'ped1', 5000);

			const r = registrarAbonoDeuda('dom1', 8000, 'Abono excedente');

			expect(r.deuda_actual).toBe(0);
			expect(r.excedente).toBe(3000);
			expect(r.credito_favor).toBe(3000);

			// Verificar que el movimiento de abono solo registra la parte de la deuda
			const abonoMov = movimientos.find((m) => m.tipo === 'abono');
			expect(abonoMov?.monto).toBe(5000); // solo la parte de la deuda
			expect(abonoMov?.saldo_resultante).toBe(0);
		});

		it('abono sin deuda va todo a crédito', () => {
			crearDomiciliario('dom1', 'Carlos');
			// Sin deuda previa

			const r = registrarAbonoDeuda('dom1', 5000, 'Adelanto');

			expect(r.deuda_actual).toBe(0);
			expect(r.excedente).toBe(5000);
			expect(r.credito_favor).toBe(5000);

			// No se crea movimiento de abono (no había deuda)
			const abonos = movimientos.filter((m) => m.tipo === 'abono');
			expect(abonos).toHaveLength(0);
		});
	});

	describe('Crédito a favor', () => {
		it('crédito se aplica antes de generar deuda nueva', () => {
			crearDomiciliario('dom1', 'Carlos');

			// Crear deuda y abonar de más
			registrarGeneracionDeuda('dom1', 'ped1', 5000);
			registrarAbonoDeuda('dom1', 8000); // crédito = 3000

			// Generar deuda nueva: el crédito se aplica primero
			const r = registrarGeneracionDeuda('dom1', 'ped2', 4000);

			// 4000 - 3000 (crédito) = 1000 deuda efectiva
			expect(r.credito_aplicado).toBe(3000);
			expect(r.monto_efectivo).toBe(1000);
			expect(r.deuda_actual).toBe(1000);
			expect(r.credito_favor).toBe(0);
		});

		it('crédito cubre toda la deuda nueva', () => {
			crearDomiciliario('dom1', 'Carlos');

			// Crear deuda y abonar de más
			registrarGeneracionDeuda('dom1', 'ped1', 3000);
			registrarAbonoDeuda('dom1', 10000); // crédito = 7000

			// Generar deuda menor al crédito
			const r = registrarGeneracionDeuda('dom1', 'ped2', 5000);

			// Todo cubierto por crédito
			expect(r.credito_aplicado).toBe(5000);
			expect(r.monto_efectivo).toBe(0);
			expect(r.deuda_actual).toBe(0);
			expect(r.credito_favor).toBe(2000); // 7000 - 5000
		});

		it('crédito parcial reduce deuda', () => {
			crearDomiciliario('dom1', 'Carlos');

			// Crear deuda y abonar de más
			registrarGeneracionDeuda('dom1', 'ped1', 2000);
			registrarAbonoDeuda('dom1', 5000); // crédito = 3000

			// Generar deuda mayor al crédito
			const r = registrarGeneracionDeuda('dom1', 'ped2', 10000);

			// 3000 de crédito aplicado, 7000 de deuda efectiva
			expect(r.credito_aplicado).toBe(3000);
			expect(r.monto_efectivo).toBe(7000);
			expect(r.deuda_actual).toBe(7000);
			expect(r.credito_favor).toBe(0);
		});
	});

	describe('Race conditions (simulación)', () => {
		it('dos abonos simultáneos no sobrepasan la deuda', () => {
			crearDomiciliario('dom1', 'Carlos');
			registrarGeneracionDeuda('dom1', 'ped1', 10000);

			// Simular dos abonos "simultáneos" (en secuencia, como lo haría SELECT FOR UPDATE)
			registrarAbonoDeuda('dom1', 6000);
			const r2 = registrarAbonoDeuda('dom1', 6000);

			// El segundo abono solo aplica 4000 (la deuda restante)
			expect(r2.deuda_actual).toBe(0);
			expect(r2.excedente).toBe(2000); // 6000 - 4000
			expect(r2.credito_favor).toBe(2000);
		});

		it('dos generaciones del mismo pedido no duplican deuda (idempotencia)', () => {
			crearDomiciliario('dom1', 'Carlos');

			const r1 = registrarGeneracionDeuda('dom1', 'ped1', 5200);
			expect(r1.ya_registrado).toBe(false);
			expect(r1.deuda_actual).toBe(5200);

			// Segunda llamada para el mismo pedido: no debe duplicar
			const r2 = registrarGeneracionDeuda('dom1', 'ped1', 5200);
			expect(r2.ya_registrado).toBe(true);
			expect(r2.deuda_actual).toBe(5200); // sin cambio
			expect(movimientos).toHaveLength(1); // solo 1 movimiento
		});

		it('generaciones de pedidos diferentes sí acumulan', () => {
			crearDomiciliario('dom1', 'Carlos');

			registrarGeneracionDeuda('dom1', 'ped1', 5200);
			registrarGeneracionDeuda('dom1', 'ped2', 3900);

			const dom = domiciliarios.get('dom1')!;
			expect(dom.deuda_actual).toBe(5200 + 3900);
			expect(movimientos).toHaveLength(2);
		});
	});

	describe('Ledger (auditoría)', () => {
		it('cada movimiento tiene saldo_resultante correcto', () => {
			crearDomiciliario('dom1', 'Carlos');

			registrarGeneracionDeuda('dom1', 'ped1', 5000);
			registrarGeneracionDeuda('dom1', 'ped2', 3000);
			registrarAbonoDeuda('dom1', 2000);
			registrarGeneracionDeuda('dom1', 'ped3', 4000);

			expect(movimientos[0].saldo_resultante).toBe(5000);
			expect(movimientos[1].saldo_resultante).toBe(8000);
			expect(movimientos[2].saldo_resultante).toBe(6000);
			expect(movimientos[3].saldo_resultante).toBe(10000);
		});

		it('movimientos tienen referencia correcta', () => {
			crearDomiciliario('dom1', 'Carlos');

			registrarGeneracionDeuda('dom1', 'ped1', 5000);
			registrarAbonoDeuda('dom1', 2000, 'Abono en efectivo');

			expect(movimientos[0].referencia_tipo).toBe('pedido');
			expect(movimientos[0].referencia_id).toBe('ped1');
			expect(movimientos[1].referencia_tipo).toBe('abono');
			expect(movimientos[1].notas).toBe('Abono en efectivo');
		});

		it('saldo del último movimiento coincide con deuda_actual', () => {
			crearDomiciliario('dom1', 'Carlos');

			registrarGeneracionDeuda('dom1', 'ped1', 5000);
			registrarGeneracionDeuda('dom1', 'ped2', 3000);
			registrarAbonoDeuda('dom1', 4000);

			const ultimo = movimientos[movimientos.length - 1];
			const dom = domiciliarios.get('dom1')!;
			expect(ultimo.saldo_resultante).toBe(dom.deuda_actual);
		});
	});

	describe('Días múltiples (acumulación)', () => {
		it('deuda generada un día sigue pendiente en días posteriores', () => {
			crearDomiciliario('dom1', 'Carlos');

			// Día 1: comisión 5200
			registrarGeneracionDeuda('dom1', 'ped1', 5200);

			// Simular "cambio de día": la deuda NO debe cambiar
			const domDia1 = domiciliarios.get('dom1')!;
			expect(domDia1.deuda_actual).toBe(5200);

			// Día 2: comisión adicional 3900
			registrarGeneracionDeuda('dom1', 'ped2', 3900);

			// La deuda acumulada es 5200 + 3900 = 9100
			const domDia2 = domiciliarios.get('dom1')!;
			expect(domDia2.deuda_actual).toBe(5200 + 3900);
		});

		it('múltiples deudas se acumulan correctamente a través de varios días', () => {
			crearDomiciliario('dom1', 'Carlos');

			// Día 1: 3 entregas, comisión diaria = 3900
			registrarGeneracionDeuda('dom1', 'ped1', 1300);
			registrarGeneracionDeuda('dom1', 'ped2', 1300);
			registrarGeneracionDeuda('dom1', 'ped3', 1300);

			// Día 2: 2 entregas, comisión diaria = 5200
			registrarGeneracionDeuda('dom1', 'ped4', 2600);
			registrarGeneracionDeuda('dom1', 'ped5', 2600);

			// Día 3: 1 entrega, comisión diaria = 2600
			registrarGeneracionDeuda('dom1', 'ped6', 2600);

			const dom = domiciliarios.get('dom1')!;
			expect(dom.deuda_actual).toBe(3900 + 5200 + 2600);
			expect(movimientos).toHaveLength(6);
		});

		it('abono parcial entre días reduce deuda correctamente', () => {
			crearDomiciliario('dom1', 'Carlos');

			// Día 1: comisión 5200
			registrarGeneracionDeuda('dom1', 'ped1', 5200);

			// Abono parcial
			registrarAbonoDeuda('dom1', 2000);

			// Día 2: comisión 3900
			registrarGeneracionDeuda('dom1', 'ped2', 3900);

			const dom = domiciliarios.get('dom1')!;
			expect(dom.deuda_actual).toBe(5200 - 2000 + 3900);
		});
	});

	describe('Persistencia de deuda (cambio de día)', () => {
		it('la deuda NO se borra al cambiar de día', () => {
			crearDomiciliario('dom1', 'Carlos');

			// Día 1: registrar deuda
			registrarGeneracionDeuda('dom1', 'ped1', 7800);

			// Simular "reinicio de app / cambio de día"
			// (la deuda se lee de deuda_actual, no se recalcula)
			const dom = obtenerDomiciliario('dom1')!;
			expect(dom.deuda_actual).toBe(7800);

			// Día 2: la deuda sigue ahí
			registrarGeneracionDeuda('dom1', 'ped2', 1300);
			expect(dom.deuda_actual).toBe(7800 + 1300);
		});

		it('la deuda se mantiene aunque no haya nuevos pedidos', () => {
			crearDomiciliario('dom1', 'Carlos');

			// Día 1: deuda 5200
			registrarGeneracionDeuda('dom1', 'ped1', 5200);

			// Día 2: sin pedidos → la deuda sigue en 5200
			const dom = obtenerDomiciliario('dom1')!;
			expect(dom.deuda_actual).toBe(5200);

			// Día 3: abono parcial
			registrarAbonoDeuda('dom1', 2000);
			expect(dom.deuda_actual).toBe(3200);
		});

		it('saldo a favor persiste entre días', () => {
			crearDomiciliario('dom1', 'Carlos');

			// Crear deuda y abonar de más → crédito
			registrarGeneracionDeuda('dom1', 'ped1', 3000);
			registrarAbonoDeuda('dom1', 5000); // crédito = 2000

			// Día siguiente: el crédito se aplica antes de la deuda nueva
			const r = registrarGeneracionDeuda('dom1', 'ped2', 4000);
			expect(r.credito_aplicado).toBe(2000);
			expect(r.monto_efectivo).toBe(2000);
			expect(r.deuda_actual).toBe(2000);
			expect(r.credito_favor).toBe(0);
		});
	});

	describe('No duplicación de cargos', () => {
		it('el mismo pedido no genera deuda dos veces (idempotencia)', () => {
			crearDomiciliario('dom1', 'Carlos');

			const r1 = registrarGeneracionDeuda('dom1', 'ped1', 5200);
			const r2 = registrarGeneracionDeuda('dom1', 'ped1', 5200);

			expect(r1.ya_registrado).toBe(false);
			expect(r2.ya_registrado).toBe(true);

			const dom = domiciliarios.get('dom1')!;
			expect(dom.deuda_actual).toBe(5200); // no duplicado
			expect(movimientos).toHaveLength(1);
		});

		it('pedidos diferentes de diferentes domiciliarios son independientes', () => {
			crearDomiciliario('dom1', 'Carlos');
			crearDomiciliario('dom2', 'María');

			registrarGeneracionDeuda('dom1', 'ped1', 5200);
			registrarGeneracionDeuda('dom2', 'ped2', 3900);

			expect(obtenerDomiciliario('dom1')!.deuda_actual).toBe(5200);
			expect(obtenerDomiciliario('dom2')!.deuda_actual).toBe(3900);
		});

		it('mismo domiciliario con pedidos distintos no se confunde', () => {
			crearDomiciliario('dom1', 'Carlos');

			registrarGeneracionDeuda('dom1', 'ped-A', 5200);
			registrarGeneracionDeuda('dom1', 'ped-B', 3900);

			// Cada uno se registra una sola vez
			const r1 = registrarGeneracionDeuda('dom1', 'ped-A', 5200);
			const r2 = registrarGeneracionDeuda('dom1', 'ped-B', 3900);

			expect(r1.ya_registrado).toBe(true);
			expect(r2.ya_registrado).toBe(true);
			expect(movimientos).toHaveLength(2); // solo 2, no 4
		});
	});

	describe('Escenarios completos de negocio', () => {
		it('flujo completo: deuda → abono parcial → abono exacto → 0', () => {
			crearDomiciliario('dom1', 'Carlos');

			// Generar deuda
			registrarGeneracionDeuda('dom1', 'ped1', 10000);
			expect(obtenerDomiciliario('dom1')!.deuda_actual).toBe(10000);

			// Abono parcial
			const r1 = registrarAbonoDeuda('dom1', 4000);
			expect(r1.deuda_actual).toBe(6000);
			expect(r1.excedente).toBe(0);

			// Abono exacto del restante
			const r2 = registrarAbonoDeuda('dom1', 6000);
			expect(r2.deuda_actual).toBe(0);
			expect(r2.excedente).toBe(0);
		});

		it('flujo completo: deuda → abono mayor → crédito → nueva deuda cubierta por crédito', () => {
			crearDomiciliario('dom1', 'Carlos');

			// Deuda de 5000
			registrarGeneracionDeuda('dom1', 'ped1', 5000);

			// Abono de 8000 (excedente 3000 → crédito)
			const r1 = registrarAbonoDeuda('dom1', 8000);
			expect(r1.deuda_actual).toBe(0);
			expect(r1.credito_favor).toBe(3000);

			// Nueva deuda de 4000, crédito cubre 3000
			const r2 = registrarGeneracionDeuda('dom1', 'ped2', 4000);
			expect(r2.credito_aplicado).toBe(3000);
			expect(r2.monto_efectivo).toBe(1000);
			expect(r2.deuda_actual).toBe(1000);
		});

		it('flujo completo: múltiples días con abonos intercalados', () => {
			crearDomiciliario('dom1', 'Carlos');

			// Día 1: comisión 5200
			registrarGeneracionDeuda('dom1', 'ped1', 5200);
			expect(obtenerDomiciliario('dom1')!.deuda_actual).toBe(5200);

			// Abono de 3000
			registrarAbonoDeuda('dom1', 3000);
			expect(obtenerDomiciliario('dom1')!.deuda_actual).toBe(2200);

			// Día 2: comisión 7800
			registrarGeneracionDeuda('dom1', 'ped2', 7800);
			expect(obtenerDomiciliario('dom1')!.deuda_actual).toBe(2200 + 7800);

			// Abono de 10000 (excedente → crédito)
			const r = registrarAbonoDeuda('dom1', 10000);
			expect(r.deuda_actual).toBe(0);
			expect(r.excedente).toBe(0); // 10000 = 2200 + 7800
			expect(r.credito_favor).toBe(0);

			// Día 3: comisión 1300, cubierta por crédito previo (0)
			registrarGeneracionDeuda('dom1', 'ped3', 1300);
			expect(obtenerDomiciliario('dom1')!.deuda_actual).toBe(1300);
		});

		it('deuda nunca queda negativa', () => {
			crearDomiciliario('dom1', 'Carlos');

			// Sin deuda, abono de 5000
			const r = registrarAbonoDeuda('dom1', 5000);
			expect(r.deuda_actual).toBe(0); // nunca negativa
			expect(r.excedente).toBe(5000);
		});

		it('monto 0 en generación no cambia nada', () => {
			crearDomiciliario('dom1', 'Carlos');
			registrarGeneracionDeuda('dom1', 'ped1', 5000);

			const r = registrarGeneracionDeuda('dom1', 'ped2', 0);
			expect(r.deuda_actual).toBe(5000);
			expect(movimientos).toHaveLength(1);
		});
	});

	describe('Cálculo incremental de comisión (espejo de registrarComisionDeuda)', () => {
		const escalera = [
			{ nivel: 1, hasta: 10000, valor: 1300 },
			{ nivel: 2, hasta: 20000, valor: 1300 },
			{ nivel: 3, hasta: 30000, valor: 1300 },
			{ nivel: 4, hasta: 40000, valor: 1300 },
			{ nivel: 5, hasta: 50000, valor: 1300 },
			{ nivel: 10, hasta: 100000, valor: 1300 }
		];

		it('un solo pedido genera comisión incremental correcta', () => {
			const pedidos = [{ id: 'ped1', total: 15000 }];
			const resultado = calcularComisionIncremental(pedidos, escalera);
			// total_dia = 15000, nivel 2 → comisión = 2600
			// sin este pedido: total = 0, comisión = 0
			// incremental = 2600
			expect(resultado[0].incremental).toBe(2600);
		});

		it('dos pedidos secuenciales: cada uno ve el estado previo de entregados', () => {
			// En producción, cada entrega se procesa secuencialmente:
			// 1. Se marca como 'entregado' → se ve solo ped1
			// 2. Se marca como 'entregado' → se ve ped1 + ped2
			// El incremental se calcula sobre los entregados visibles al momento.

			// Primer pedido: solo él → comisión = 2600 (nivel 2)
			const r1 = calcularComisionIncremental([{ id: 'ped1', total: 15000 }], escalera);
			expect(r1[0].incremental).toBe(2600);

			// Segundo pedido: ambos → total = 35000 → nivel 4 → comisión = 5200
			// sin ped2 = 15000 → nivel 2 → 2600
			// incremental del ped2 = 5200 - 2600 = 2600
			const r2 = calcularComisionIncremental(
				[{ id: 'ped1', total: 15000 }, { id: 'ped2', total: 20000 }],
				escalera
			);
			expect(r2[1].incremental).toBe(2600);
		});

		it('pedido que no cruza umbral tiene incremental 0', () => {
			// ped1 ya entregado (8000), ped2 llega con 1500
			// total = 9500, sin ped2 = 8000 → ambos nivel 1
			const r2 = calcularComisionIncremental(
				[{ id: 'ped1', total: 8000 }, { id: 'ped2', total: 1500 }],
				escalera
			);
			expect(r2[1].incremental).toBe(0);
		});

		it('suma de incrementales == comisión total del día (cuando todos se ven juntos)', () => {
			const pedidos = [
				{ id: 'ped1', total: 12000 },
				{ id: 'ped2', total: 18000 },
				{ id: 'ped3', total: 5000 }
			];
			const resultado = calcularComisionIncremental(pedidos, escalera);
			const sumaIncrementales = resultado.reduce((acc, r) => acc + r.incremental, 0);
			const comisionTotal = comisionDiariaSimple(escalera, 35000); // nivel 4 → 5200
			expect(sumaIncrementales).toBe(comisionTotal);
		});

		it('intercalado con abonos: la deuda se calcula correctamente', () => {
			// Flujo real:
			// 1. ped1 entregado → comisión incremental = 2600 → deuda = 2600
			// 2. Abono 1000 → deuda = 1600
			// 3. ped2 entregado → comisión incremental = 1300 → deuda = 2900
			crearDomiciliario('dom1', 'Carlos');
			registrarGeneracionDeuda('dom1', 'ped1', 2600);
			expect(obtenerDomiciliario('dom1')!.deuda_actual).toBe(2600);

			registrarAbonoDeuda('dom1', 1000);
			expect(obtenerDomiciliario('dom1')!.deuda_actual).toBe(1600);

			registrarGeneracionDeuda('dom1', 'ped2', 1300);
			expect(obtenerDomiciliario('dom1')!.deuda_actual).toBe(2900);
		});
	});

	// ============================================================
	// Fase 24: Comisión por servicio (no por día)
	// ============================================================
	describe('Fase 24 — Comisión por servicio', () => {
		it('cada servicio genera una comisión = tarifa del nivel vigente', () => {
			// Nivel 1: $1.300 por servicio
			crearDomiciliario('dom1', 'Carlos', 1);

			registrarGeneracionDeuda('dom1', 'ped1', 1300, 1, 1300);
			expect(obtenerDomiciliario('dom1')!.deuda_actual).toBe(1300);

			registrarGeneracionDeuda('dom1', 'ped2', 1300, 1, 1300);
			expect(obtenerDomiciliario('dom1')!.deuda_actual).toBe(2600);

			// 3 servicios → 3 × $1.300 = $3.900
			registrarGeneracionDeuda('dom1', 'ped3', 1300, 1, 1300);
			expect(obtenerDomiciliario('dom1')!.deuda_actual).toBe(3900);
		});

		it('cambio de nivel: servicios anteriores conservan la tarifa original', () => {
			// Nivel 1: $1.300 por servicio
			crearDomiciliario('dom1', 'Carlos', 1);

			// Día 1: 3 servicios con nivel 1
			registrarGeneracionDeuda('dom1', 'ped1', 1300, 1, 1300);
			registrarGeneracionDeuda('dom1', 'ped2', 1300, 1, 1300);
			registrarGeneracionDeuda('dom1', 'ped3', 1300, 1, 1300);
			expect(obtenerDomiciliario('dom1')!.deuda_actual).toBe(3900);

			// Sube a nivel 2 (tarifa $2.200)
			obtenerDomiciliario('dom1')!.nivel = 2;

			// Día 2: 2 servicios con nivel 2
			registrarGeneracionDeuda('dom1', 'ped4', 2200, 2, 2200);
			registrarGeneracionDeuda('dom1', 'ped5', 2200, 2, 2200);

			// Deuda: 3×1300 + 2×2200 = 3900 + 4400 = 8300
			expect(obtenerDomiciliario('dom1')!.deuda_actual).toBe(8300);

			// Verificar que los movimientos originales tienen nivel 1
			const movNivel1 = movimientos.filter((m) => m.nivel === 1);
			expect(movNivel1).toHaveLength(3);
			movNivel1.forEach((m) => expect(m.tarifa_aplicada).toBe(1300));

			// Los nuevos tienen nivel 2
			const movNivel2 = movimientos.filter((m) => m.nivel === 2);
			expect(movNivel2).toHaveLength(2);
			movNivel2.forEach((m) => expect(m.tarifa_aplicada).toBe(2200));
		});

		it('prevención de duplicados: mismo servicio no genera comisión dos veces', () => {
			crearDomiciliario('dom1', 'Carlos', 1);

			const r1 = registrarGeneracionDeuda('dom1', 'ped1', 1300, 1, 1300);
			expect(r1.ya_registrado).toBe(false);
			expect(r1.deuda_actual).toBe(1300);

			// Segunda llamada para el mismo servicio: no duplicar
			const r2 = registrarGeneracionDeuda('dom1', 'ped1', 1300, 1, 1300);
			expect(r2.ya_registrado).toBe(true);
			expect(r2.deuda_actual).toBe(1300); // sin cambio
			expect(movimientos).toHaveLength(1); // solo 1 movimiento
		});

		it('abonos reducen la deuda acumulada (multidía)', () => {
			// Nivel 1: $1.300 por servicio
			crearDomiciliario('dom1', 'Carlos', 1);

			// Día 1: 3 servicios → $3.900
			registrarGeneracionDeuda('dom1', 'ped1', 1300, 1, 1300);
			registrarGeneracionDeuda('dom1', 'ped2', 1300, 1, 1300);
			registrarGeneracionDeuda('dom1', 'ped3', 1300, 1, 1300);
			expect(obtenerDomiciliario('dom1')!.deuda_actual).toBe(3900);

			// Día 2: sube a nivel 2, 2 servicios → 2 × $2.200 = $4.400
			obtenerDomiciliario('dom1')!.nivel = 2;
			registrarGeneracionDeuda('dom1', 'ped4', 2200, 2, 2200);
			registrarGeneracionDeuda('dom1', 'ped5', 2200, 2, 2200);
			expect(obtenerDomiciliario('dom1')!.deuda_actual).toBe(8300);

			// Día 3: abono de $5.000
			const r = registrarAbonoDeuda('dom1', 5000, 'Abono parcial');
			expect(r.deuda_actual).toBe(3300); // 8300 - 5000
			expect(r.excedente).toBe(0);

			// Día 4: abono que cubre el resto
			const r2 = registrarAbonoDeuda('dom1', 3300, 'Abono final');
			expect(r2.deuda_actual).toBe(0);
			expect(r2.excedente).toBe(0);
		});

		it('deuda nunca queda negativa', () => {
			crearDomiciliario('dom1', 'Carlos', 1);
			registrarGeneracionDeuda('dom1', 'ped1', 1300, 1, 1300);

			// Abono mayor que la deuda
			const r = registrarAbonoDeuda('dom1', 5000, 'Adelanto');
			expect(r.deuda_actual).toBe(0); // nunca negativa
			expect(r.excedente).toBe(3700);
			expect(r.credito_favor).toBe(3700);
		});

		it('saldo a favor se aplica antes de generar deuda nueva', () => {
			crearDomiciliario('dom1', 'Carlos', 1);

			// Crear deuda y abonar de más → crédito
			registrarGeneracionDeuda('dom1', 'ped1', 1300, 1, 1300);
			registrarAbonoDeuda('dom1', 3000); // crédito = 1700

			// Nuevo servicio: crédito cubre parte
			const r = registrarGeneracionDeuda('dom1', 'ped2', 1300, 1, 1300);
			expect(r.credito_aplicado).toBe(1300);
			expect(r.monto_efectivo).toBe(0);
			expect(r.deuda_actual).toBe(0);
			expect(r.credito_favor).toBe(400); // 1700 - 1300
		});

		it('movimientos guardan nivel y tarifa para auditoría', () => {
			crearDomiciliario('dom1', 'Carlos', 3);

			registrarGeneracionDeuda('dom1', 'ped1', 3500, 3, 3500);
			registrarGeneracionDeuda('dom1', 'ped2', 3500, 3, 3500);

			const movs = movimientos.filter((m) => m.tipo === 'generacion');
			expect(movs).toHaveLength(2);
			expect(movs[0].nivel).toBe(3);
			expect(movs[0].tarifa_aplicada).toBe(3500);
			expect(movs[1].nivel).toBe(3);
			expect(movs[1].tarifa_aplicada).toBe(3500);
		});
	});
});
