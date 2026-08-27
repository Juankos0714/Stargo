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

// ---------- Tipo de servicio (Fase 14) ----------

/**
 * Tipo de servicio de un pedido: 'domicilio' (recoger y entregar) o
 * 'compra_diligencia' (diligencia con destino, recogida opcional).
 */
export type TipoServicio = 'domicilio' | 'compra_diligencia';

export const TIPOS_SERVICIO: { valor: TipoServicio; label: string; corta: string }[] = [
	{ valor: 'domicilio', label: 'Domicilio normal', corta: 'Domicilio' },
	{ valor: 'compra_diligencia', label: 'Compra / diligencia', corta: 'Compra-diligencia' }
];

export function etiquetaTipoServicio(tipo: TipoServicio | string | null | undefined): string {
	if (tipo === 'compra_diligencia') return 'Compra-diligencia';
	return 'Domicilio';
}

export interface Domiciliario {
	id: string;
	user_id: string;
	nombre: string;
	/** Usuario de acceso sin correo («movil1»); null si solo usa email (Fase 16). */
	username?: string | null;
	/** Email real o sintético interno (movil1@stargo.local); nunca se muestra al repartidor. */
	email: string | null;
	telefono: string | null;
	activo: boolean;
	/** Bloqueado por falta de pago: no recibe pedidos nuevos hasta que el admin lo desbloquee (Fase 10). */
	bloqueado?: boolean;
	/** Nivel actual del domiciliario (Fase 24): determina la comisión por servicio. */
	nivel?: number;
	created_at?: string;
}

// ---------- Comisiones, abonos y bloqueo (Fase 10 + 11) ----------

/**
 * Nivel de comisión (Fase 11): la comisión depende del VALOR del pedido.
 * Cada nivel cubre un rango de total (0..hasta para el nivel 1; el rango
 * siguiente empieza en hasta+1). `valor` es la comisión (COP) para ese rango.
 */
export interface ComisionNivel {
	id: string;
	nivel: number;
	hasta: number;
	valor: number;
	created_at?: string;
}

/**
 * Configuración global de la escalera (Fase 12): una sola fila en
 * comision_config. `paso` es cuánto abarca cada nivel (el tope de un nivel
 * es nivel × paso) y `niveles` la cantidad de niveles de la escalera.
 */
export interface ComisionConfig {
	id: string;
	/** Rango que abarca cada nivel (COP): nivel 1 cubre 0..paso, nivel 2 paso+1..2×paso… */
	paso: number;
	/** Cantidad de niveles de la escalera. */
	niveles: number;
	updated_at?: string;
}

/**
 * Escalera de comisiones CONGELADA para un día (Fase 18): snapshot de
 * comision_niveles vigente ese día. Un cambio posterior de la escalera no
 * altera las comisiones de los días ya congelados (hoy incluido cuando el
 * cambio se hace hoy: aplica desde mañana).
 */
export interface ComisionHistorico {
	/** Día (YYYY-MM-DD, hora de Bogotá) al que aplica esta escalera. */
	fecha: string;
	/** Niveles congelados ese día (sin id: solo nivel/hasta/valor). */
	niveles: ComisionNivel[];
	/** Paso de la escalera congelada (referencia). */
	paso: number;
	/**
	 * true si la fila la generó el BACKFILL de la Fase 18 (escalera ACTUAL
	 * aplicada a días pasados, aproximación documentada). Las filas congeladas
	 * en tiempo real por congelar_comisiones_dia() nacen con false.
	 */
	es_backfill?: boolean;
	creado_en?: string;
}

/** Abono que el admin registra contra la deuda de comisiones de un domiciliario. */
export interface PagoDomiciliario {
	id: string;
	domiciliario_id: string;
	valor: number;
	nota: string | null;
	registrado_por: string | null;
	created_at: string;
}

/** Resumen de cuenta del domiciliario (su deuda y pagos). */
export interface CuentaDomiciliario {
	/** Niveles vigentes de comisión (ordenados), para saber cuánto pagar por día. */
	niveles: ComisionNivel[];
	bloqueado: boolean;
	/** Saldo persistente de deuda (Fase 23: ledger deuda_movimientos). */
	deuda: number;
	/** Crédito a favor cuando un abono excede la deuda (Fase 23). */
	credito_favor: number;
	/** Últimos abonos (descendente). */
	pagos: PagoDomiciliario[];
	/** Resumen del día de hoy (entregas de hoy → nivel y comisión del día). */
	hoy: ResumenDia | null;
}

/** Resumen de la comisión acumulada en un día para un domiciliario. */
export interface ResumenDia {
	/** Fecha local (YYYY-MM-DD) en hora de Bogotá. */
	fecha: string;
	/** Σ de los totales de los pedidos entregados ese día. */
	total: number;
	/** Nivel alcanzado por el total del día (null si no hubo entregas). */
	nivel: number | null;
	/** Comisión del día = Σ valores de los niveles hasta el alcanzado. */
	comision: number;
	/**
	 * true si HOY se calculó con la escalera ANTERIOR (el admin la cambió
	 * hoy): la comisión de hoy queda congelada y la nueva aplica desde mañana.
	 */
	escalera_anterior?: boolean;
}

// ---------- Horarios de operación (Fase 13) ----------

/** Horario de un día de la semana (1 = Lunes … 7 = Domingo). */
export interface HorarioDia {
	dia_semana: number;
	apertura: string;
	cierre: string;
	activo: boolean;
}

