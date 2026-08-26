import { describe, expect, test } from 'vitest';
import { sincronizarRecargosDomicilio, type RecargoSeleccionable } from '$lib/logic/recargos';

// El catálogo antiguo de producción usa códigos correctos, pero no siempre
// tiene los tipos peso/transferencia normalizados.
const catalogo: RecargoSeleccionable[] = [
	{ codigo: 'peso_mas_20kg', nombre: 'Entre 16 a 30 kg', valor: 2000, activo: true, tipo: 'otro' },
	{ codigo: 'peso_mas_40kg', nombre: 'Entre 31 a 45 kg', valor: 5000, activo: true, tipo: 'otro' },
	{ codigo: 'peso_mas_60kg', nombre: 'Más de 45 kg', valor: 10000, activo: true, tipo: 'otro' },
	{ codigo: 'transferencia_100k', nombre: 'Más de $100.000', valor: 2000, activo: true, tipo: 'pago' },
	{ codigo: 'transferencia_500k', nombre: 'Más de $500.000', valor: 4000, activo: true, tipo: 'pago' },
	{ codigo: 'transferencia_1m', nombre: 'Más de $1.000.000', valor: 6000, activo: true, tipo: 'pago' },
	{ codigo: 'tiempo_espera', nombre: 'Espera', valor: 1000, activo: true, tipo: 'tiempo_espera' }
];

describe('sincronizarRecargosDomicilio', () => {
	test('carga los recargos de peso y transferencia usando códigos del catálogo histórico', () => {
		const seleccion = sincronizarRecargosDomicilio(catalogo, ['tiempo_espera'], '25', 'si', '150000');

		expect(seleccion).toEqual(expect.arrayContaining(['tiempo_espera', 'peso_mas_20kg', 'transferencia_100k']));
	});

	test('reemplaza el escalón anterior al cambiar peso y monto', () => {
		const seleccion = sincronizarRecargosDomicilio(
			catalogo,
			['peso_mas_20kg', 'transferencia_100k'],
			'50',
			'si',
			'600000'
		);

		expect(seleccion).toEqual(expect.arrayContaining(['peso_mas_40kg', 'transferencia_500k']));
		expect(seleccion).not.toEqual(expect.arrayContaining(['peso_mas_20kg', 'transferencia_100k']));
	});
});
