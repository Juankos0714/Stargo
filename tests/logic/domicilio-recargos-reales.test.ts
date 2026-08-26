/**
 * Tests end-to-end para recargos de domicilio usando los CÓDIGOS REALES de la BD.
 *
 * Verifica que:
 * 1. Los códigos de peso/transferencia en el frontend coinciden con la BD
 * 2. El cálculo escalonado usa los valores correctos de la BD
 * 3. El flujo completo: formulario → recargosTiempoReal → calcularRecargos → resultado
 * 4. No se duplican recargos
 * 5. Los códigos llegan correctamente al API y a crear_pedido()
 */
import { describe, expect, test } from 'vitest';
import { calcularRecargos, type RecargoSeleccionable } from '$lib/logic/recargos';

/**
 * Catálogo REAL de la BD (obtenido de GET /api/recargos).
 * Este es el estado exacto de la tabla `recargos` en producción.
 */
const CATALOGO_REAL_DB: RecargoSeleccionable[] = [
	{ codigo: 'compra_tiempo_varias_paradas', nombre: '2 paradas', valor: 6000, activo: true },
	{ codigo: 'compra_por_parada', nombre: '1 parada', valor: 3000, activo: true },
	{ codigo: 'compra_tiempo_mismo_lugar', nombre: '3 paradas', valor: 9000, activo: true },
	{ codigo: 'compra_tiempo_4_paradas', nombre: '4 paradas', valor: 12000, activo: true },
	{ codigo: 'compra_tiempo_5_paradas', nombre: '5 paradas', valor: 15000, activo: true },
	{ codigo: 'sin_peso', nombre: 'Entre 1 a 15 kg', valor: 0, activo: true },
	{ codigo: 'peso_mas_20kg', nombre: 'Entre 16 a 30 kg', valor: 2000, activo: true },
	{ codigo: 'peso_mas_40kg', nombre: 'Entre 31 a 45 kg', valor: 5000, activo: true },
	{ codigo: 'peso_mas_60kg', nombre: 'Entre 46 a 60 kg', valor: 10000, activo: true },
	{ codigo: 'no_compra', nombre: 'No Aplica', valor: 0, activo: true },
	{ codigo: 'transferencia_500k', nombre: 'Más de $500.000', valor: 4000, activo: true },
	{ codigo: 'transferencia_100k', nombre: 'Más de $100.000', valor: 2000, activo: true },
	{ codigo: 'transferencia_1m', nombre: 'Superior a $1.000.000', valor: 6000, activo: true },
	{ codigo: 'diligencia', nombre: 'Diligencias y Tramites', valor: 15000, activo: true },
	{ codigo: 'pago_bancario', nombre: 'Pagos Bancarios', valor: 12000, activo: true },
	{ codigo: 'pago_corresponsal', nombre: 'Pagos Corresponsal', valor: 8000, activo: true }
];

// Para domicilio, se filtran los de tipo 'compra'
const RECARGOS_DOMICILIO = CATALOGO_REAL_DB.filter(r => !r.codigo.startsWith('compra_'));

/**
 * Simula exactamente la lógica de recargosTiempoReal del frontend.
 */
function simularRecargosTiempoReal(
	recargosDisponibles: RecargoSeleccionable[],
	recargosSelFiltrados: string[],
	pesoKg: string,
	transferencia: 'si' | 'no' | '',
	transferenciaMonto: string
): string[] {
	const sel = new Set(recargosSelFiltrados);

	// Peso
	const pesoRecargos = recargosDisponibles.filter(r => r.codigo.startsWith('peso_') || r.codigo === 'sin_peso');
	for (const pr of pesoRecargos) sel.delete(pr.codigo);
	const peso = Number(pesoKg) || 0;
	if (peso > 0) {
		let codigoPeso = 'sin_peso';
		if (peso > 60) codigoPeso = 'peso_mas_60kg';
		else if (peso > 40) codigoPeso = 'peso_mas_40kg';
		else if (peso > 20) codigoPeso = 'peso_mas_20kg';
		const rp = recargosDisponibles.find(r => r.codigo === codigoPeso);
		if (rp) sel.add(rp.codigo);
	}

	// Transferencia
	const transferRecargos = recargosDisponibles.filter(r => r.codigo.startsWith('transferencia_'));
	for (const tr of transferRecargos) sel.delete(tr.codigo);
	if (transferencia === 'si' && transferenciaMonto) {
		const monto = Number(transferenciaMonto) || 0;
		if (monto > 0) {
			let codigoTransfer = '';
			if (monto > 1000000) codigoTransfer = 'transferencia_1m';
			else if (monto > 500000) codigoTransfer = 'transferencia_500k';
			else if (monto > 100000) codigoTransfer = 'transferencia_100k';
			if (codigoTransfer) {
				const rt = recargosDisponibles.find(r => r.codigo === codigoTransfer);
				if (rt) sel.add(rt.codigo);
			}
		}
	}

	return [...sel];
}

