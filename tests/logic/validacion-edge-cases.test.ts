import { describe, expect, test } from 'vitest';
import { validarPedido, validarTelefono, validarMotivoCancelacion, LIMITES } from '../../src/lib/logic/validacion';

/**
 * Tests de casos borde para la validación de pedidos.
 * Cubre: teléfono colombiano (Fase 19), recargos obligatorios (Fase 14),
 * compra/diligencia sin origen, y límites de longitud.
 */

describe('validarTelefono — casos borde', () => {
	test('acepta celular colombiano válido (empieza por 3, 10 dígitos)', () => {
		expect(validarTelefono('3001234567')).toBe(true);
		expect(validarTelefono('3101234567')).toBe(true);
		expect(validarTelefono('3201234567')).toBe(true);
	});

	test('acepta con formato: espacios, guiones, paréntesis', () => {
		expect(validarTelefono('300 123 4567')).toBe(true);
		expect(validarTelefono('300-123-4567')).toBe(true);
		expect(validarTelefono('(300) 123-4567')).toBe(true);
	});

	test('acepta con prefijo +57 / 57', () => {
		expect(validarTelefono('+57 300 123 4567')).toBe(true);
		expect(validarTelefono('573001234567')).toBe(true);
	});

	test('rechaza números que no empiezan por 3 (fijo, incorrecto)', () => {
		expect(validarTelefono('6001234567')).toBe(false); // fijo
		expect(validarTelefono('4001234567')).toBe(false);
	});

	test('rechaza números muy cortos o muy largos', () => {
		expect(validarTelefono('300123456')).toBe(false); // 9 dígitos
		expect(validarTelefono('30012345678')).toBe(false); // 11 dígitos
		expect(validarTelefono('')).toBe(false);
		expect(validarTelefono(null as unknown as string)).toBe(false);
		expect(validarTelefono(undefined as unknown as string)).toBe(false);
	});

	test('rechaza letras y caracteres no numéricos', () => {
		expect(validarTelefono('abcdefghij')).toBe(false);
		expect(validarTelefono('300-ABC-DEF')).toBe(false);
	});
});

describe('validarPedido — compra/diligencia sin origen', () => {
	test('compra_diligencia solo con destino es válido (origen opcional)', () => {
		const errores = validarPedido({
			barrioOrigen: null,
			barrioDestino: 'barrio-destino',
			direccionOrigen: '',
			direccionDestino: 'Carrera 19 # 20-30',
			observaciones: '',
			recargos: [],
			tipoServicio: 'compra_diligencia',
			recargosConfirmadosNoAplica: true,
			telefono: '3001234567'
		});
		expect(errores.origen).toBeUndefined();
		expect(errores.destino).toBeUndefined();
	});

	test('si hay recogida, exige barrio y dirección de recogida', () => {
		const errores = validarPedido({
			barrioOrigen: null,
			barrioDestino: 'barrio-destino',
			direccionOrigen: '',
			direccionDestino: 'Carrera 19 # 20-30',
			observaciones: '',
			recargos: [],
			tipoServicio: 'compra_diligencia',
			necesitaRecoger: true,
			recargosConfirmadosNoAplica: true,
			telefono: '3001234567'
		});
		expect(errores.origen).toBe('Selecciona el barrio de origen.');
		expect(errores.dirOrigen).toBe('La dirección de origen es obligatoria.');
	});

	test('domicilio sin origen es un error', () => {
		const errores = validarPedido({
			barrioOrigen: null,
			barrioDestino: 'barrio-destino',
			direccionOrigen: '',
			direccionDestino: 'Carrera 19 # 20-30',
			observaciones: '',
			recargos: [],
			tipoServicio: 'domicilio',
			recargosConfirmadosNoAplica: true,
			telefono: '3001234567'
		});
		expect(errores.origen).toBeTruthy();
	});
});

describe('validarPedido — recargos opcionales (Fase 14+)', () => {
	test('sin recargos y sin marcar "No aplica" → sin error (recargos son opcionales)', () => {
		const errores = validarPedido({
			barrioOrigen: 'barrio-a',
			barrioDestino: 'barrio-b',
			direccionOrigen: 'Calle 10',
			direccionDestino: 'Carrera 19',
			observaciones: '',
			recargos: [],
			tipoServicio: 'compra_diligencia',
			tipoDiligencia: 'otro',
			dilOtraDescripcion: 'Ir a la farmacia',
			recargosConfirmadosNoAplica: false,
			telefono: '3001234567'
		});
		expect(errores.recargos).toBeUndefined();
	});

	test('marcar "No aplica" satisface la validación', () => {
		const errores = validarPedido({
			barrioOrigen: 'barrio-a',
			barrioDestino: 'barrio-b',
			direccionOrigen: 'Calle 10',
			direccionDestino: 'Carrera 19',
			observaciones: '',
			recargos: [],
			tipoServicio: 'domicilio',
			recargosConfirmadosNoAplica: true,
			telefono: '3001234567'
		});
		expect(errores.recargos).toBeUndefined();
	});

	test('elegir al menos un recargo satisface la validación', () => {
		const errores = validarPedido({
			barrioOrigen: 'barrio-a',
			barrioDestino: 'barrio-b',
			direccionOrigen: 'Calle 10',
			direccionDestino: 'Carrera 19',
			observaciones: '',
			recargos: ['rc_peso'],
			tipoServicio: 'domicilio',
			recargosConfirmadosNoAplica: false,
			telefono: '3001234567'
		});
		expect(errores.recargos).toBeUndefined();
	});

	test('más de 15 recargos → error', () => {
		const errores = validarPedido({
			barrioOrigen: 'barrio-a',
			barrioDestino: 'barrio-b',
			direccionOrigen: 'Calle 10',
			direccionDestino: 'Carrera 19',
			observaciones: '',
			recargos: Array.from({ length: 16 }, (_, i) => `rc_${i}`),
			tipoServicio: 'domicilio',
			recargosConfirmadosNoAplica: false,
			telefono: '3001234567'
		});
		expect(errores.recargos).toBeTruthy();
		expect(errores.recargos).toMatch(/máximo/);
	});
});

