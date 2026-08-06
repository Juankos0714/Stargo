export type ZonaTipo = 'urbana' | 'destino_solo' | 'no_disponible';

export interface Zona {
	id: string;
	nombre: string;
	tipo: ZonaTipo;
	descripcion: string | null;
}

export interface Barrio {
	id: string;
	nombre: string;
	zona_id: string | null;
	revisado: boolean;
	created_at?: string;
}

export interface Tarifa {
	id: string;
	zona_origen_id: string;
	zona_destino_id: string;
	valor: number;
	updated_at?: string;
}

// ---------- Recargos (Fase 7) ----------

export type TipoRecargo = 'compra' | 'tiempo_espera' | 'paradas' | 'peso' | 'pago' | 'otro';

export interface Recargo {
	codigo: string;
	nombre: string;
	tipo: TipoRecargo | string;
	valor: number;
	activo: boolean;
	descripcion: string | null;
}

/** Recargo aplicado a un pedido (snapshot guardado en la BD). */
export interface RecargoAplicado {
	codigo: string;
	nombre: string;
	valor: number;
}

export const TIPOS_RECARGO: { valor: TipoRecargo; label: string; color: string }[] = [
	{ valor: 'compra', label: 'Compra', color: 'bg-sky-50 text-sky-700 border-sky-200' },
	{ valor: 'tiempo_espera', label: 'Tiempo de espera', color: 'bg-amber-50 text-amber-700 border-amber-200' },
	{ valor: 'paradas', label: 'Paradas', color: 'bg-violet-50 text-violet-700 border-violet-200' },
	{ valor: 'peso', label: 'Peso', color: 'bg-orange-50 text-orange-700 border-orange-200' },
	{ valor: 'pago', label: 'Pago (transf./banco/corresponsal)', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
	{ valor: 'otro', label: 'Otro', color: 'bg-slate-100 text-slate-600 border-slate-200' }
];

export function etiquetaTipoRecargo(tipo: string): string {
	return TIPOS_RECARGO.find((t) => t.valor === tipo)?.label ?? tipo;
}

export type EstadoPedido =
	| 'pendiente'
	| 'asignado'
	| 'aceptado'
	| 'recogido'
	| 'en_camino'
	| 'entregado'
	| 'cancelado';

export interface Domiciliario {
	id: string;
	user_id: string;
	nombre: string;
	email: string | null;
	telefono: string | null;
	activo: boolean;
	created_at?: string;
}

export interface Pedido {
	id: string;
	numero: string;
	barrio_origen_id: string;
	direccion_origen: string;
	barrio_destino_id: string;
	direccion_destino: string;
	observaciones: string | null;
	tarifa_base: number;
	/** Snapshot de recargos aplicados (Fase 7). */
	recargos: RecargoAplicado[] | null;
	recargo_total: number;
	/** tarifa_base + recargo_total (null en pedidos previos a la Fase 7). */
	total: number | null;
	motivo_cancelacion: string | null;
	zona_origen_id: string | null;
	zona_destino_id: string | null;
	estado: EstadoPedido;
	domiciliario_id: string | null;
	created_at: string;
	updated_at: string;
}

export interface HistorialEstado {
	id: number;
	pedido_id: string;
	estado: EstadoPedido;
	notas: string | null;
	created_at: string;
}

export interface PedidoConsultado {
	pedido: Pedido & { barrio_origen_nombre?: string | null; barrio_destino_nombre?: string | null };
	historial: HistorialEstado[];
}

// ---------- Reportes (Fase 6) ----------

/** Resumen agregado de pedidos para un rango de fechas. */
export interface ReporteResumen {
	total: number;
	por_estado: Record<EstadoPedido, number>;
	/** asignado + aceptado + recogido + en_camino */
	en_proceso: number;
	entregados: number;
	cancelados: number;
	/** Suma de tarifa_base de los pedidos entregados. */
	ingresos: number;
	/** ingresos / entregados (0 si no hay entregados). */
	ticket_promedio: number;
	domiciliarios_activos: number;
	/** Activos con al menos un pedido en curso hoy (sin importar el rango). */
	domiciliarios_ocupados: number;
	domiciliarios_disponibles: number;
}

/** Serie diaria para la gráfica (fechas en hora de Bogotá, UTC-5). */
export interface ReporteSerie {
	fecha: string;
	total: number;
	entregados: number;
	cancelados: number;
	ingresos: number;
}

/** Pedidos agrupados por domiciliario dentro del rango. */
export interface ReporteDomiciliario {
	id: string | null;
	nombre: string;
	total: number;
	entregados: number;
	cancelados: number;
	ingresos: number;
}

/** Fila de pedido enriquecida para reportes y CSV. */
export interface ReportePedidoFila extends Pedido {
	barrio_origen_nombre: string | null;
	barrio_destino_nombre: string | null;
	domiciliario_nombre: string | null;
}

/** Respuesta completa de /api/reportes. */
export interface Reporte {
	rango: { desde: string | null; hasta: string | null };
	resumen: ReporteResumen;
	series: ReporteSerie[];
	por_domiciliario: ReporteDomiciliario[];
	pedidos: ReportePedidoFila[];
}

/** Estados de pedido: etiqueta, colores de badge y transiciones del flujo completo. */
export const ESTADOS_PEDIDO: Record<
	EstadoPedido,
	{ label: string; color: string; next: EstadoPedido[] }
> = {
	// Colores del Design System v1.0: warning, primario, info y neutros.
	pendiente: {
		label: 'Pendiente',
		color: 'bg-amber-50 text-amber-700 border-amber-200',
		next: ['asignado', 'cancelado']
	},
	asignado: {
		label: 'Asignado',
		color: 'bg-primary-light text-primary-dark border-primary/30',
		next: ['aceptado', 'cancelado']
	},
	aceptado: {
		label: 'Aceptado',
		color: 'bg-sky-50 text-sky-700 border-sky-200',
		next: ['recogido', 'cancelado']
	},
	recogido: {
		label: 'Recogido',
		color: 'bg-cyan-50 text-cyan-700 border-cyan-200',
		next: ['en_camino', 'cancelado']
	},
	en_camino: {
		label: 'En camino',
		color: 'bg-violet-50 text-violet-700 border-violet-200',
		next: ['entregado', 'cancelado']
	},
	entregado: {
		label: 'Entregado',
		color: 'bg-green-50 text-green-700 border-green-200',
		next: []
	},
	cancelado: {
		label: 'Cancelado',
		color: 'bg-red-50 text-red-700 border-red-200',
		next: []
	}
};

/** Próxima acción que puede ejecutar el domiciliario en cada estado. */
export const ACCIONES_DOMICILIARIO: Partial<Record<EstadoPedido, EstadoPedido>> = {
	asignado: 'aceptado',
	aceptado: 'recogido',
	recogido: 'en_camino',
	en_camino: 'entregado'
};

const ETIQUETAS_ACCION: Partial<Record<EstadoPedido, string>> = {
	aceptado: 'Aceptar pedido',
	recogido: 'Marcar recogido',
	en_camino: 'Marcar en camino',
	entregado: 'Marcar entregado'
};

/** Devuelve la acción disponible para el domiciliario o null si no hay ninguna. */
export function accionDomiciliario(
	estado: EstadoPedido
): { estado: EstadoPedido; etiqueta: string } | null {
	const s = ACCIONES_DOMICILIARIO[estado];
	if (!s) return null;
	return { estado: s, etiqueta: ETIQUETAS_ACCION[s] ?? s };
}

/** Estados activos que un domiciliario tiene en curso. */
export const ESTADOS_ACTIVOS_DOMICILIARIO: EstadoPedido[] = [
	'asignado',
	'aceptado',
	'recogido',
	'en_camino'
];

/** Estados terminales para el historial del domiciliario. */
export const ESTADOS_FINALES: EstadoPedido[] = ['entregado', 'cancelado'];

export function etiquetaEstado(estado: EstadoPedido): string {
	return ESTADOS_PEDIDO[estado]?.label ?? estado;
}

export function colorEstado(estado: EstadoPedido): string {
	return ESTADOS_PEDIDO[estado]?.color ?? 'bg-slate-100 text-slate-600 border-slate-200';
}

/** Orden canónico de zonas para la UI (matriz de tarifas, listas). */
export const ORDEN_ZONAS = [
	'centro',
	'norte_1_18',
	'norte_19_37',
	'norte_38_50',
	'sur_27_50',
	'sur_despues_naranjos',
	'sur_despues_puerto_espejo',
	'villa_inglesa',
	'cano_cristales',
	'setta_departamental',
	'zona_roja'
] as const;

/** Ordena zonas según ORDEN_ZONAS y luego alfabéticamente. */
export function ordenarZonas(zonas: Zona[]): Zona[] {
	return [...zonas].sort((a, b) => {
		const ia = ORDEN_ZONAS.indexOf(a.id as (typeof ORDEN_ZONAS)[number]);
		const ib = ORDEN_ZONAS.indexOf(b.id as (typeof ORDEN_ZONAS)[number]);
		if (ia !== -1 && ib !== -1) return ia - ib;
		if (ia !== -1) return -1;
		if (ib !== -1) return 1;
		return a.nombre.localeCompare(b.nombre, 'es');
	});
}

// ---------- Lógica de negocio pura (Parte 1) ----------
// Las funciones puras viven en $lib/logic y se testean con Vitest (cobertura
// ≥90%). Se re-exportan aquí para no romper los imports históricos desde
// '$lib/types'.
export { formatearPeso } from './logic/formato';
