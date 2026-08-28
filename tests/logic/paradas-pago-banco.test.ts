/**
 * Tests para el recargo de paradas en tipos de pago/banco (corresponsal).
 *
 * Verifica que:
 * 1. El código virtual 'paradas' es aceptado por filtrarRecargosServidor
 * 2. El motor de tarifas calcula correctamente el costo de paradas
 * 3. La matriz de recargos incluye 'paradas' como visible para pago/banco
 * 4. El cálculo de paradas usa el valor correcto de la tabla ($3,000/parada)
 * 5. El flujo completo: formulario → calcular → confirmar envía códigos válidos
 */
import { describe, expect, test } from 'vitest';
import { filtrarRecargosServidor, MATRIZ_RECARGOS } from '$lib/logic/matriz-recargos';
import {
	calcularPrecio,
	crearTramoPrincipal,
	type PedidoCalculo,
	type RecargoSeleccionado
} from '$lib/logic/tarifas-nuevas';
import { TABLA_RECARGOS } from '$lib/logic/tabla-recargos';

// ==========================================
// 1. Matriz de recargos: paradas visible para pago/banco
// ==========================================

describe('MATRIZ_RECARGOS: paradas para pago/banco', () => {
	test('paradas es visible para tipo pago', () => {
		expect(MATRIZ_RECARGOS.pago.visibles).toContain('paradas');
	});

	test('paradas es visible para tipo banco', () => {
		expect(MATRIZ_RECARGOS.banco.visibles).toContain('paradas');
	});

	test('paradas es visible para tipo compra', () => {
		expect(MATRIZ_RECARGOS.compra.visibles).toContain('paradas');
	});

	test('paradas es visible para tipo tramite', () => {
		expect(MATRIZ_RECARGOS.tramite.visibles).toContain('paradas');
	});

	test('paradas es visible para tipo otro', () => {
		expect(MATRIZ_RECARGOS.otro.visibles).toContain('paradas');
	});

	test('paradas NO está en ocultos para pago', () => {
		expect(MATRIZ_RECARGOS.pago.ocultos).not.toContain('paradas');
	});

	test('paradas NO está en ocultos para banco', () => {
		expect(MATRIZ_RECARGOS.banco.ocultos).not.toContain('paradas');
	});
});

// ==========================================
// 2. filtrarRecargosServidor: acepta 'paradas' como código virtual
// ==========================================

