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
	recargosConfirmadosNoAplica: true,
	// Teléfono del cliente (Fase 19): obligatorio.
	telefono: '3001234567',
	// Peso y transferencia obligatorios en domicilio.
	peso: '2',
	transferencia: 'no'
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
		// En domicilio los recargos son opcionales; sin 'No aplica' no se exige nada.
	const e = validarPedido({ ...pedidoValido, recargos: undefined, recargosConfirmadosNoAplica: false });
		expect(e.recargos).toBeUndefined();

		const e2 = validarPedido({ ...pedidoValido, recargos: [], recargosConfirmadosNoAplica: false });
		expect(e2.recargos).toBeUndefined();
	});

	test('peso y transferencia son obligatorios en domicilio', () => {
		expect(validarPedido({ ...pedidoValido, peso: '', transferencia: '' }).peso).toBe('El peso del paquete es obligatorio.');
		expect(validarPedido({ ...pedidoValido, peso: '', transferencia: '' }).transferencia).toBe('Indica si hay transferencia bancaria.');
	});

	test('transferencia "si" exige monto', () => {
		expect(validarPedido({ ...pedidoValido, transferencia: 'si', transferenciaMonto: '' }).transferenciaMonto).toBe('Indica el monto de la transferencia.');
	});

	test('el teléfono es obligatorio para coordinar la entrega (Fase 19)', () => {
		const e = validarPedido({ ...pedidoValido, telefono: '' });
		expect(e.telefono).toBe('El teléfono es obligatorio para coordinar la entrega.');

		const e2 = validarPedido({ ...pedidoValido, telefono: '   ' });
		expect(e2.telefono).toBe('El teléfono es obligatorio para coordinar la entrega.');
	});

	test('un teléfono que no es móvil colombiano se rechaza (Fase 19)', () => {
		const e = validarPedido({ ...pedidoValido, telefono: '4001234567' });
		expect(e.telefono).toBe('Ingresa un número de celular colombiano válido (10 dígitos).');

		const e2 = validarPedido({ ...pedidoValido, telefono: '300123456' }); // 9 dígitos
		expect(e2.telefono).toBe('Ingresa un número de celular colombiano válido (10 dígitos).');
	});

	test('el teléfono acepta formato con espacios/guiones y prefijo +57 (Fase 19)', () => {
		expect(validarPedido({ ...pedidoValido, telefono: '+57 300 123 4567', peso: '1', transferencia: 'no' })).toEqual({});
	});

	test(`el nombre del cliente opcional se rechaza si pasa de ${LIMITES.nombreCliente} caracteres`, () => {
		const e = validarPedido({ ...pedidoValido, nombreCliente: 'x'.repeat(LIMITES.nombreCliente + 1) });
		expect(e.nombreCliente).toBe(`Máximo ${LIMITES.nombreCliente} caracteres.`);

		expect(validarPedido({ ...pedidoValido, nombreCliente: '', peso: '1', transferencia: 'no' })).toEqual({});
	});
});

describe('validarPedido — compra/diligencia (Fase 14)', () => {
	test('compra/diligencia sin origen y sin dirección de origen es válido (solo destino)', () => {
		const e = validarPedido({
			...pedidoValido,
			tipoServicio: 'compra_diligencia',
			tipoDiligencia: 'pago',
			dilDescripcion: 'Factura de luz',
			dilValorFactura: '85000',
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
			tipoDiligencia: 'compra',
			dilProductos: '2 paquetes de arroz',
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
			tipoDiligencia: 'pago',
			dilDescripcion: 'Recibo',
			dilValorFactura: '50000',
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

	test('compra/diligencia sin tipo de diligencia genera error', () => {
		const e = validarPedido({
			...pedidoValido,
			tipoServicio: 'compra_diligencia',
			barrioOrigen: null,
			direccionOrigen: '',
			recargosConfirmadosNoAplica: true
		});
		expect(e.tipoDiligencia).toBe('Selecciona el tipo de diligencia.');
	});

	test('pago: exige descripción y valor factura', () => {
		const e = validarPedido({
			...pedidoValido,
			tipoServicio: 'compra_diligencia',
			tipoDiligencia: 'pago',
			barrioOrigen: null,
			direccionOrigen: '',
			recargosConfirmadosNoAplica: true
		});
		expect(e.dilDescripcion).toBe('La descripción del pago es obligatoria.');
		expect(e.dilValorFactura).toBe('El valor de la factura es obligatorio.');
	});

	test('banco: exige entidad, descripción y valor', () => {
		const e = validarPedido({
			...pedidoValido,
			tipoServicio: 'compra_diligencia',
			tipoDiligencia: 'banco',
			barrioOrigen: null,
			direccionOrigen: '',
			recargosConfirmadosNoAplica: true
		});
		expect(e.dilEntidad).toBe('La entidad o banco es obligatorio.');
		expect(e.dilDescripcion).toBe('La descripción del pago es obligatoria.');
		expect(e.dilValorFactura).toBe('El valor a pagar es obligatorio.');
	});

	test('compra: exige productos', () => {
		const e = validarPedido({
			...pedidoValido,
			tipoServicio: 'compra_diligencia',
			tipoDiligencia: 'compra',
			barrioOrigen: null,
			direccionOrigen: '',
			recargosConfirmadosNoAplica: true
		});
		expect(e.dilProductos).toBe('Describe los productos que necesitas.');
		// No debe exigir campos de otros tipos.
		expect(e.dilDescripcion).toBeUndefined();
		expect(e.dilValorFactura).toBeUndefined();
	});

	test('tramite: exige trámite e instrucciones', () => {
		const e = validarPedido({
			...pedidoValido,
			tipoServicio: 'compra_diligencia',
			tipoDiligencia: 'tramite',
			barrioOrigen: null,
			direccionOrigen: '',
			recargosConfirmadosNoAplica: true
		});
		expect(e.dilTramite).toBe('Indica qué trámite necesitas.');
		expect(e.dilInstrucciones).toBe('Las instrucciones son obligatorias.');
	});

	test('otro: exige descripción', () => {
		const e = validarPedido({
			...pedidoValido,
			tipoServicio: 'compra_diligencia',
			tipoDiligencia: 'otro',
			barrioOrigen: null,
			direccionOrigen: '',
			recargosConfirmadosNoAplica: true
		});
		expect(e.dilOtraDescripcion).toBe('Describe la diligencia.');
	});

	test('valor factura negativo se rechaza (pago)', () => {
		const e = validarPedido({
			...pedidoValido,
			tipoServicio: 'compra_diligencia',
			tipoDiligencia: 'pago',
			dilDescripcion: 'Factura de luz',
			dilValorFactura: '-5000',
			barrioOrigen: null,
			direccionOrigen: '',
			recargosConfirmadosNoAplica: true
		});
		expect(e.dilValorFactura).toBe('El valor no puede ser negativo.');
	});

	test('valor factura negativo se rechaza (banco)', () => {
		const e = validarPedido({
			...pedidoValido,
			tipoServicio: 'compra_diligencia',
			tipoDiligencia: 'banco',
			dilEntidad: 'Bancolombia',
			dilDescripcion: 'Consignación',
			dilValorFactura: '-10000',
			barrioOrigen: null,
			direccionOrigen: '',
			recargosConfirmadosNoAplica: true
		});
		expect(e.dilValorFactura).toBe('El valor no puede ser negativo.');
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
