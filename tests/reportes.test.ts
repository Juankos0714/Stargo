import { describe, expect, test } from 'vitest';
import {
	agruparPorDia,
	agruparPorDomiciliario,
	esFechaValida,
	fechaBogota,
	fechaHoraBogota,
	pedidosACsv,
	validarRango
} from '../src/lib/server/reportes';
import type { Pedido, ReportePedidoFila } from '../src/lib/types';

function pedido(overrides: Partial<Pedido> = {}): Pedido {
	return {
		id: 'id-1',
		numero: 'ABC123',
		tipo_servicio: 'domicilio',
		recargos_confirmados_no_aplica: false,
		barrio_origen_id: 'b1',
		direccion_origen: 'Calle 1',
		barrio_destino_id: 'b2',
		direccion_destino: 'Calle 2',
		observaciones: null,
		telefono: null,
		nombre_cliente: null,
		tarifa_base: 6000,
		recargos: null,
		recargo_total: 0,
		total: 6000,
		motivo_cancelacion: null,
		zona_origen_id: 'z1',
		zona_destino_id: 'z2',
		estado: 'entregado',
		domiciliario_id: 'd1',
		created_at: '2026-08-06T05:30:00.000Z',
		updated_at: '2026-08-06T06:00:00.000Z',
		...overrides
	};
}

describe('fechas (hora de Bogotá, UTC-5)', () => {
	test('fechaBogota: medianoche local equivale a las 05:00Z', () => {
		expect(fechaBogota('2026-08-06T05:00:00.000Z')).toBe('2026-08-06');
	});

	test('fechaBogota: antes de las 05:00Z pertenece al día anterior', () => {
		expect(fechaBogota('2026-08-06T02:30:00.000Z')).toBe('2026-08-05');
	});

	test('fechaBogota: fecha inválida devuelve cadena vacía', () => {
		expect(fechaBogota('no-es-fecha')).toBe('');
	});

	test('fechaHoraBogota: formatea con hora local', () => {
		expect(fechaHoraBogota('2026-08-06T05:00:00.000Z')).toBe('2026-08-06 00:00');
		expect(fechaHoraBogota('2026-08-06T02:30:00.000Z')).toBe('2026-08-05 21:30');
	});
});

describe('validarRango', () => {
	test('sin fechas: rango «todo» con límites UTC nulos', () => {
		expect(validarRango(null, null)).toEqual({
			desde: null,
			hasta: null,
			desdeUTC: null,
			hastaExclUTC: null
		});
	});

	test('convierte fechas de Bogotá a límites UTC (hasta es exclusivo)', () => {
		const r = validarRango('2026-08-01', '2026-08-06');
		expect(r?.desdeUTC).toBe('2026-08-01T05:00:00.000Z');
		expect(r?.hastaExclUTC).toBe('2026-08-07T05:00:00.000Z');
	});

	test('solo desde: hasta queda sin límite', () => {
		const r = validarRango('2026-08-01', null);
		expect(r?.desdeUTC).toBe('2026-08-01T05:00:00.000Z');
		expect(r?.hastaExclUTC).toBeNull();
	});

	test('desde mayor que hasta es inválido', () => {
		expect(validarRango('2026-08-10', '2026-08-06')).toBeNull();
	});

	test('fechas imposibles son inválidas', () => {
		expect(validarRango('2026-02-30', '2026-08-06')).toBeNull();
		expect(validarRango('06/08/2026', null)).toBeNull();
	});

	test('esFechaValida acepta solo YYYY-MM-DD reales', () => {
		expect(esFechaValida('2026-08-06')).toBe(true);
		expect(esFechaValida('2026-02-28')).toBe(true);
		expect(esFechaValida('2026-13-01')).toBe(false);
		expect(esFechaValida('')).toBe(false);
		expect(esFechaValida(null)).toBe(false);
	});
});

