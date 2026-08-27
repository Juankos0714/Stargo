/**
 * Tests: Ledger de deuda (Fase 23)
 *
 * Verifica la lógica de acumulación de deuda y abonos usando un ledger
 * en memoria que simula el comportamiento de las RPCs de PostgreSQL.
 *
 * La lógica real vive en las RPCs (registrar_generacion_deuda,
 * registrar_abono_deuda). Estos tests validan las REGLAS DE NEGOCIO
 * usando una simulación en TypeScript que espeja la lógica SQL.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ============================================================
// Simulación del ledger (espeja las RPCs de PostgreSQL)
// ============================================================

interface Domiciliario {
	id: string;
	nombre: string;
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

function crearDomiciliario(id: string, nombre: string): Domiciliario {
	const dom = { id, nombre, deuda_actual: 0, credito_favor: 0 };
	domiciliarios.set(id, dom);
	return dom;
}

/**
 * Simula registrar_generacion_deuda:
 * 1. Aplica crédito a favor primero
 * 2. Incrementa deuda_actual con el monto efectivo
 * 3. Registra en el ledger
 */
function registrarGeneracionDeuda(
	domiciliarioId: string,
	pedidoId: string,
	monto: number
): { monto: number; monto_efectivo: number; credito_aplicado: number; deuda_actual: number; credito_favor: number } {
	const dom = domiciliarios.get(domiciliarioId);
	if (!dom) throw new Error('Domiciliario no encontrado');
	if (monto < 0) throw new Error('El monto no puede ser negativo');
	if (monto === 0) {
		return { monto: 0, monto_efectivo: 0, credito_aplicado: 0, deuda_actual: dom.deuda_actual, credito_favor: dom.credito_favor };
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
			notas: 'Comisión generada por pedido',
			creado_en: new Date()
		});
	}

	return {
		monto,
		monto_efectivo: montoEfectivo,
		credito_aplicado: creditoAplicado,
		deuda_actual: dom.deuda_actual,
		credito_favor: dom.credito_favor
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
		it('deuda se acumula correctamente a través de varios días', () => {
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
});