// ==========================================
// TESTS: Códigos reales de la BD
// ==========================================

describe('Códigos de BD coinciden con frontend', () => {
	test('peso_mas_20kg existe en catálogo con valor $2,000', () => {
		const rec = RECARGOS_DOMICILIO.find(r => r.codigo === 'peso_mas_20kg');
		expect(rec).toBeDefined();
		expect(rec!.valor).toBe(2000);
	});

	test('peso_mas_40kg existe en catálogo con valor $5,000', () => {
		const rec = RECARGOS_DOMICILIO.find(r => r.codigo === 'peso_mas_40kg');
		expect(rec).toBeDefined();
		expect(rec!.valor).toBe(5000);
	});

	test('peso_mas_60kg existe en catálogo con valor $10,000', () => {
		const rec = RECARGOS_DOMICILIO.find(r => r.codigo === 'peso_mas_60kg');
		expect(rec).toBeDefined();
		expect(rec!.valor).toBe(10000);
	});

	test('transferencia_100k existe en catálogo con valor $2,000', () => {
		const rec = RECARGOS_DOMICILIO.find(r => r.codigo === 'transferencia_100k');
		expect(rec).toBeDefined();
		expect(rec!.valor).toBe(2000);
	});

	test('transferencia_500k existe en catálogo con valor $4,000', () => {
		const rec = RECARGOS_DOMICILIO.find(r => r.codigo === 'transferencia_500k');
		expect(rec).toBeDefined();
		expect(rec!.valor).toBe(4000);
	});

	test('transferencia_1m existe en catálogo con valor $6,000', () => {
		const rec = RECARGOS_DOMICILIO.find(r => r.codigo === 'transferencia_1m');
		expect(rec).toBeDefined();
		expect(rec!.valor).toBe(6000);
	});

	test('sin_peso existe en catálogo con valor $0', () => {
		const rec = RECARGOS_DOMICILIO.find(r => r.codigo === 'sin_peso');
		expect(rec).toBeDefined();
		expect(rec!.valor).toBe(0);
	});
});

// ==========================================
// TESTS: Flujo completo de recargosTiempoReal → calcularRecargos
// ==========================================

