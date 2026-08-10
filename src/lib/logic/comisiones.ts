/**
 * Lógica pura de comisiones (Fase 11 + 13 — tests unitarios).
 *
 * Sin dependencias de BD ni de UI. Desde la Fase 13 la comisión es DIARIA
 * y ACUMULADA: el domiciliario debe a la app, por cada DÍA trabajado, la
 * suma de los valores de los niveles que cruza el total acumulado de sus
 * entregas de ese día (total = tarifa base + recargos):
 *
 *   Nivel 1 → hasta $10.000   · $1.300
 *   Nivel 2 → hasta $20.000   · $1.300
 *   ...
 *
 *   Ejemplo: total del día $40.000 → alcanza el NIVEL 4 → comisión del
 *   día = $1.300 × 4 = $5.200 (se paga por CADA nivel que se cruza).
 *
 * La deuda es la diferencia entre lo generado (Σ comisiones diarias) y
 * los abonos registrados; nunca puede ser negativa.
 */
import type { ComisionNivel } from '../types';

/** Redondea hacia arriba al entero más cercano (COP no tiene decimales). */
export function redondearComision(valor: number): number {
	if (!Number.isFinite(valor)) return 0;
	return Math.max(0, Math.round(valor));
}

/**
 * Valida el nuevo tope (`hasta`) de un nivel contra sus vecinos para que la
 * escalera quede SIN solapamientos ni huecos: el tope debe quedar
 * estrictamente entre el tope del nivel anterior y el del siguiente
 * (previo.hasta < hasta < siguiente.hasta). Devuelve un mensaje de error
 * legible o null si el rango es válido. El nivel 1 no tiene previo (basta con
 * hasta > 0) y el último nivel no tiene límite superior. Espeja la validación
 * del servidor (PUT /api/comisiones) para dar feedback inmediato en el panel
 * del admin sin round-trip.
 */
export function validarTopeNivel(
	niveles: ComisionNivel[],
	nivel: number,
	hasta: number
): string | null {
	if (!Number.isFinite(hasta)) return null;
	const ordenados = [...niveles].sort((a, b) => a.nivel - b.nivel);
	const idx = ordenados.findIndex((n) => n.nivel === nivel);
	// Nivel inexistente: la escalera está corrupta, lo resuelve el servidor.
	if (idx === -1) return null;
	const previo = idx > 0 ? ordenados[idx - 1] : null;
	const siguiente = idx < ordenados.length - 1 ? ordenados[idx + 1] : null;
	if (previo && hasta <= previo.hasta) {
		return `El tope del nivel ${nivel} debe ser mayor que ${previo.hasta} (tope del nivel ${previo.nivel}).`;
	}
	if (siguiente && hasta >= siguiente.hasta) {
		return `El tope del nivel ${nivel} debe ser menor que ${siguiente.hasta} (tope del nivel ${siguiente.nivel}).`;
	}
	return null;
}

/**
 * Deuda vigente de un domiciliario: comisiones generadas menos abonos
 * registrados. Nunca negativa: si el domiciliario pagó de más, la deuda
 * es 0.
 */
export function calcularDeuda(totalComision: number, totalPagos: number): number {
	const generado = Number.isFinite(totalComision) ? Math.max(0, totalComision) : 0;
	const pagado = Number.isFinite(totalPagos) ? Math.max(0, totalPagos) : 0;
	return Math.max(0, generado - pagado);
}

/**
 * Nivel que corresponde a un total de pedido: el primer nivel (por orden)
 * cuyo `hasta` cubre el total; si el total supera todos, el nivel más alto;
 * si no hay niveles, null. RLS/orden: los niveles llegan ordenados por
 * `nivel` desde la API, pero esta función se ordena sola para no depender
 * del orden de llegada.
 */
export function nivelDeTotal(niveles: ComisionNivel[], total: number): ComisionNivel | null {
	const t = Number.isFinite(total) ? Math.max(0, total) : 0;
	const ordenados = [...niveles].sort((a, b) => a.nivel - b.nivel);
	if (ordenados.length === 0) return null;
	return ordenados.find((n) => t <= n.hasta) ?? ordenados[ordenados.length - 1];
}

/** Comisión (valor del nivel) que corresponde a un total de pedido. */
export function nivelComision(niveles: ComisionNivel[], total: number): number {
	return nivelDeTotal(niveles, total)?.valor ?? 0;
}

// ---------- Comisión DIARIA acumulada (Fase 13) ----------

/**
 * Fecha local (YYYY-MM-DD) de un timestamp en hora de Bogotá (UTC-5).
 * Tolera fechas inválidas devolviendo ''.
 */
export function fechaBogota(iso: string): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	// en-CA (y sv-SE) formatean la fecha como YYYY-MM-DD; la opción timeZone
	// convierte el instante a la hora local de Bogotá sin depender del host.
	return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

/**
 * Total de un pedido entregado: `total` (Fase 7) con respaldo a la suma
 * tarifa + recargos para pedidos previos sin total.
 */
export function totalPedidoComision(total: number | null, tarifaBase: number, recargoTotal: number): number {
	if (total != null && Number.isFinite(total)) return Math.max(0, total);
	return Math.max(0, (Number.isFinite(tarifaBase) ? tarifaBase : 0) + (Number.isFinite(recargoTotal) ? recargoTotal : 0));
}

/**
 * Agrupa entregas por domiciliario y por día (Bogotá):
 * devuelve Map<domiciliario_id, Map<YYYY-MM-DD, total_del_día>>.
 */