describe('validarPedido — teléfono obligatorio (Fase 19)', () => {
	test('sin teléfono → error', () => {
		const errores = validarPedido({
			barrioOrigen: 'barrio-a',
			barrioDestino: 'barrio-b',
			direccionOrigen: 'Calle 10',
			direccionDestino: 'Carrera 19',
			observaciones: '',
			recargos: [],
			tipoServicio: 'domicilio',
			recargosConfirmadosNoAplica: true,
			telefono: ''
		});
		expect(errores.telefono).toBeTruthy();
		expect(errores.telefono).toMatch(/obligatorio/);
	});

	test('teléfono inválido → error', () => {
		const errores = validarPedido({
			barrioOrigen: 'barrio-a',
			barrioDestino: 'barrio-b',
			direccionOrigen: 'Calle 10',
			direccionDestino: 'Carrera 19',
			observaciones: '',
			recargos: [],
			tipoServicio: 'domicilio',
			recargosConfirmadosNoAplica: true,
			telefono: '123'
		});
		expect(errores.telefono).toBeTruthy();
		expect(errores.telefono).toMatch(/válido/);
	});
});

describe('validarPedido — límites de longitud', () => {
	test('dirección destino excede 300 caracteres', () => {
		const errores = validarPedido({
			barrioOrigen: 'barrio-a',
			barrioDestino: 'barrio-b',
			direccionOrigen: 'Calle 10',
			direccionDestino: 'x'.repeat(301),
			observaciones: '',
			recargos: [],
			tipoServicio: 'domicilio',
			recargosConfirmadosNoAplica: true,
			telefono: '3001234567'
		});
		expect(errores.dirDestino).toMatch(/Máximo/);
	});

	test('observaciones exceden 1000 caracteres', () => {
		const errores = validarPedido({
			barrioOrigen: 'barrio-a',
			barrioDestino: 'barrio-b',
			direccionOrigen: 'Calle 10',
			direccionDestino: 'Carrera 19',
			observaciones: 'x'.repeat(1001),
			recargos: [],
			tipoServicio: 'domicilio',
			recargosConfirmadosNoAplica: true,
			telefono: '3001234567'
		});
		expect(errores.observaciones).toMatch(/Máximo/);
	});

	test('nombre cliente excede 120 caracteres', () => {
		const errores = validarPedido({
			barrioOrigen: 'barrio-a',
			barrioDestino: 'barrio-b',
			direccionOrigen: 'Calle 10',
			direccionDestino: 'Carrera 19',
			observaciones: '',
			recargos: [],
			tipoServicio: 'domicilio',
			recargosConfirmadosNoAplica: true,
			telefono: '3001234567',
			nombreCliente: 'x'.repeat(121)
		});
		expect(errores.nombreCliente).toMatch(/Máximo/);
	});
});

describe('validarMotivoCancelacion', () => {
	test('motivo vacío → error', () => {
		expect(validarMotivoCancelacion('')).toBeTruthy();
		expect(validarMotivoCancelacion('   ')).toBeTruthy();
	});

	test('motivo válido → null', () => {
		expect(validarMotivoCancelacion('Cliente no pagó')).toBeNull();
	});

	test('motivo excede 300 caracteres → error', () => {
		expect(validarMotivoCancelacion('x'.repeat(301))).toBeTruthy();
	});
});

describe('constantess LIMITES', () => {
	test('los límites son coherentes con la BD y la UI', () => {
		expect(LIMITES.direccion).toBe(300);
		expect(LIMITES.observaciones).toBe(1000);
		expect(LIMITES.recargos).toBe(15);
		expect(LIMITES.motivoCancelacion).toBe(300);
		expect(LIMITES.nombreCliente).toBe(120);
	});
});

/**
 * Verificación del rendering de HTML (strong tag).
 * El bug reportado era que <strong> se renderizaba como texto literal.
 * Este test verifica que la lógica de formateo NO produce HTML crudo —
 * el rendering real es responsabilidad del componente Svelte, pero la
 * lógica de negocio no debe inyectar tags HTML en los strings.
 */
