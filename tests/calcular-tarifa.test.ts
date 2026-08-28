import { describe, expect, test } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { calcularTarifa } from '../src/lib/server/tarifas';

// --- Cliente Supabase simulado --------------------------------------------

interface Fila {
	[key: string]: unknown;
}

interface ConsultaCapturada {
	tabla: string;
	condiciones: Record<string, string>;
	ilike: { columna: string; valor: string } | null;
}

const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Builder encadenable que imita el subset de PostgREST que usa calcularTarifa:
 * select(...).eq(...).ilike(...).limit(1). Emula ILIKE con % (comodín),
 * _ (un carácter) y \X (literal).
 */
class BuilderFalso {
	private condiciones: Record<string, string> = {};
	private condicionIlike: { columna: string; valor: string } | null = null;

	constructor(
		private readonly tabla: string,
		private readonly filas: Fila[],
		private readonly fallarIlike: boolean,
		private readonly capturas: ConsultaCapturada[]
	) {}

	select(_columnas?: string) {
		return this;
	}

	eq(columna: string, valor: string) {
		this.condiciones[columna] = valor;
		return this;
	}

	ilike(columna: string, valor: string) {
		this.condicionIlike = { columna, valor };
		return this;
	}

	async limit(_max: number) {
		this.capturas.push({
			tabla: this.tabla,
			condiciones: { ...this.condiciones },
			ilike: this.condicionIlike ? { ...this.condicionIlike } : null
		});

		if (this.tabla === 'barrios' && this.condicionIlike && this.fallarIlike) {
			return { data: null, error: new Error('Error simulado de ILIKE') };
		}

		// Filtra por condiciones exactas (eq).
		let resultado = this.filas;
		for (const [columna, valor] of Object.entries(this.condiciones)) {
			resultado = resultado.filter((f) => f[columna] === valor);
		}

		// Filtra por ilike: % = cualquier secuencia, _ = un carácter, \X = X literal.
		if (this.condicionIlike) {
			let patron = '';
			const valor = this.condicionIlike.valor;
			for (let i = 0; i < valor.length; i++) {
				const ch = valor[i];
				if (ch === '\\') {
					i++;
					patron += escaparRegex(valor[i] ?? '');
				} else if (ch === '%') {
					patron += '.*';
				} else if (ch === '_') {
					patron += '.';
				} else {
					patron += escaparRegex(ch);
				}
			}
			const re = new RegExp(`^${patron}$`, 'i');
			resultado = resultado.filter(
				(f) =>
					typeof f[this.condicionIlike!.columna] === 'string' &&
					re.test(f[this.condicionIlike!.columna] as string)
			);
		}

		return { data: resultado.slice(0, _max), error: null };
	}
}

function crearCliente(opciones: {
	barrios?: Fila[];
	tarifas?: Fila[];
	fallarIlike?: boolean;
} = {}): { cliente: SupabaseClient; capturas: ConsultaCapturada[] } {
	const capturas: ConsultaCapturada[] = [];
	const from = (tabla: string) => {
		if (tabla === 'barrios') {
			return new BuilderFalso('barrios', opciones.barrios ?? [], opciones.fallarIlike ?? false, capturas);
		}
		if (tabla === 'tarifas') {
			return new BuilderFalso('tarifas', opciones.tarifas ?? [], false, capturas);
		}
		throw new Error(`Tabla inesperada en el test: ${tabla}`);
	};
	return { cliente: { from } as unknown as SupabaseClient, capturas };
}

// --- Fixtures -------------------------------------------------------------

const CENTRO = { id: 'a1b2c3d4-0000-0000-0000-000000000001', nombre: 'Centro', zona_id: 'z1' };
const CANO = { id: 'a1b2c3d4-0000-0000-0000-000000000002', nombre: 'Caño', zona_id: 'z2' };
const ROJO = { id: 'a1b2c3d4-0000-0000-0000-000000000003', nombre: 'Zona Roja', zona_id: 'zona_roja' };
const CIEN_PORCIENTO = { id: 'a1b2c3d4-0000-0000-0000-000000000004', nombre: '100% Real', zona_id: 'z3' };
const RIO_GUION_BAJO = { id: 'a1b2c3d4-0000-0000-0000-000000000005', nombre: 'Río_Claro', zona_id: 'z4' };

// --- Tests ----------------------------------------------------------------