describe('agruparPorDia', () => {
	test('agrupa por día de Bogotá y suma ingresos solo de entregados', () => {
		const pedidos = [
			pedido({ estado: 'entregado', tarifa_base: 6000, created_at: '2026-08-06T10:00:00.000Z' }),
			pedido({ id: 'id-2', numero: 'ABC124', estado: 'cancelado', tarifa_base: 5000, created_at: '2026-08-06T12:00:00.000Z' }),
			pedido({ id: 'id-3', numero: 'ABC125', estado: 'pendiente', created_at: '2026-08-07T05:00:00.000Z' })
		];
		const series = agruparPorDia(pedidos);

		expect(series).toHaveLength(2);
		expect(series[0]).toEqual({ fecha: '2026-08-06', total: 2, entregados: 1, cancelados: 1, ingresos: 6000 });
		expect(series[1]).toEqual({ fecha: '2026-08-07', total: 1, entregados: 0, cancelados: 0, ingresos: 0 });
	});

	test('los ingresos usan el total (tarifa + recargos) cuando existe', () => {
		const pedidos = [pedido({ estado: 'entregado', total: 9000, recargo_total: 3000 })];
		const series = agruparPorDia(pedidos);
		expect(series[0].ingresos).toBe(9000);
	});

	test('sin total (pedido anterior a Fase 7) usa la tarifa base', () => {
		const pedidos = [pedido({ estado: 'entregado', total: null })];
		const series = agruparPorDia(pedidos);
		expect(series[0].ingresos).toBe(6000);
	});

	test('una fecha inválida se omite sin romper la serie', () => {
		const series = agruparPorDia([pedido({ created_at: 'no-es-fecha' })]);
		expect(series).toHaveLength(0);
	});
});

describe('agruparPorDomiciliario', () => {
	test('agrupa por domiciliario, marca «Sin asignar» y ordena por total desc', () => {
		const domiciliarios = [{ id: 'd1', nombre: 'Ana' }];
		const pedidos = [
			pedido({ estado: 'entregado', tarifa_base: 6000, domiciliario_id: 'd1' }),
			pedido({ id: 'id-2', numero: 'ABC124', estado: 'cancelado', domiciliario_id: 'd1' }),
			pedido({ id: 'id-3', numero: 'ABC125', estado: 'entregado', tarifa_base: 8000, total: 8000, domiciliario_id: null })
		];
		const filas = agruparPorDomiciliario(pedidos, domiciliarios);

		expect(filas).toHaveLength(2);
		expect(filas[0]).toEqual({ id: 'd1', nombre: 'Ana', total: 2, entregados: 1, cancelados: 1, ingresos: 6000 });
		expect(filas[1]).toEqual({ id: null, nombre: 'Sin asignar', total: 1, entregados: 1, cancelados: 0, ingresos: 8000 });
	});
});

describe('pedidosACsv', () => {
	const fila: ReportePedidoFila = {
		...pedido({ observaciones: 'dijo "hola", ¿ok?' }),
		barrio_origen_nombre: 'Centro',
		barrio_destino_nombre: 'Caño',
		domiciliario_nombre: 'Ana'
	};

	test('incluye cabecera y usa fecha/hora de Bogotá', () => {
		const csv = pedidosACsv([fila]);
		const lineas = csv.split('\r\n');
		expect(lineas[0]).toBe(
			'numero,fecha (Bogotá),estado,tarifa,total,comision,origen,destino,domiciliario,observaciones'
		);
		expect(lineas[1]).toContain('ABC123,2026-08-06 00:30');
	});

	test('la comisión congelada del pedido viaja en el CSV', () => {
		const conComision = pedidosACsv([{ ...fila, comision: 1300 }]);
		expect(conComision.split('\r\n')[1]).toContain(',6000,6000,1300,');
		// Sin comisión (pedido previo a Fase 10) la celda queda vacía.
		expect(pedidosACsv([fila]).split('\r\n')[1]).toContain(',6000,6000,,');
	});

	test('el total del CSV incluye los recargos (total ?? tarifa_base)', () => {
		const conRecargos = pedidosACsv([{ ...fila, recargo_total: 3000, total: 9000 }]);
		expect(conRecargos.split('\r\n')[1]).toContain(',6000,9000,');
		// Sin total (pedido anterior a Fase 7) usa la tarifa base.
		const sinTotal = pedidosACsv([{ ...fila, total: null }]);
		expect(sinTotal.split('\r\n')[1]).toContain(',6000,6000,');
	});

	test('escapa comillas y comas en campos de texto (sin sobrecitar lo que no lo necesita)', () => {
		const csv = pedidosACsv([fila]);
		expect(csv).toContain('"dijo ""hola"", ¿ok?"');
		// Sin comas ni comillas el campo se deja tal cual.
		expect(csv).toContain(',Centro · Calle 1,');
	});

	test('convierte valores nulos a celdas vacías', () => {
		const csv = pedidosACsv([{ ...fila, domiciliario_nombre: null, observaciones: null }]);
		const campos = csv.split('\r\n')[1].split(',');
		// domiciliario y observaciones quedan vacíos al final de la fila
		expect(campos[campos.length - 1]).toBe('');
		expect(campos[campos.length - 2]).toBe('');
	});

	test('lista vacía devuelve solo la cabecera', () => {
		const csv = pedidosACsv([]);
		expect(csv.split('\r\n')).toHaveLength(1);
	});
});