describe('validarPedido — compra/diligencia con peso y transferencia obligatorios', () => {
	test('compra_diligencia sin peso → error', () => {
		const errores = validarPedido({
			barrioOrigen: null,
			barrioDestino: 'barrio-destino',
			direccionOrigen: '',
			direccionDestino: 'Carrera 19 # 20-30',
			observaciones: '',
			recargos: [],
			tipoServicio: 'compra_diligencia',
			tipoDiligencia: 'compra',
			dilProductos: 'Arroz, leche',
			telefono: '3001234567',
			peso: '',
			transferencia: 'no'
		});
		expect(errores.peso).toBeTruthy();
		expect(errores.peso).toMatch(/obligatorio/);
	});

	test('compra_diligencia sin transferencia → error', () => {
		const errores = validarPedido({
			barrioOrigen: null,
			barrioDestino: 'barrio-destino',
			direccionOrigen: '',
			direccionDestino: 'Carrera 19 # 20-30',
			observaciones: '',
			recargos: [],
			tipoServicio: 'compra_diligencia',
			tipoDiligencia: 'compra',
			dilProductos: 'Arroz, leche',
			telefono: '3001234567',
			peso: '5',
			transferencia: ''
		});
		expect(errores.transferencia).toBeTruthy();
		expect(errores.transferencia).toMatch(/transferencia/);
	});

	test('compra_diligencia con transferencia=sí sin monto → error', () => {
		const errores = validarPedido({
			barrioOrigen: null,
			barrioDestino: 'barrio-destino',
			direccionOrigen: '',
			direccionDestino: 'Carrera 19 # 20-30',
			observaciones: '',
			recargos: [],
			tipoServicio: 'compra_diligencia',
			tipoDiligencia: 'compra',
			dilProductos: 'Arroz, leche',
			telefono: '3001234567',
			peso: '5',
			transferencia: 'si',
			transferenciaMonto: ''
		});
		expect(errores.transferenciaMonto).toBeTruthy();
		expect(errores.transferenciaMonto).toMatch(/monto/);
	});

	test('compra_diligencia con todos los campos obligatorios → sin error de peso/transferencia', () => {
		const errores = validarPedido({
			barrioOrigen: null,
			barrioDestino: 'barrio-destino',
			direccionOrigen: '',
			direccionDestino: 'Carrera 19 # 20-30',
			observaciones: '',
			recargos: [],
			tipoServicio: 'compra_diligencia',
			tipoDiligencia: 'compra',
			dilProductos: 'Arroz, leche',
			telefono: '3001234567',
			peso: '10',
			transferencia: 'no'
		});
		expect(errores.peso).toBeUndefined();
		expect(errores.transferencia).toBeUndefined();
	});

	test('domicilio sin peso → error (regla existente)', () => {
		const errores = validarPedido({
			barrioOrigen: 'barrio-a',
			barrioDestino: 'barrio-b',
			direccionOrigen: 'Calle 10',
			direccionDestino: 'Carrera 19',
			observaciones: '',
			recargos: [],
			tipoServicio: 'domicilio',
			telefono: '3001234567',
			peso: '',
			transferencia: 'no'
		});
		expect(errores.peso).toBeTruthy();
	});

	test('domicilio con peso negativo → error', () => {
		const errores = validarPedido({
			barrioOrigen: 'barrio-a',
			barrioDestino: 'barrio-b',
			direccionOrigen: 'Calle 10',
			direccionDestino: 'Carrera 19',
			observaciones: '',
			recargos: [],
			tipoServicio: 'domicilio',
			telefono: '3001234567',
			peso: '-5',
			transferencia: 'no'
		});
		expect(errores.peso).toMatch(/negativo/);
	});

	test('domicilio con transferencia monto negativo → error', () => {
		const errores = validarPedido({
			barrioOrigen: 'barrio-a',
			barrioDestino: 'barrio-b',
			direccionOrigen: 'Calle 10',
			direccionDestino: 'Carrera 19',
			observaciones: '',
			recargos: [],
			tipoServicio: 'domicilio',
			telefono: '3001234567',
			peso: '10',
			transferencia: 'si',
			transferenciaMonto: '-100'
		});
		expect(errores.transferenciaMonto).toMatch(/negativo/);
	});
});

describe('strong tag no se inyecta en strings de lógica', () => {
	test('los mensajes de validación no contienen tags HTML', () => {
		const errores = validarPedido({
			barrioOrigen: null,
			barrioDestino: null,
			direccionOrigen: '',
			direccionDestino: '',
			observaciones: '',
			recargos: [],
			tipoServicio: 'domicilio',
			telefono: ''
		});
		for (const msg of Object.values(errores)) {
			expect(msg).not.toMatch(/<[^>]+>/);
		}
	});

	test('el motivo de cancelación no contiene tags HTML', () => {
		const err = validarMotivoCancelacion('');
		expect(err).not.toMatch(/<[^>]+>/);
	});
});