describe('filtrarRecargosServidor: código virtual paradas', () => {
	test('acepta paradas para tipo pago sin registro en BD', () => {
		const tiposPorCodigo = new Map<string, string>();
		// No hay registro de 'paradas' en la BD (es virtual)

		const resultado = filtrarRecargosServidor('pago', ['paradas'], tiposPorCodigo);

		expect(resultado.validos).toContain('paradas');
		expect(resultado.error).toBeUndefined();
	});

	test('acepta paradas con cantidad serializada para tipo pago', () => {
		const tiposPorCodigo = new Map<string, string>();

		const resultado = filtrarRecargosServidor('pago', ['paradas:2'], tiposPorCodigo);

		expect(resultado.validos).toEqual(['paradas:2']);
		expect(resultado.error).toBeUndefined();
	});

	test('acepta paradas para tipo banco sin registro en BD', () => {
		const tiposPorCodigo = new Map<string, string>();

		const resultado = filtrarRecargosServidor('banco', ['paradas'], tiposPorCodigo);

		expect(resultado.validos).toContain('paradas');
		expect(resultado.error).toBeUndefined();
	});

	test('acepta paradas junto con otros recargos válidos', () => {
		const tiposPorCodigo = new Map<string, string>([
			['transferencia_100k', 'transferencia'],
			['tiempo_espera', 'tiempo_espera']
		]);

		const resultado = filtrarRecargosServidor('pago', ['transferencia_100k', 'paradas', 'tiempo_espera'], tiposPorCodigo);

		expect(resultado.validos).toContain('transferencia_100k');
		expect(resultado.validos).toContain('paradas');
		expect(resultado.validos).toContain('tiempo_espera');
		expect(resultado.error).toBeUndefined();
	});

	test('rechaza recargos no válidos pero acepta paradas', () => {
		const tiposPorCodigo = new Map<string, string>([
			['compra_test', 'compra'] // tipo 'compra' no visible para 'pago'
		]);

		const resultado = filtrarRecargosServidor('pago', ['compra_test', 'paradas'], tiposPorCodigo);

		expect(resultado.validos).toContain('paradas');
		expect(resultado.validos).not.toContain('compra_test');
		expect(resultado.error).toContain('compra_test');
	});

	test('paradas se acepta para tipo compra', () => {
		const tiposPorCodigo = new Map<string, string>();

		const resultado = filtrarRecargosServidor('compra', ['paradas'], tiposPorCodigo);

		expect(resultado.validos).toContain('paradas');
		expect(resultado.error).toBeUndefined();
	});

	test('paradas se acepta para tipo tramite', () => {
		const tiposPorCodigo = new Map<string, string>();

		const resultado = filtrarRecargosServidor('tramite', ['paradas'], tiposPorCodigo);

		expect(resultado.validos).toContain('paradas');
		expect(resultado.error).toBeUndefined();
	});

	test('paradas se acepta para tipo otro', () => {
		const tiposPorCodigo = new Map<string, string>();

		const resultado = filtrarRecargosServidor('otro', ['paradas'], tiposPorCodigo);

		expect(resultado.validos).toContain('paradas');
		expect(resultado.error).toBeUndefined();
	});

	test('sin tipo de diligencia: todos los recargos se aceptan (incluido paradas)', () => {
		const tiposPorCodigo = new Map<string, string>();

		const resultado = filtrarRecargosServidor(null, ['paradas', 'otro_codigo'], tiposPorCodigo);

		expect(resultado.validos).toEqual(['paradas', 'otro_codigo']);
		expect(resultado.error).toBeUndefined();
	});

	test('array vacío de recargos retorna vacío sin error', () => {
		const tiposPorCodigo = new Map<string, string>();

		const resultado = filtrarRecargosServidor('pago', [], tiposPorCodigo);

		expect(resultado.validos).toEqual([]);
		expect(resultado.error).toBeUndefined();
	});
});

// ==========================================
// 3. calcularPrecio: paradas en dilgencia bancaria
// ==========================================

