/**
 * Tests para el cálculo de tarifas en domicilio normal.
 *
 * Verifica que el recargo por peso y transferencia se calcula
 * dinámicamente con las funciones escalonadas (recargoPeso, recargoTransferencia)
 * en vez de usar valores fijos de la BD.
 */
import { describe, expect, test } from 'vitest';
import {
	recargoPeso,
	recargoTransferencia,
	TABLA_RECARGOS
} from '$lib/logic/tabla-recargos';
import { calcularRecargos, type RecargoSeleccionable } from '$lib/logic/recargos';

// ---------- recargoPeso (escalonado) ----------

describe('recargoPeso — cálculo escalonado', () => {
	test('peso <= 20kg → sin recargo', () => {
		expect(recargoPeso(0)).toBe(0);
		expect(recargoPeso(10)).toBe(0);
		expect(recargoPeso(20)).toBe(0);
	});

	test('peso > 20kg y <= 40kg → $2,000', () => {
		expect(recargoPeso(21)).toBe(2000);
		expect(recargoPeso(30)).toBe(2000);
		expect(recargoPeso(40)).toBe(2000);
	});

	test('peso > 40kg y <= 60kg → $5,000', () => {
		expect(recargoPeso(41)).toBe(5000);
		expect(recargoPeso(50)).toBe(5000);
		expect(recargoPeso(60)).toBe(5000);
	});

	test('peso > 60kg → $10,000', () => {
		expect(recargoPeso(61)).toBe(10000);
		expect(recargoPeso(100)).toBe(10000);
	});

	test('peso negativo → sin recargo (tratado como 0)', () => {
		expect(recargoPeso(-5)).toBe(0);
	});

	test('peso decimal → se usa tal cual (no redondea)', () => {
		expect(recargoPeso(20.5)).toBe(2000); // >20
		expect(recargoPeso(40.1)).toBe(5000); // >40
		expect(recargoPeso(60.9)).toBe(10000); // >60
	});
});

// ---------- recargoTransferencia (escalonado) ----------

describe('recargoTransferencia — cálculo escalonado', () => {
	test('monto <= $100,000 → sin recargo', () => {
		expect(recargoTransferencia(0)).toBe(0);
		expect(recargoTransferencia(50000)).toBe(0);
		expect(recargoTransferencia(100000)).toBe(0);
	});

	test('monto > $100,000 y <= $500,000 → $2,000', () => {
		expect(recargoTransferencia(100001)).toBe(2000);
		expect(recargoTransferencia(300000)).toBe(2000);
		expect(recargoTransferencia(500000)).toBe(2000);
	});

	test('monto > $500,000 y <= $1,000,000 → $4,000', () => {
		expect(recargoTransferencia(500001)).toBe(4000);
		expect(recargoTransferencia(750000)).toBe(4000);
		expect(recargoTransferencia(1000000)).toBe(4000);
	});

	test('monto > $1,000,000 → $6,000', () => {
		expect(recargoTransferencia(1000001)).toBe(6000);
		expect(recargoTransferencia(2000000)).toBe(6000);
	});

	test('monto negativo → sin recargo', () => {
		expect(recargoTransferencia(-1000)).toBe(0);
	});
});

// ---------- Integración: domicilio normal con recargos dinámicos ----------

describe('domicilio normal — cálculo integrado', () => {
	/**
	 * Simula el flujo del frontend: calcularRecargos() obtiene valores de BD,
	 * luego el frontend reemplaza peso/transferencia con valores dinámicos.
	 */
	const CATALOGO: RecargoSeleccionable[] = [
		{ codigo: 'peso_extra', nombre: 'Peso extra', valor: 0, activo: true },
		{ codigo: 'transferencias', nombre: 'Transferencia', valor: 0, activo: true },
		{ codigo: 'compra_tiempo', nombre: 'Tiempo espera', valor: 3000, activo: true }
	];

	test('peso 25kg genera recargo de $2,000 (no el valor fijo de BD)', () => {
		// El catálogo tiene valor 0 para peso_extra (placeholder en BD)
		const rec = calcularRecargos(CATALOGO, ['peso_extra']);
		expect(rec.aplicados).toHaveLength(1);
		expect(rec.aplicados[0].codigo).toBe('peso_extra');
		// Valor de BD es 0 (placeholder)
		expect(rec.aplicados[0].valor).toBe(0);

		// El frontend reemplaza con el valor dinámico
		const peso = 25;
		const valorDinamico = recargoPeso(peso);
		expect(valorDinamico).toBe(2000);

		// El total final usa el valor dinámico
		const total = rec.aplicados.map((r) =>
			r.codigo === 'peso_extra' ? { ...r, valor: valorDinamico } : r
		).reduce((s, r) => s + r.valor, 0);
		expect(total).toBe(2000);
	});

	test('transferencia $150,000 genera recargo de $2,000', () => {
		const rec = calcularRecargos(CATALOGO, ['transferencias']);
		expect(rec.aplicados).toHaveLength(1);

		const monto = 150000;
		const valorDinamico = recargoTransferencia(monto);
		expect(valorDinamico).toBe(2000);
	});

	test('peso 50kg + transferencia $600,000 → recargos escalonados correctos', () => {
		const rec = calcularRecargos(CATALOGO, ['peso_extra', 'transferencias']);
		expect(rec.aplicados).toHaveLength(2);

		const peso = 50;
		const monto = 600000;
		const valorPeso = recargoPeso(peso);
		const valorTransfer = recargoTransferencia(monto);

		expect(valorPeso).toBe(5000); // >40kg
		expect(valorTransfer).toBe(4000); // >$500k

		const total = valorPeso + valorTransfer;
		expect(total).toBe(9000);
	});

	test('peso 15kg + transferencia $50,000 → ambos sin recargo', () => {
		const peso = 15;
		const monto = 50000;

		expect(recargoPeso(peso)).toBe(0);
		expect(recargoTransferencia(monto)).toBe(0);
	});

	test('peso 100kg + transferencia $2,000,000 → máximos escalonados', () => {
		const peso = 100;
		const monto = 2000000;

		expect(recargoPeso(peso)).toBe(10000); // >60kg
		expect(recargoTransferencia(monto)).toBe(6000); // >$1M

		const total = recargoPeso(peso) + recargoTransferencia(monto);
		expect(total).toBe(16000);
	});
});

// ---------- Verificación de constantes ----------

describe('tabla-recargos — constantes correctas', () => {
	test('peso tiene los umbrales correctos', () => {
		expect(TABLA_RECARGOS.peso.mas_20kg).toBe(2000);
		expect(TABLA_RECARGOS.peso.mas_40kg).toBe(5000);
		expect(TABLA_RECARGOS.peso.mas_60kg).toBe(10000);
	});

	test('transferencias tiene los umbrales correctos', () => {
		expect(TABLA_RECARGOS.transferencias.despues_100000).toBe(2000);
		expect(TABLA_RECARGOS.transferencias.despues_500000).toBe(4000);
		expect(TABLA_RECARGOS.transferencias.despues_1000000).toBe(6000);
	});

	test('pagos tiene las tarifas planas correctas', () => {
		expect(TABLA_RECARGOS.pagos.bancario).toBe(12000);
		expect(TABLA_RECARGOS.pagos.corresponsal).toBe(8000);
	});

	test('recargo_pagos_altos tiene el valor correcto', () => {
		expect(TABLA_RECARGOS.recargo_pagos_altos.por_millon_adicional).toBe(2000);
	});
});
