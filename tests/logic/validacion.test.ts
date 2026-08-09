import { describe, expect, test } from 'vitest';
import {
	LIMITES,
	validarMotivoCancelacion,
	validarPedido,
	validarTelefono,
	type DatosPedido
} from '../../src/lib/logic/validacion';

const pedidoValido: DatosPedido = {
	barrioOrigen: 'b-origen',
	barrioDestino: 'b-destino',
	direccionOrigen: 'Calle 10 # 15-20',
	direccionDestino: 'Carrera 19 # 20-30',
	observaciones: '',
	// Decisión explícita de recargos: se marca «No aplica» (Fase 14).
	recargosConfirmadosNoAplica: true
};

describe('validarPedido (formulario de pedido)', () => {
	test('un pedido completo y válido no genera errores', () => {
		expect(validarPedido(pedidoValido)).toEqual({});
	});

	test('faltan los barrios de origen y/o destino', () => {
		const e = validarPedido({ ...pedidoValido, barrioOrigen: null });
		expect(e.origen).toBe('Selecciona el barrio de origen.');

		const e2 = validarPedido({ ...pedidoValido, barrioDestino: null });
		expect(e2.destino).toBe('Selecciona el barrio de destino.');

		const e3 = validarPedido({ ...pedidoValido, barrioOrigen: null, barrioDestino: null });
		expect(e3.origen).toBeDefined();
		expect(e3.destino).toBeDefined();
	});

	test('direcciones obligatorias (espacios en blanco cuentan como vacías)', () => {
		const e = validarPedido({ ...pedidoValido, direccionOrigen: '   ' });
		expect(e.dirOrigen).toBe('La dirección de origen es obligatoria.');

		const e2 = validarPedido({ ...pedidoValido, direccionDestino: '' });
		expect(e2.dirDestino).toBe('La dirección de destino es obligatoria.');
	});

	test(`direcciones con más de ${LIMITES.direccion} caracteres se rechazan`, () => {
		const larga = 'a'.repeat(LIMITES.direccion + 1);
		const e = validarPedido({ ...pedidoValido, direccionOrigen: larga });
		expect(e.dirOrigen).toBe(`Máximo ${LIMITES.direccion} caracteres.`);

		const e2 = validarPedido({ ...pedidoValido, direccionDestino: larga });
		expect(e2.dirDestino).toBe(`Máximo ${LIMITES.direccion} caracteres.`);
	});

	test(`una dirección de exactamente ${LIMITES.direccion} es válida`, () => {
		const justa = 'a'.repeat(LIMITES.direccion);
		expect(validarPedido({ ...pedidoValido, direccionOrigen: justa })).toEqual({});
	});

	test(`observaciones de más de ${LIMITES.observaciones} caracteres se rechazan`, () => {
		const e = validarPedido({ ...pedidoValido, observaciones: 'x'.repeat(LIMITES.observaciones + 1) });
		expect(e.observaciones).toBe(`Máximo ${LIMITES.observaciones} caracteres.`);
	});

	test(`más de ${LIMITES.recargos} recargos seleccionados se rechazan`, () => {
		const recargos = Array.from({ length: LIMITES.recargos + 1 }, (_, i) => `r_${i}`);
		const e = validarPedido({ ...pedidoValido, recargos });
		expect(e.recargos).toBe(`Selecciona máximo ${LIMITES.recargos} recargos.`);
	});

	test('sin recargos y sin «No aplica» el pedido NO se puede enviar (Fase 14)', () => {
		const e = validarPedido({ ...pedidoValido, recargos: undefined, recargosConfirmadosNoAplica: false });
		expect(e.recargos).toBe('Indica si aplican recargos a tu pedido o marca «No aplica».');

		const e2 = validarPedido({ ...pedidoValido, recargos: [], recargosConfirmadosNoAplica: false });
		expect(e2.recargos).toBe('Indica si aplican recargos a tu pedido o marca «No aplica».');
	});

	test('marcar «No aplica» habilita el envío aunque no haya recargos', () => {
		expect(validarPedido({ ...pedidoValido, recargos: [], recargosConfirmadosNoAplica: true })).toEqual({});
	});

	test('elegir recargos habilita el envío aunque no se marque «No aplica»', () => {
		expect(
			validarPedido({ ...pedidoValido, recargos: ['rc-compra'], recargosConfirmadosNoAplica: false })
		).toEqual({});
	});
});