describe('calcularPrecio: paradas en dilgencia bancaria', () => {
	test('pago bancario + 1 parada → tarifa plana + $3,000', () => {
		const pedido: PedidoCalculo = {
			tipo_diligencia: 'diligencia_bancaria',
			subtipo_pago: 'bancario',
			tramo_principal: crearTramoPrincipal('centro', 'centro', 'diligencia_bancaria'),
			tramos_adicionales: [],
			recargos: [{ id: 'paradas', paradas: 1 }]
		};

		const resultado = calcularPrecio(pedido);
		// 12000 (pago bancario) + 3000 (1 parada × $3,000)
		expect(resultado.total).toBe(15000);
		expect(resultado.recargos_desglose).toHaveLength(1);
		expect(resultado.recargos_desglose[0]).toEqual({ id: 'paradas', valor: 3000 });
		expect(resultado.recargo_total).toBe(3000);
	});

	test('pago bancario + 3 paradas → tarifa plana + $9,000', () => {
		const pedido: PedidoCalculo = {
			tipo_diligencia: 'diligencia_bancaria',
			subtipo_pago: 'bancario',
			tramo_principal: crearTramoPrincipal('centro', 'centro', 'diligencia_bancaria'),
			tramos_adicionales: [],
			recargos: [{ id: 'paradas', paradas: 3 }]
		};

		const resultado = calcularPrecio(pedido);
		// 12000 (pago bancario) + 9000 (3 paradas × $3,000)
		expect(resultado.total).toBe(21000);
		expect(resultado.recargos_desglose[0]).toEqual({ id: 'paradas', valor: 9000 });
	});

	test('corresponsal + 2 paradas → tarifa plana + $6,000', () => {
		const pedido: PedidoCalculo = {
			tipo_diligencia: 'diligencia_bancaria',
			subtipo_pago: 'corresponsal',
			tramo_principal: crearTramoPrincipal('sur_27_50', 'centro', 'diligencia_bancaria'),
			tramos_adicionales: [],
			recargos: [{ id: 'paradas', paradas: 2 }]
		};

		const resultado = calcularPrecio(pedido);
		// 8000 (corresponsal) + 6000 (2 paradas × $3,000)
		expect(resultado.total).toBe(14000);
		expect(resultado.recargos_desglose[0]).toEqual({ id: 'paradas', valor: 6000 });
	});

	test('paradas = 0 no genera recargo', () => {
		const pedido: PedidoCalculo = {
			tipo_diligencia: 'diligencia_bancaria',
			subtipo_pago: 'corresponsal',
			tramo_principal: crearTramoPrincipal('centro', 'centro', 'diligencia_bancaria'),
			tramos_adicionales: [],
			recargos: [{ id: 'paradas', paradas: 0 }]
		};

		const resultado = calcularPrecio(pedido);
		expect(resultado.total).toBe(8000); // Solo tarifa plana
		expect(resultado.recargos_desglose).toHaveLength(0);
		expect(resultado.recargo_total).toBe(0);
	});

	test('paradas sin campo paradas usa 0 por defecto', () => {
		const pedido: PedidoCalculo = {
			tipo_diligencia: 'diligencia_bancaria',
			subtipo_pago: 'corresponsal',
			tramo_principal: crearTramoPrincipal('centro', 'centro', 'diligencia_bancaria'),
			tramos_adicionales: [],
			recargos: [{ id: 'paradas' }] // Sin campo paradas
		};

		const resultado = calcularPrecio(pedido);
		expect(resultado.total).toBe(8000); // Solo tarifa plana
		expect(resultado.recargos_desglose).toHaveLength(0);
	});

	test('pago bancario + paradas + transferencia → suma ambos recargos', () => {
		const pedido: PedidoCalculo = {
			tipo_diligencia: 'diligencia_bancaria',
			subtipo_pago: 'bancario',
			tramo_principal: crearTramoPrincipal('centro', 'centro', 'diligencia_bancaria'),
			tramos_adicionales: [],
			recargos: [
				{ id: 'paradas', paradas: 2 },
				{ id: 'transferencia' }
			],
			monto_pago: 150000
		};

		const resultado = calcularPrecio(pedido);
		// 12000 (pago bancario) + 6000 (2 paradas × $3,000) + 2000 (transferencia >$100k)
		expect(resultado.total).toBe(20000);
		expect(resultado.recargos_desglose).toHaveLength(2);

		const paradasRecargo = resultado.recargos_desglose.find((r) => r.id === 'paradas');
		expect(paradasRecargo?.valor).toBe(6000);

		const transferRecargo = resultado.recargos_desglose.find((r) => r.id === 'transferencia');
		expect(transferRecargo?.valor).toBe(2000);
	});

	test('pago bancario + paradas + recogida extra → tarifa plana + tramo adicional + paradas', () => {
		const pedido: PedidoCalculo = {
			tipo_diligencia: 'diligencia_bancaria',
			subtipo_pago: 'bancario',
			tramo_principal: crearTramoPrincipal('centro', 'centro', 'diligencia_bancaria'),
			tramos_adicionales: [
				{ origen: 'sur_27_50', destino: 'centro', proposito: 'recogida_extra' }
			],
			recargos: [{ id: 'paradas', paradas: 1 }]
		};

		const resultado = calcularPrecio(pedido);
		// 12000 (pago bancario) + 6000 (sur→centro) + 3000 (1 parada)
		expect(resultado.total).toBe(21000);
		expect(resultado.tramos_adicionales).toHaveLength(1);
		expect(resultado.recargos_desglose).toHaveLength(1);
	});

	test('5 paradas genera el recargo correcto ($15,000)', () => {
		const pedido: PedidoCalculo = {
			tipo_diligencia: 'diligencia_bancaria',
			subtipo_pago: 'corresponsal',
			tramo_principal: crearTramoPrincipal('centro', 'centro', 'diligencia_bancaria'),
			tramos_adicionales: [],
			recargos: [{ id: 'paradas', paradas: 5 }]
		};

		const resultado = calcularPrecio(pedido);
		// 8000 (corresponsal) + 15000 (5 paradas × $3,000)
		expect(resultado.total).toBe(23000);
		expect(resultado.recargos_desglose[0]).toEqual({ id: 'paradas', valor: 15000 });
	});
});

// ==========================================
// 4. Valor de paradas coincide con tabla de precios
// ==========================================

