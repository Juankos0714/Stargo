import { describe, expect, test } from 'vitest';
import { calcularBaseSugerida } from '../../src/lib/logic/base-necesaria';

describe('calcularBaseSugerida', () => {
	test('sin mandado ni tarifa: solo recargos', () => {
		expect(
			calcularBaseSugerida({ valorMandado: 0, recargoTotal: 5000, tarifaServicio: 0 })
		).toBe(5000);
	});

	test('con mandado y recargos, sin tarifa (compra/diligencia)', () => {
		expect(
			calcularBaseSugerida({ valorMandado: 85000, recargoTotal: 12000, tarifaServicio: 0 })
		).toBe(97000);
	});

	test('con mandado + recargos + tarifa (domicilio con mandado)', () => {
		expect(
			calcularBaseSugerida({ valorMandado: 50000, recargoTotal: 8000, tarifaServicio: 6000 })
		).toBe(64000);
	});

	test('todo en cero retorna 0', () => {
		expect(
			calcularBaseSugerida({ valorMandado: 0, recargoTotal: 0, tarifaServicio: 0 })
		).toBe(0);
	});

	test('valores negativos producen 0 (Math.max)', () => {
		expect(
			calcularBaseSugerida({ valorMandado: -1000, recargoTotal: -500, tarifaServicio: 0 })
		).toBe(0);
	});

	test('redondea decimales', () => {
		expect(
			calcularBaseSugerida({ valorMandado: 1000.4, recargoTotal: 2000.6, tarifaServicio: 0 })
		).toBe(3001);
	});

	test('solo mandado sin recargos ni tarifa', () => {
		expect(
			calcularBaseSugerida({ valorMandado: 150000, recargoTotal: 0, tarifaServicio: 0 })
		).toBe(150000);
	});
});