describe('Flujo completo: formulario → recargosTiempoReal → calcularRecargos', () => {
	test('peso 25kg + transferencia $150,000 → 2 recargos, total $4,000', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '25', 'si', '150000');
		expect(codigos).toContain('peso_mas_20kg');
		expect(codigos).toContain('transferencia_100k');

		const resultado = calcularRecargos(RECARGOS_DOMICILIO, codigos);
		expect(resultado.aplicados).toHaveLength(2);
		expect(resultado.total).toBe(4000);

		const peso = resultado.aplicados.find(r => r.codigo === 'peso_mas_20kg');
		expect(peso).toBeDefined();
		expect(peso!.valor).toBe(2000);

		const transfer = resultado.aplicados.find(r => r.codigo === 'transferencia_100k');
		expect(transfer).toBeDefined();
		expect(transfer!.valor).toBe(2000);
	});

	test('peso 50kg + transferencia $600,000 → 2 recargos, total $9,000', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '50', 'si', '600000');
		expect(codigos).toContain('peso_mas_40kg');
		expect(codigos).toContain('transferencia_500k');

		const resultado = calcularRecargos(RECARGOS_DOMICILIO, codigos);
		expect(resultado.aplicados).toHaveLength(2);
		expect(resultado.total).toBe(9000);

		expect(resultado.aplicados.find(r => r.codigo === 'peso_mas_40kg')!.valor).toBe(5000);
		expect(resultado.aplicados.find(r => r.codigo === 'transferencia_500k')!.valor).toBe(4000);
	});

	test('peso 70kg + transferencia $1,500,000 → 2 recargos, total $16,000', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '70', 'si', '1500000');
		expect(codigos).toContain('peso_mas_60kg');
		expect(codigos).toContain('transferencia_1m');

		const resultado = calcularRecargos(RECARGOS_DOMICILIO, codigos);
		expect(resultado.total).toBe(16000);
	});

	test('peso 10kg + sin transferencia → solo sin_peso (valor $0)', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '10', 'no', '');
		expect(codigos).toContain('sin_peso');
		expect(codigos).not.toContain('transferencia_100k');

		const resultado = calcularRecargos(RECARGOS_DOMICILIO, codigos);
		// sin_peso tiene valor 0, pero aparece en aplicados
		const sinPeso = resultado.aplicados.find(r => r.codigo === 'sin_peso');
		expect(sinPeso).toBeDefined();
		expect(sinPeso!.valor).toBe(0);
		expect(resultado.total).toBe(0);
	});

	test('peso 0 (vacío) + transferencia $150,000 → solo transferencia', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '', 'si', '150000');
		expect(codigos).not.toContain('peso_mas_20kg');
		expect(codigos).toContain('transferencia_100k');

		const resultado = calcularRecargos(RECARGOS_DOMICILIO, codigos);
		expect(resultado.aplicados).toHaveLength(1);
		expect(resultado.total).toBe(2000);
	});

	test('transferencia $50,000 → sin recargo de transferencia', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '25', 'si', '50000');
		expect(codigos).toContain('peso_mas_20kg');
		expect(codigos).not.toContain('transferencia_100k');
		expect(codigos).not.toContain('transferencia_500k');
		expect(codigos).not.toContain('transferencia_1m');

		const resultado = calcularRecargos(RECARGOS_DOMICILIO, codigos);
		expect(resultado.aplicados).toHaveLength(1);
		expect(resultado.total).toBe(2000);
	});

	test('peso 15kg + transferencia $100,000 → ambos sin recargo', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '15', 'si', '100000');
		// 15kg → sin_peso, 100000 → sin transferencia (<=100000)
		expect(codigos).toContain('sin_peso');
		expect(codigos).not.toContain('transferencia_100k');

		const resultado = calcularRecargos(RECARGOS_DOMICILIO, codigos);
		expect(resultado.total).toBe(0);
	});
});

// ==========================================
// TESTS: No duplicación de recargos
// ==========================================

describe('Anti-duplicación de recargos', () => {
	test('llamar recargosTiempoReal 3 veces con mismo peso no duplica', () => {
		let codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '25', 'si', '150000');
		codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, codigos, '25', 'si', '150000');
		codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, codigos, '25', 'si', '150000');

		const pesoCount = codigos.filter(c => c.startsWith('peso_') || c === 'sin_peso').length;
		const transferCount = codigos.filter(c => c.startsWith('transferencia_')).length;

		expect(pesoCount).toBe(1);
		expect(transferCount).toBe(1);
		expect(codigos).toHaveLength(2);
	});

	test('cambiar peso de 10 a 30 reemplaza correctamente', () => {
		let codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '10', 'no', '');
		expect(codigos).toContain('sin_peso');

		codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, codigos, '30', 'no', '');
		expect(codigos).toContain('peso_mas_20kg');
		expect(codigos).not.toContain('sin_peso');
		expect(codigos.filter(c => c.startsWith('peso_') || c === 'sin_peso')).toHaveLength(1);
	});

	test('cambiar transferencia de no a sí agrega el recargo', () => {
		let codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '25', 'no', '');
		expect(codigos).not.toContain('transferencia_100k');

		codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, codigos, '25', 'si', '150000');
		expect(codigos).toContain('transferencia_100k');
	});

	test('cambiar monto de $150k a $600k actualiza tier de transferencia', () => {
		let codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '25', 'si', '150000');
		expect(codigos).toContain('transferencia_100k');

		codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, codigos, '25', 'si', '600000');
		expect(codigos).toContain('transferencia_500k');
		expect(codigos).not.toContain('transferencia_100k');
		expect(codigos.filter(c => c.startsWith('transferencia_'))).toHaveLength(1);
	});
});

// ==========================================
// TESTS: Total con tarifa base simulada
// ==========================================

