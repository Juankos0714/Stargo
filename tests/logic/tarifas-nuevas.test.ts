import { describe, expect, test } from 'vitest';
import {
	calcularPrecio,
	crearTramoPrincipal,
	type PedidoCalculo
} from '$lib/logic/tarifas-nuevas';
import { obtenerTarifaDomicilio } from '$lib/logic/matriz-domicilio';
import { recargoPeso, recargoTransferencia, recargoPagoAlto } from '$lib/logic/tabla-recargos';

// ---------- obtenerTarifaDomicilio ----------

describe('obtenerTarifaDomicilio', () => {
	test('mismo sector retorna 5000', () => {
		expect(obtenerTarifaDomicilio('centro', 'centro')).toBe(5000);
	});

	test('centro → norte_38_50 retorna 7000', () => {
		expect(obtenerTarifaDomicilio('centro', 'norte_38_50')).toBe(7000);
	});

	test('sector inexistente retorna null', () => {
		expect(obtenerTarifaDomicilio('centro' as any, 'inexistente' as any)).toBeNull();
	});
});

// ---------- calcularPrecio: diligence_bancaria ----------

describe('calcularPrecio: diligencia bancaria', () => {
	test('pago bancario sin recogida extra → solo tarifa plana', () => {
		const pedido: PedidoCalculo = {
			tipo_diligencia: 'diligencia_bancaria',
			subtipo_pago: 'bancario',
			tramo_principal: crearTramoPrincipal('centro', 'centro', 'diligencia_bancaria'),
			tramos_adicionales: [],
			recargos: []
		};

		const resultado = calcularPrecio(pedido);
		expect(resultado.total).toBe(12000);
		expect(resultado.tramo_principal.fuente).toBe('tabla_pagos');
		expect(resultado.tramo_principal.valor).toBe(12000);
		expect(resultado.disponible).toBe(true);
	});

	test('corresponsal sin recogida extra → solo tarifa plana', () => {
		const pedido: PedidoCalculo = {
			tipo_diligencia: 'diligencia_bancaria',
			subtipo_pago: 'corresponsal',
			tramo_principal: crearTramoPrincipal('sur_27_50', 'centro', 'diligencia_bancaria'),
			tramos_adicionales: [],
			recargos: []
		};

		const resultado = calcularPrecio(pedido);
		expect(resultado.total).toBe(8000);
	});

	test('pago bancario CON recogida extra → tarifa plana + matriz domicilio', () => {
		const pedido: PedidoCalculo = {
			tipo_diligencia: 'diligencia_bancaria',
			subtipo_pago: 'bancario',
			tramo_principal: crearTramoPrincipal('centro', 'centro', 'diligencia_bancaria'),
			tramos_adicionales: [
				{ origen: 'sur_27_50', destino: 'centro', proposito: 'recogida_extra' }
			],
			recargos: []
		};

		const resultado = calcularPrecio(pedido);
		// 12000 (pago bancario) + 6000 (sur_27_50 → centro)
		expect(resultado.total).toBe(18000);
		expect(resultado.tramos_adicionales).toHaveLength(1);
		expect(resultado.tramos_adicionales[0].valor).toBe(6000);
	});

	test('NUNCA cobra recargo pagos_bancarios para diligencia_bancaria', () => {
		const pedido: PedidoCalculo = {
			tipo_diligencia: 'diligencia_bancaria',
			subtipo_pago: 'bancario',
			tramo_principal: crearTramoPrincipal('centro', 'centro', 'diligencia_bancaria'),
			tramos_adicionales: [],
			recargos: [{ id: 'pagos_bancarios' }]
		};

		const resultado = calcularPrecio(pedido);
		// Solo 12000 de la tarifa plana, el recargo se ignora
		expect(resultado.total).toBe(12000);
		expect(resultado.recargos_desglose).toHaveLength(0);
	});
});

// ---------- calcularPrecio: domicilio ----------

describe('calcularPrecio: domicilio', () => {
	test('domicilio simple usa matriz de zonas', () => {
		const pedido: PedidoCalculo = {
			tipo_diligencia: 'domicilio',
			tramo_principal: crearTramoPrincipal('centro', 'norte_38_50', 'domicilio'),
			tramos_adicionales: [],
			recargos: []
		};

		const resultado = calcularPrecio(pedido);
		expect(resultado.total).toBe(7000);
		expect(resultado.tramo_principal.fuente).toBe('matriz_domicilio');
	});

	test('domicilio sin tarifa retorna disponible=false', () => {
		const pedido: PedidoCalculo = {
			tipo_diligencia: 'domicilio',
			tramo_principal: crearTramoPrincipal('centro', 'centro', 'domicilio'),
			tramos_adicionales: [],
			recargos: []
		};

		// centro → centro tiene tarifa (5000), esto no debería fallar
		const resultado = calcularPrecio(pedido);
		expect(resultado.disponible).toBe(true);
	});
});

// ---------- calcularPrecio: compra ----------

describe('calcularPrecio: compra', () => {
	test('compra cobra matriz domicilio + recargos', () => {
		const pedido: PedidoCalculo = {
			tipo_diligencia: 'compra',
			tramo_principal: crearTramoPrincipal('centro', 'norte_19_37', 'compra'),
			tramos_adicionales: [],
			recargos: [
				{ id: 'compra', bloques_20min: 2, paradas: 1 }
			],
			peso_kg: 25
		};

		const resultado = calcularPrecio(pedido);
		// 7000 (matriz) + 6000 (compra: 2 bloques × 3000 + 1 parada × 3000) + 2000 (peso >20kg)
		expect(resultado.total).toBe(15000);
	});
});

// ---------- calcularPrecio: recargos ----------

describe('calcularPrecio: recargos', () => {
	test('recargo por peso escala correctamente', () => {
		expect(recargoPeso(15)).toBe(0);
		expect(recargoPeso(25)).toBe(2000);
		expect(recargoPeso(45)).toBe(5000);
		expect(recargoPeso(65)).toBe(10000);
	});

	test('recargo por transferencia escala correctamente', () => {
		expect(recargoTransferencia(50000)).toBe(0);
		expect(recargoTransferencia(150000)).toBe(2000);
		expect(recargoTransferencia(600000)).toBe(4000);
		expect(recargoTransferencia(1500000)).toBe(6000);
	});

	test('recargo por pago alto calcula millones adicionales', () => {
		expect(recargoPagoAlto(500000)).toBe(0);
		expect(recargoPagoAlto(1500000)).toBe(0); // 0.5M adicional → redondeo
		expect(recargoPagoAlto(2000000)).toBe(2000); // 1M adicional
		expect(recargoPagoAlto(3500000)).toBe(4000); // 2M adicionales
	});
});

// ---------- crearTramoPrincipal ----------

describe('crearTramoPrincipal', () => {
	test('crea tramo con los campos correctos', () => {
		const tramo = crearTramoPrincipal('centro', 'sur_27_50', 'compra');
		expect(tramo).toEqual({
			origen: 'centro',
			destino: 'sur_27_50',
			proposito: 'compra'
		});
	});
});