describe('Valor de paradas consistente con TABLA_RECARGOS', () => {
	test('costo por parada usa por_parada de la tabla', () => {
		expect(TABLA_RECARGOS.compras.por_parada).toBe(3000);
	});

	test('1 parada cuesta exactamente por_parada', () => {
		const pedido: PedidoCalculo = {
			tipo_diligencia: 'diligencia_bancaria',
			subtipo_pago: 'corresponsal',
			tramo_principal: crearTramoPrincipal('centro', 'centro', 'diligencia_bancaria'),
			tramos_adicionales: [],
			recargos: [{ id: 'paradas', paradas: 1 }]
		};

		const resultado = calcularPrecio(pedido);
		expect(resultado.recargos_desglose[0].valor).toBe(TABLA_RECARGOS.compras.por_parada);
	});

	test('N paradas cuesta N × por_parada', () => {
		for (const n of [1, 2, 3, 5, 10]) {
			const pedido: PedidoCalculo = {
				tipo_diligencia: 'diligencia_bancaria',
				subtipo_pago: 'corresponsal',
				tramo_principal: crearTramoPrincipal('centro', 'centro', 'diligencia_bancaria'),
				tramos_adicionales: [],
				recargos: [{ id: 'paradas', paradas: n }]
			};

			const resultado = calcularPrecio(pedido);
			expect(resultado.recargos_desglose[0].valor).toBe(TABLA_RECARGOS.compras.por_parada * n);
		}
	});
});

// ==========================================
// 5. Total acumulativo: tarifa base + paradas + otros recargos
// ==========================================

describe('Total acumulativo con paradas', () => {
	test('corresponsal ($8,000) + 3 paradas ($9,000) = $17,000', () => {
		const pedido: PedidoCalculo = {
			tipo_diligencia: 'diligencia_bancaria',
			subtipo_pago: 'corresponsal',
			tramo_principal: crearTramoPrincipal('centro', 'centro', 'diligencia_bancaria'),
			tramos_adicionales: [],
			recargos: [{ id: 'paradas', paradas: 3 }]
		};

		const resultado = calcularPrecio(pedido);
		expect(resultado.total).toBe(17000);
	});

	test('bancario ($12,000) + 1 parada ($3,000) + transferencia $6,000 = $21,000', () => {
		const pedido: PedidoCalculo = {
			tipo_diligencia: 'diligencia_bancaria',
			subtipo_pago: 'bancario',
			tramo_principal: crearTramoPrincipal('centro', 'centro', 'diligencia_bancaria'),
			tramos_adicionales: [],
			recargos: [
				{ id: 'paradas', paradas: 1 },
				{ id: 'transferencia' }
			],
			monto_pago: 1500000
		};

		const resultado = calcularPrecio(pedido);
		// 12000 + 3000 + 6000 = 21000
		expect(resultado.total).toBe(21000);
		expect(resultado.recargo_total).toBe(9000);
	});

	test('corresponsal ($8,000) + 2 paradas ($6,000) + tiempo espera = $14,000+', () => {
		const pedido: PedidoCalculo = {
			tipo_diligencia: 'diligencia_bancaria',
			subtipo_pago: 'corresponsal',
			tramo_principal: crearTramoPrincipal('centro', 'centro', 'diligencia_bancaria'),
			tramos_adicionales: [],
			recargos: [
				{ id: 'paradas', paradas: 2 },
				{ id: 'tiempo_espera' }
			]
		};

		const resultado = calcularPrecio(pedido);
		// 8000 + 6000 + 0 (tiempo_espera no tiene valor en tabla) = 14000
		expect(resultado.total).toBe(14000);
		expect(resultado.recargos_desglose).toHaveLength(1); // Solo paradas (tiempo_espera = 0)
	});
});

// ==========================================
// 6. PedidoCalculo type: recargoSeleccionado con paradas
// ==========================================

describe('RecargoSeleccionado: campo paradas', () => {
	test('recargo con paradas definido correctamente', () => {
		const recargo: RecargoSeleccionado = { id: 'paradas', paradas: 3 };
		expect(recargo.id).toBe('paradas');
		expect(recargo.paradas).toBe(3);
	});

	test('recargo sin paradas (undefined)', () => {
		const recargo: RecargoSeleccionado = { id: 'transferencia' };
		expect(recargo.paradas).toBeUndefined();
	});
});