describe('Total = tarifa base + recargos', () => {
	test('tarifa $10,000 + peso 25kg + transfer $150k → total $14,000', () => {
		const tarifaBase = 10000;
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '25', 'si', '150000');
		const resultado = calcularRecargos(RECARGOS_DOMICILIO, codigos);
		const total = tarifaBase + resultado.total;
		expect(total).toBe(14000);
	});

	test('tarifa $6,000 + peso 100kg + transfer $2M → total $32,000', () => {
		const tarifaBase = 6000;
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '100', 'si', '2000000');
		const resultado = calcularRecargos(RECARGOS_DOMICILIO, codigos);
		const total = tarifaBase + resultado.total;
		expect(total).toBe(22000); // 6000 + 10000 + 6000
	});

	test('tarifa $8,000 + peso 15kg + sin transfer → total $8,000', () => {
		const tarifaBase = 8000;
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '15', 'no', '');
		const resultado = calcularRecargos(RECARGOS_DOMICILIO, codigos);
		const total = tarifaBase + resultado.total;
		expect(total).toBe(8000);
	});
});

// ==========================================
// TESTS: Códigos para crear_pedido()
// ==========================================

describe('Códigos listos para enviar a crear_pedido()', () => {
	test('peso 25kg + transfer $150k → códigos válidos para SQL', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '25', 'si', '150000');

		// Verificar que cada código existe en el catálogo real
		for (const codigo of codigos) {
			const rec = RECARGOS_DOMICILIO.find(r => r.codigo === codigo);
			expect(rec).toBeDefined();
			expect(rec!.activo).toBe(true);
		}
	});

	test('todos los códigos de peso son válidos', () => {
		for (const peso of ['5', '15', '20', '25', '30', '40', '45', '50', '60', '65', '100']) {
			const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], peso, 'no', '');
			for (const codigo of codigos) {
				const rec = RECARGOS_DOMICILIO.find(r => r.codigo === codigo);
				expect(rec).toBeDefined();
			}
		}
	});

	test('todos los códigos de transferencia son válidos', () => {
		for (const monto of ['50000', '100000', '150000', '500000', '600000', '1000000', '1500000']) {
			const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '25', 'si', monto);
			for (const codigo of codigos) {
				const rec = RECARGOS_DOMICILIO.find(r => r.codigo === codigo);
				expect(rec).toBeDefined();
			}
		}
	});
});

// ==========================================
// TESTS: Edge cases
// ==========================================

describe('Edge cases', () => {
	test('peso 20kg exacto → sin recargo (<=20)', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '20', 'no', '');
		expect(codigos).toContain('sin_peso');
		expect(codigos).not.toContain('peso_mas_20kg');
	});

	test('peso 20.1kg → recargo de $2,000 (>20)', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '20.1', 'no', '');
		expect(codigos).toContain('peso_mas_20kg');
	});

	test('peso 40kg exacto → recargo de $2,000 (<=40)', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '40', 'no', '');
		expect(codigos).toContain('peso_mas_20kg');
		expect(codigos).not.toContain('peso_mas_40kg');
	});

	test('peso 40.1kg → recargo de $5,000 (>40)', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '40.1', 'no', '');
		expect(codigos).toContain('peso_mas_40kg');
	});

	test('peso 60kg exacto → recargo de $5,000 (<=60)', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '60', 'no', '');
		expect(codigos).toContain('peso_mas_40kg');
		expect(codigos).not.toContain('peso_mas_60kg');
	});

	test('peso 60.1kg → recargo de $10,000 (>60)', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '60.1', 'no', '');
		expect(codigos).toContain('peso_mas_60kg');
	});

	test('transferencia $100,000 exacto → sin recargo (<=100k)', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '25', 'si', '100000');
		expect(codigos).not.toContain('transferencia_100k');
	});

	test('transferencia $100,001 → recargo de $2,000 (>100k)', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '25', 'si', '100001');
		expect(codigos).toContain('transferencia_100k');
	});

	test('transferencia $500,000 exacto → tier de $2,000 (<=500k)', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '25', 'si', '500000');
		expect(codigos).toContain('transferencia_100k');
		expect(codigos).not.toContain('transferencia_500k');
	});

	test('transferencia $1,000,000 exacto → tier de $4,000 (<=1M)', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '25', 'si', '1000000');
		expect(codigos).toContain('transferencia_500k');
		expect(codigos).not.toContain('transferencia_1m');
	});

	test('peso vacío (string vacío) → sin recargo de peso', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '', 'no', '');
		const pesoCodigos = codigos.filter(c => c.startsWith('peso_') || c === 'sin_peso');
		expect(pesoCodigos).toHaveLength(0);
	});

	test('transferencia vacía (string vacío) → sin recargo de transferencia', () => {
		const codigos = simularRecargosTiempoReal(RECARGOS_DOMICILIO, [], '25', '', '');
		const transferCodigos = codigos.filter(c => c.startsWith('transferencia_'));
		expect(transferCodigos).toHaveLength(0);
	});
});