export function totalesDiarios(
	entregas: { domiciliario_id: string | null; total?: number | null; tarifa_base?: number; recargo_total?: number; updated_at: string }[]
): Map<string, Map<string, number>> {
	const mapa = new Map<string, Map<string, number>>();
	for (const e of entregas) {
		if (!e.domiciliario_id) continue;
		const fecha = fechaBogota(e.updated_at);
		if (!fecha) continue;
		const porDia = mapa.get(e.domiciliario_id) ?? new Map<string, number>();
		porDia.set(fecha, (porDia.get(fecha) ?? 0) + totalPedidoComision(e.total ?? null, e.tarifa_base ?? 0, e.recargo_total ?? 0));
		mapa.set(e.domiciliario_id, porDia);
	}
	return mapa;
}

/**
 * Nivel que alcanza el total acumulado de un DÍA (el mismo criterio que
 * nivelDeTotal). Con total 0 (sin entregas) devuelve null: no hay nivel
 * alcanzado ni comisión. Con niveles vacíos devuelve null.
 */
export function nivelDiario(niveles: ComisionNivel[], totalDia: number): ComisionNivel | null {
	if (!Number.isFinite(totalDia) || totalDia <= 0) return null;
	return nivelDeTotal(niveles, totalDia);
}

/**
 * Comisión que genera el total acumulado de un DÍA: la suma de los valores
 * de TODOS los niveles hasta el nivel alcanzado (se paga por cada nivel que
 * se cruza). Con total 0 o sin niveles, 0. Ej.: $40.000 → nivel 4 →
 * valor(1)+valor(2)+valor(3)+valor(4).
 */
export function comisionDiaria(niveles: ComisionNivel[], totalDia: number): number {
	const alcanzado = nivelDiario(niveles, totalDia);
	if (!alcanzado) return 0;
	const ordenados = [...niveles].sort((a, b) => a.nivel - b.nivel);
	return ordenados
		.filter((n) => n.nivel <= alcanzado.nivel)
		.reduce((acc, n) => acc + (Number.isFinite(n.valor) ? Math.max(0, n.valor) : 0), 0);
}

/**
 * Escalera que aplica a una fecha concreta (Fase 18): la SNAPSHOT congelada
 * de ese día si existe (comision_historico) o la escalera vigente si el día
 * no se congeló (no hubo cambios desde entonces o aún es hoy).
 */
export function nivelesParaFecha(
	porFecha: Map<string, ComisionNivel[]>,
	fecha: string,
	actuales: ComisionNivel[]
): ComisionNivel[] {
	return porFecha.get(fecha) ?? actuales;
}

/**
 * ¿Dos escaleras son la misma? Compara nivel/hasta/valor (ignora el id: los
 * snapshots congelados no lo guardan). Se usa para saber si la escalera
 * congelada de HOY difiere de la vigente (cambió hoy → aviso en el panel).
 */
export function mismasEscaleras(a: ComisionNivel[], b: ComisionNivel[]): boolean {
	const ordenA = [...a].sort((x, y) => x.nivel - y.nivel);
	const ordenB = [...b].sort((x, y) => x.nivel - y.nivel);
	if (ordenA.length !== ordenB.length) return false;
	return ordenA.every(
		(n, i) =>
			n.nivel === ordenB[i].nivel && n.hasta === ordenB[i].hasta && n.valor === ordenB[i].valor
	);
}

export interface NivelConRango extends ComisionNivel {
	/** Límite inferior del rango (inclusive): para el nivel 1 es 1. */
	desde: number;
}

/**
 * Devuelve los niveles con su rango `desde` calculado (desde = nivel
 * anterior.hasta + 1). Útil para mostrar "Nivel 2 · de $10.001 a $20.000"
 * en la UI del admin y del domiciliario.
 */
export function rangoDeNiveles(niveles: ComisionNivel[]): NivelConRango[] {
	const ordenados = [...niveles].sort((a, b) => a.nivel - b.nivel);
	let anterior = 0;
	return ordenados.map((n) => {
		const conRango: NivelConRango = { ...n, desde: anterior + 1 };
		anterior = n.hasta;
		return conRango;
	});
}

export interface VistaCompactaNiveles<T extends ComisionNivel = ComisionNivel> {
	/** Primeros niveles siempre visibles (los 5 más bajos de la escalera). */
	primeros: T[];
	/** Lo que va después: los últimos 3 en la vista compacta, o el resto completo si se ven todos. */
	resto: T[];
	/** Cuántos niveles intermedios quedan ocultos en la vista compacta (0 si no aplica). */
	ocultos: number;
	/** ¿Hay más de 8 niveles? (la UI muestra el control para ver/ocultar los intermedios). */
	mostrarControl: boolean;
}

/**
 * Vista compacta de la escalera para el panel del domiciliario (Fase 12):
 * con escaleras largas (más de 8 niveles) se muestran los primeros 5 y los
 * últimos 3, dejando los intermedios ocultos hasta que el usuario pida verlos
 * todos. Con 8 o menos niveles (o al pedir verlos completos) se devuelve la
 * lista completa. La lista se ordena por `nivel` para no depender del orden
 * de llegada. Genérica para conservar el tipo concreto (p. ej. NivelConRango
 * con su rango `desde`).
 */
export function vistaCompactaNiveles<T extends ComisionNivel>(
	niveles: T[],
	verCompletos: boolean
): VistaCompactaNiveles<T> {
	const ordenados = [...niveles].sort((a, b) => a.nivel - b.nivel);
	const primeros = ordenados.slice(0, 5);
	let resto = ordenados.slice(5);
	let ocultos = 0;
	if (!verCompletos && ordenados.length > 8) {
		resto = ordenados.slice(-3);
		ocultos = ordenados.length - 8;
	}
	return { primeros, resto, ocultos, mostrarControl: ordenados.length > 8 };
}