describe('calcularTarifa (barrio → zona → matriz)', () => {
	test('resuelve por id y aplica la tarifa directa', async () => {
		const { cliente } = crearCliente({
			barrios: [CENTRO, CANO],
			tarifas: [{ zona_origen_id: 'z1', zona_destino_id: 'z2', valor: 6000 }]
		});
		const r = await calcularTarifa(CENTRO.id, CANO.id, cliente);

		expect(r.valor).toBe(6000);
		expect(r.meta.motivo).toBe('ok');
		expect(r.meta.disponible).toBe(true);
		expect(r.meta.barrio_origen).toBe('Centro');
		expect(r.meta.barrio_destino).toBe('Caño');
		expect(r.meta.zona_origen).toBe('z1');
		expect(r.meta.zona_destino).toBe('z2');
	});

	test('el mismo barrio consulta y aplica la tarifa intra-zona', async () => {
		const { cliente } = crearCliente({
			barrios: [CENTRO],
			tarifas: [{ zona_origen_id: 'z1', zona_destino_id: 'z1', valor: 6000 }]
		});
		const r = await calcularTarifa(CENTRO.id, CENTRO.id, cliente);

		expect(r.valor).toBe(6000);
		expect(r.meta.disponible).toBe(true);
		expect(r.meta.motivo).toBe('ok');
	});

	test('resuelve por nombre insensible a mayúsculas', async () => {
		const { cliente } = crearCliente({
			barrios: [CENTRO, CANO],
			tarifas: [{ zona_origen_id: 'z1', zona_destino_id: 'z2', valor: 6000 }]
		});
		const r = await calcularTarifa('centro', 'caño', cliente);

		expect(r.valor).toBe(6000);
		expect(r.meta.motivo).toBe('ok');
	});

	test('usa la tarifa en sentido inverso cuando la directa no existe', async () => {
		const { cliente } = crearCliente({
			barrios: [CENTRO, CANO],
			tarifas: [{ zona_origen_id: 'z2', zona_destino_id: 'z1', valor: 7500 }]
		});
		const r = await calcularTarifa(CENTRO.id, CANO.id, cliente);

		expect(r.valor).toBe(7500);
		expect(r.meta.motivo).toBe('ok');
		expect(r.meta.zona_origen).toBe('z1');
		expect(r.meta.zona_destino).toBe('z2');
	});

	test('devuelve sin_tarifa cuando la matriz no cubre la ruta', async () => {
		const { cliente } = crearCliente({ barrios: [CENTRO, CANO], tarifas: [] });
		const r = await calcularTarifa(CENTRO.id, CANO.id, cliente);

		expect(r.valor).toBeNull();
		expect(r.meta.motivo).toBe('sin_tarifa');
		expect(r.meta.disponible).toBe(false);
	});

	test('una tarifa de valor 0 es válida (no se confunde con «no hay tarifa»)', async () => {
		const { cliente } = crearCliente({
			barrios: [CENTRO, CANO],
			tarifas: [{ zona_origen_id: 'z1', zona_destino_id: 'z2', valor: 0 }]
		});
		const r = await calcularTarifa(CENTRO.id, CANO.id, cliente);

		expect(r.valor).toBe(0);
		expect(r.meta.motivo).toBe('ok');
		expect(r.meta.disponible).toBe(true);
	});

	test('devuelve zona_no_disponible si origen o destino es la zona roja', async () => {
		const { cliente } = crearCliente({ barrios: [CENTRO, ROJO] });
		const r = await calcularTarifa(CENTRO.id, ROJO.id, cliente);

		expect(r.valor).toBeNull();
		expect(r.meta.motivo).toBe('zona_no_disponible');
		expect(r.meta.zona_destino).toBe('zona_roja');
	});

	test('devuelve barrio_no_encontrado si el barrio no existe', async () => {
		const { cliente } = crearCliente({ barrios: [CENTRO, CANO] });
		const r = await calcularTarifa('id-inexistente', CANO.id, cliente);

		expect(r.valor).toBeNull();
		expect(r.meta.motivo).toBe('barrio_no_encontrado');
		expect(r.meta.barrio_origen).toBeNull();
	});

	test('un error de ILIKE no rompe la consulta: devuelve barrio_no_encontrado', async () => {
		const { cliente } = crearCliente({
			barrios: [CENTRO, CANO],
			tarifas: [{ zona_origen_id: 'z1', zona_destino_id: 'z2', valor: 6000 }],
			fallarIlike: true
		});
		const r = await calcularTarifa(CENTRO.id, 'nombre-fantasma', cliente);

		expect(r.valor).toBeNull();
		expect(r.meta.motivo).toBe('barrio_no_encontrado');
	});

	test('escapa % y _ antes de ilike y permite buscar barrios con «%» en el nombre', async () => {
		const { cliente, capturas } = crearCliente({
			barrios: [CIEN_PORCIENTO, CANO],
			tarifas: [{ zona_origen_id: 'z3', zona_destino_id: 'z2', valor: 8000 }]
		});
		const r = await calcularTarifa('100% Real', CANO.id, cliente);

		expect(r.valor).toBe(8000);
		expect(r.meta.motivo).toBe('ok');
		expect(r.meta.barrio_origen).toBe('100% Real');

		// El término enviado a ILIKE debe ir escapado (100\% Real), no con % suelto.
		const ilikeOrigen = capturas.find(
			(c) => c.tabla === 'barrios' && c.ilike?.columna === 'nombre'
		);
		expect(ilikeOrigen?.ilike?.valor).toBe('100\\% Real');
	});

	test('escapa _ antes de ilike y permite buscar barrios con guion bajo en el nombre', async () => {
		const { cliente } = crearCliente({
			barrios: [RIO_GUION_BAJO, CANO],
			tarifas: [{ zona_origen_id: 'z4', zona_destino_id: 'z2', valor: 9000 }]
		});
		const r = await calcularTarifa('Río_Claro', CANO.id, cliente);

		expect(r.valor).toBe(9000);
		expect(r.meta.motivo).toBe('ok');
		expect(r.meta.barrio_origen).toBe('Río_Claro');
	});
});
