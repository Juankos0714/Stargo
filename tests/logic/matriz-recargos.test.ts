import { describe, expect, test } from 'vitest';
import { MATRIZ_RECARGOS, filtrarRecargosServidor } from '$lib/logic/matriz-recargos';

describe('MATRIZ_RECARGOS', () => {
	test('cada tipo de diligencia tiene visibles, ocultos y obligatorios definidos', () => {
		for (const [tipo, regla] of Object.entries(MATRIZ_RECARGOS)) {
			expect(regla.visibles, `${tipo}.visibles`).toBeInstanceOf(Array);
			expect(regla.ocultos, `${tipo}.ocultos`).toBeInstanceOf(Array);
			expect(regla.obligatorios, `${tipo}.obligatorios`).toBeInstanceOf(Array);
		}
	});

	test('compra calcula su recargo por paradas y no selecciona un recargo fijo', () => {
		expect(MATRIZ_RECARGOS.compra.obligatorios).not.toContain('compra');
		expect(MATRIZ_RECARGOS.compra.visibles).not.toContain('compra');
		expect(MATRIZ_RECARGOS.compra.ocultos).toContain('compra');
	});

	test('pago y banco ocultan el recargo pago (redundante)', () => {
		expect(MATRIZ_RECARGOS.pago.ocultos).toContain('pago');
		expect(MATRIZ_RECARGOS.banco.ocultos).toContain('pago');
	});

	test('pago y banco ocultan peso y compra', () => {
		for (const tipo of ['pago', 'banco']) {
			expect(MATRIZ_RECARGOS[tipo].ocultos).toContain('peso');
			expect(MATRIZ_RECARGOS[tipo].ocultos).toContain('compra');
		}
	});

	test('tramite ocultan compra, peso y pago', () => {
		expect(MATRIZ_RECARGOS.tramite.ocultos).toContain('compra');
		expect(MATRIZ_RECARGOS.tramite.ocultos).toContain('peso');
		expect(MATRIZ_RECARGOS.tramite.ocultos).toContain('pago');
	});
});

describe('filtrarRecargosServidor', () => {
	const tiposPorCodigo = new Map([
		['rc-compra', 'compra'],
		['rc-peso', 'peso'],
		['rc-pago', 'pago'],
		['rc-tiempo', 'tiempo_espera'],
		['rc-paradas', 'paradas'],
		['rc-otro', 'otro']
	]);

	test('sin tipo de diligencia devuelve todos los recargos', () => {
		const resultado = filtrarRecargosServidor(null, ['rc-compra', 'rc-peso'], tiposPorCodigo);
		expect(resultado.validos).toEqual(['rc-compra', 'rc-peso']);
		expect(resultado.error).toBeUndefined();
	});

	test('para tipo pago, rechaza recargo pago y peso', () => {
		const resultado = filtrarRecargosServidor('pago', ['rc-pago', 'rc-peso', 'rc-tiempo'], tiposPorCodigo);
		expect(resultado.validos).toEqual(['rc-tiempo']);
		expect(resultado.error).toContain('rc-pago');
		expect(resultado.error).toContain('rc-peso');
	});

	test('para tipo compra rechaza el recargo fijo de compra y acepta los demás', () => {
		const resultado = filtrarRecargosServidor(
			'compra',
			['rc-compra', 'rc-peso', 'rc-pago', 'rc-tiempo'],
			tiposPorCodigo
		);
		expect(resultado.validos).toEqual(['rc-peso', 'rc-pago', 'rc-tiempo']);
		expect(resultado.error).toContain('rc-compra');
	});

	test('para tipo tramite, rechaza compra, peso y pago', () => {
		const resultado = filtrarRecargosServidor(
			'tramite',
			['rc-compra', 'rc-peso', 'rc-pago', 'rc-tiempo', 'rc-paradas'],
			tiposPorCodigo
		);
		expect(resultado.validos).toEqual(['rc-tiempo', 'rc-paradas']);
		expect(resultado.error).toContain('rc-compra');
	});

	test('para tipo desconocido, rechaza todos', () => {
		const resultado = filtrarRecargosServidor('invalido', ['rc-tiempo'], tiposPorCodigo);
		expect(resultado.validos).toEqual([]);
		expect(resultado.error).toContain('no válido');
	});

	test('recargos vacíos siempre son válidos', () => {
		const resultado = filtrarRecargosServidor('pago', [], tiposPorCodigo);
		expect(resultado.validos).toEqual([]);
		expect(resultado.error).toBeUndefined();
	});
});
