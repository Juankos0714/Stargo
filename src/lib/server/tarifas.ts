import type { SupabaseClient } from '@supabase/supabase-js';
import { calcularTarifaPura, ZONA_ROJA, type TarifaMatriz } from '$lib/logic/tarifa';

export type { MotivoTarifa, ResultadoTarifa } from '$lib/logic/tarifa';

/**
 * Dado barrio origen y destino (id UUID o nombre), resuelve sus zonas contra
 * la BD y delega la decisión del precio (matriz + fallback simétrico + zona
 * roja/sin sector) en la lógica pura calcularTarifaPura().
 * Espejo de la función SQL public.calcular_tarifa().
 */
export async function calcularTarifa(
	barrioOrigen: string,
	barrioDestino: string,
	db?: SupabaseClient
): Promise<ReturnType<typeof calcularTarifaPura>> {
	// Cliente real perezoso: se obtiene con import dinámico para que los tests
	// puedan inyectar un cliente simulado sin cargar $env/static/public.
	const supabase = db ?? (await import('./supabase')).getSupabaseAnon();

	// Resolver barrio → zona. Acepta el id (UUID) o el nombre (case-insensitive).
	const resolver = async (term: string) => {
		// 1) Por id
		const { data: porId, error: err1 } = await supabase
			.from('barrios')
			.select('id, nombre, zona_id')
			.eq('id', term)
			.limit(1);
		if (!err1 && porId && porId.length > 0) return porId[0];
		// 2) Por nombre (insensible a mayúsculas). Se escapan % y _ para que
		//    no actúen como comodines de ILIKE (p. ej. un barrio llamado "100%").
		const terminoSeguro = term.replace(/[\\%_]/g, '\\$&');
		const { data: porNombre, error: err2 } = await supabase
			.from('barrios')
			.select('id, nombre, zona_id')
			.ilike('nombre', terminoSeguro)
			.limit(1);
		if (err2) return null;
		return (porNombre ?? [])[0] ?? null;
	};

	const origen = await resolver(barrioOrigen);
	const destino = await resolver(barrioDestino);

	// Solo consulta la matriz si ambos barrios tienen sector y ninguno está en
	// la zona roja (la decisión final igualmente la toma la lógica pura).
	let filas: TarifaMatriz[] = [];
	if (
		origen?.zona_id &&
		destino?.zona_id &&
		origen.zona_id !== ZONA_ROJA &&
		destino.zona_id !== ZONA_ROJA
	) {
		const buscar = async (o: string, d: string): Promise<TarifaMatriz | null> => {
			const { data } = await supabase
				.from('tarifas')
				.select('zona_origen_id, zona_destino_id, valor')
				.eq('zona_origen_id', o)
				.eq('zona_destino_id', d)
				.limit(1);
			return (data ?? [])[0] ?? null;
		};
		// Matriz simétrica: buscar directa y, si no existe, sentido inverso.
		const directa = await buscar(origen.zona_id, destino.zona_id);
		if (directa) {
			filas.push(directa);
		} else {
			const inversa = await buscar(destino.zona_id, origen.zona_id);
			if (inversa) filas.push(inversa);
		}
	}

	return calcularTarifaPura(origen, destino, filas);
}
