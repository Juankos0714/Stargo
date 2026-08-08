/**
 * Lógica pura de comisiones (Fase 11 — tests unitarios).
 *
 * Sin dependencias de BD ni de UI. El domiciliario debe a la app una
 * comisión por cada pedido entregado, calculada por NIVELES según el
 * valor del pedido (total = tarifa base + recargos):
 *
 *   Nivel 1 → pedidos hasta $10.000   · $1.300
 *   Nivel 2 → pedidos hasta $20.000   · $1.300
 *   ...
 *
 * La deuda es la diferencia entre lo generado (Σ comisiones de pedidos
 * entregados) y los abonos registrados; nunca puede ser negativa.
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
