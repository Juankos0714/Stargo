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

/** Estados de pedido: etiqueta, colores de badge y transiciones del flujo completo. */
export const ESTADOS_PEDIDO: Record<
	EstadoPedido,
	{ label: string; color: string; next: EstadoPedido[] }
> = {
	pendiente: {
		label: 'Pendiente',
		color: 'bg-amber-100 text-amber-800 border-amber-200',
		next: ['asignado', 'cancelado']
	},
	asignado: {
		label: 'Asignado',
		color: 'bg-indigo-100 text-indigo-800 border-indigo-200',
		next: ['aceptado', 'cancelado']
	},
	aceptado: {
		label: 'Aceptado',
		color: 'bg-sky-100 text-sky-800 border-sky-200',
		next: ['recogido', 'cancelado']
	},
	recogido: {
		label: 'Recogido',
		color: 'bg-cyan-100 text-cyan-800 border-cyan-200',
		next: ['en_camino', 'cancelado']
	},
	en_camino: {
		label: 'En camino',
		color: 'bg-violet-100 text-violet-800 border-violet-200',
		next: ['entregado', 'cancelado']
	},
	entregado: {
		label: 'Entregado',
		color: 'bg-emerald-100 text-emerald-800 border-emerald-200',
		next: []
	},
	cancelado: {
		label: 'Cancelado',
		color: 'bg-red-100 text-red-700 border-red-200',
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

export function formatearPeso(valor: number | null | undefined): string {
	if (valor == null || Number.isNaN(valor)) return '—';
	return new Intl.NumberFormat('es-CO', {
		style: 'currency',
		currency: 'COP',
		maximumFractionDigits: 0
	}).format(valor);
}

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