describe('validarPedido — compra/diligencia (Fase 14)', () => {
	test('compra/diligencia sin origen y sin dirección de origen es válido (solo destino)', () => {
		const e = validarPedido({
			...pedidoValido,
			tipoServicio: 'compra_diligencia',
			barrioOrigen: null,
			direccionOrigen: '',
			recargosConfirmadosNoAplica: true
		});
		expect(e).toEqual({});
	});

	test('compra/diligencia con origen también es válido (diligencia con recogida)', () => {
		const e = validarPedido({
			...pedidoValido,
			tipoServicio: 'compra_diligencia',
			barrioOrigen: 'b-origen',
			direccionOrigen: 'Calle 10 # 15-20',
			recargosConfirmadosNoAplica: true
		});
		expect(e).toEqual({});
	});

	test('compra/diligencia sigue exigiendo destino', () => {
		const e = validarPedido({
			...pedidoValido,
			tipoServicio: 'compra_diligencia',
			barrioOrigen: null,
			barrioDestino: null,
			direccionOrigen: '',
			direccionDestino: '',
			recargosConfirmadosNoAplica: true
		});
		expect(e.destino).toBe('Selecciona el barrio de destino.');
		expect(e.dirDestino).toBe('La dirección de destino es obligatoria.');
		// El origen NO genera error en compra/diligencia.
		expect(e.origen).toBeUndefined();
		expect(e.dirOrigen).toBeUndefined();
	});

	test('domicilio normal sigue exigiendo origen y dirección de origen', () => {
		const e = validarPedido({
			...pedidoValido,
			tipoServicio: 'domicilio',
			barrioOrigen: null,
			direccionOrigen: ''
		});
		expect(e.origen).toBe('Selecciona el barrio de origen.');
		expect(e.dirOrigen).toBe('La dirección de origen es obligatoria.');
	});
});

describe('validarMotivoCancelacion', () => {
	test('motivo vacío (o null) es inválido', () => {
		expect(validarMotivoCancelacion('')).toBe('Selecciona un motivo para cancelar.');
		expect(validarMotivoCancelacion('   ')).toBe('Selecciona un motivo para cancelar.');
		expect(validarMotivoCancelacion(null as unknown as string)).toBe('Selecciona un motivo para cancelar.');
	});

	test('motivo válido devuelve null', () => {
		expect(validarMotivoCancelacion('Ya no necesito el servicio')).toBeNull();
	});

	test(`motivo de más de ${LIMITES.motivoCancelacion} caracteres se rechaza`, () => {
		const largo = 'm'.repeat(LIMITES.motivoCancelacion + 1);
		expect(validarMotivoCancelacion(largo)).toBe(
			`El motivo es demasiado largo (máx. ${LIMITES.motivoCancelacion} caracteres).`
		);
	});

	test('con exactamente el límite es válido', () => {
		expect(validarMotivoCancelacion('m'.repeat(LIMITES.motivoCancelacion))).toBeNull();
	});
});

describe('validarTelefono (móvil colombiano)', () => {
	test('acepta móviles de 10 dígitos que empiezan por 3', () => {
		expect(validarTelefono('3001234567')).toBe(true);
		expect(validarTelefono('3219876543')).toBe(true);
	});

	test('ignora el formato: espacios, guiones y prefijo +57', () => {
		expect(validarTelefono('300 123 4567')).toBe(true);
		expect(validarTelefono('300-123-45-67')).toBe(true);
		expect(validarTelefono('+573001234567')).toBe(true);
	});

	test('rechaza números que no son móvil colombiano', () => {
		expect(validarTelefono('4001234567')).toBe(false); // no empieza por 3
		expect(validarTelefono('300123456')).toBe(false); // 9 dígitos
		expect(validarTelefono('30012345678')).toBe(false); // 11 dígitos
		expect(validarTelefono('603001234567')).toBe(false); // 12 dígitos sin prefijo 57
		expect(validarTelefono('')).toBe(false);
		expect(validarTelefono('abcdefghij')).toBe(false);
		expect(validarTelefono(null as unknown as string)).toBe(false);
	});
});