/** Excepción puntual de horario (anula el día de la semana). */
export interface HorarioExcepcion {
	fecha: string;
	apertura: string;
	cierre: string;
	/** false = día cerrado (anula el horario semanal). */
	activo: boolean;
	motivo: string | null;
}

/** Estado de hoy calculado en la BD (public.horario_hoy()). */
export interface HorarioHoy {
	fecha: string;
	dia_semana: number;
	apertura: string;
	cierre: string;
	abierto: boolean;
	motivo: string | null;
	fuente: 'excepcion' | 'semanal' | 'sin_config';
	hora_actual: string;
}

export interface Pedido {
	id: string;
	numero: string;
	/** 'domicilio' (default) o 'compra_diligencia' (Fase 14). */
	tipo_servicio: TipoServicio;
	/** El cliente confirmó explícitamente que no aplican recargos (Fase 14). */
	recargos_confirmados_no_aplica: boolean;
	/** NULL en compra/diligencia sin recogida (Fase 14). */
	barrio_origen_id: string | null;
	direccion_origen: string | null;
	/** NULL en pedidos cuyo barrio fue eliminado (ON DELETE SET NULL). */
	barrio_destino_id: string | null;
	direccion_destino: string;
	observaciones: string | null;
	/** Celular del cliente (10 dígitos, normalizado) para coordinar por WhatsApp (Fase 19). NULL en pedidos previos a la Fase 19. */
	telefono: string | null;
	/** Nombre del cliente, opcional (Fase 19): el mensaje de WhatsApp lo saluda solo cuando existe. */
	nombre_cliente: string | null;
	tarifa_base: number;
	/** Snapshot de recargos aplicados (Fase 7). */
	recargos: RecargoAplicado[] | null;
	recargo_total: number;
	/** tarifa_base + recargo_total (null en pedidos previos a la Fase 7). */
	total: number | null;
	/** Comisión congelada al entregar (Fase 10); 0/ausente en pedidos previos. */
	comision?: number;
	/** Base necesaria: efectivo que el domiciliario debe tener para comprar/pagar en el local (Fase 21). */
	base_necesaria?: number;
	/** Dinero que el domiciliario debe adelantar para un mandado o pago (Fase 22). */
	valor_mandado?: number | null;
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

// ---------- Turnos y base de domiciliarios (Fase 21) ----------

/**
 * Turno de un domiciliario: contiene la base declarada (efectivo inicial)
 * y la base disponible actual (descontando reservas de pedidos en curso).
 */
export interface Turno {
	id: string;
	domiciliario_id: string;
	/** Efectivo que el domiciliario declaró al iniciar turno. */
	base_declarada: number;
	/** Efectivo disponible descontando reservas de pedidos aceptados. */
	base_disponible_actual: number;
	iniciado_en: string;
	/** NULL si el turno sigue abierto. */
	finalizado_en: string | null;
	created_at: string;
}

/** Tipo de movimiento en el ledger de base. */
export type TipoMovimientoBase = 'reserva' | 'liberacion' | 'liquidacion';

/**
 * Movimiento en el ledger de base: cada reserva, liberación o
 * liquidación queda registrada para auditoría.
 */
export interface BaseMovimiento {
	id: number;
	turno_id: string;
	pedido_id: string | null;
	/** Monto en COP (siempre positivo; el tipo indica si suma o resta). */
	monto: number;
	tipo: TipoMovimientoBase;
	notas: string | null;
	created_at: string;
}

/** Resumen de un domiciliario con su turno activo y base disponible (admin dashboard). */
export interface DomiciliarioConBase {
	domiciliario_id: string;
	nombre: string;
	activo: boolean;
	bloqueado: boolean;
	turno_id: string | null;
	base_declarada: number | null;
	base_disponible_actual: number | null;
	turno_activo: boolean;
	iniciado_en: string | null;
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
	/** Ganancia BRUTA: suma del total (tarifa + recargos) de los entregados. */
	ingresos: number;
	/** Comisiones que la app cobra a los domiciliarios por las entregas del rango (Fase 13: comisión diaria acumulada). */
	comisiones_pagadas: number;
	/** ingresos − comisiones_pagadas (ganancia neta). */
	ingresos_netos: number;
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
export {
	calcularDeuda,
	comisionDiaria,
	fechaBogota,
	mismasEscaleras,
	nivelComision,
	nivelDeTotal,
	nivelDiario,
	nivelesParaFecha,
	rangoDeNiveles,
	redondearComision,
	totalPedidoComision,
	totalesDiarios,
	validarTopeNivel,
	vistaCompactaNiveles,
	type NivelConRango,
	type VistaCompactaNiveles
} from './logic/comisiones';
export {
	DIAS_SEMANA,
	diaDeFecha,
	esHoraValida,
	etiquetaDia,
	horarioAbierto,
	validarHoras
} from './logic/horario';
export { DOMINIO_EMAIL_SINTETICO, emailSinteticoDe, esEmail, normalizarUsername, usernameValido } from './logic/usuario';
export {
	INDICATIVO_COLOMBIA,
	NOMBRE_EMPRESA,
	mensajeWhatsAppAdmin,
	mensajeWhatsAppDomiciliario,
	normalizarTelefonoWhatsApp,
	urlWhatsApp
} from './logic/whatsapp';
