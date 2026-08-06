import { getSupabaseAnon } from './supabase';

export type MotivoTarifa = 'ok' | 'barrio_no_encontrado' | 'zona_no_disponible' | 'sin_tarifa';

export interface ResultadoTarifa {
	valor: number | null;
	meta: {
		disponible: boolean;
		motivo: MotivoTarifa;
		barrio_origen?: string | null;
		barrio_destino?: string | null;
		zona_origen?: string | null;
		zona_destino?: string | null;
	};
}

const ZONA_ROJA = 'zona_roja';

/**
 * Dado barrio origen y destino (id UUID o nombre), resuelve sus zonas y
 * busca el precio en la matriz de tarifas, con fallback simétrico.
 * Espejo de la función SQL public.calcular_tarifa().
 */
export async function calcularTarifa(barrioOrigen: string, barrioDestino: string): Promise<ResultadoTarifa> {
	const supabase = getSupabaseAnon();

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

	if (!origen || !destino) {
		return {
			valor: null,
			meta: {
				disponible: false,
				motivo: 'barrio_no_encontrado',
				barrio_origen: origen?.nombre ?? null,
				barrio_destino: destino?.nombre ?? null
			}
		};
	}

	if (origen.zona_id === ZONA_ROJA || destino.zona_id === ZONA_ROJA) {
		return {
			valor: null,
			meta: {
				disponible: false,
				motivo: 'zona_no_disponible',
				barrio_origen: origen.nombre,
				barrio_destino: destino.nombre,
				zona_origen: origen.zona_id,
				zona_destino: destino.zona_id
			}
		};
	}

	// Matriz simétrica: buscar directa y, si no existe, sentido inverso.
	const buscar = async (o: string, d: string): Promise<number | null> => {
		const { data } = await supabase
			.from('tarifas')
			.select('valor')
			.eq('zona_origen_id', o)
			.eq('zona_destino_id', d)
			.limit(1);
		return (data ?? [])[0]?.valor ?? null;
	};

	let valor = await buscar(origen.zona_id, destino.zona_id);
	if (valor == null) valor = await buscar(destino.zona_id, origen.zona_id);

	return {
		valor,
		meta: {
			disponible: valor != null,
			motivo: valor == null ? 'sin_tarifa' : 'ok',
			barrio_origen: origen.nombre,
			barrio_destino: destino.nombre,
			zona_origen: origen.zona_id,
			zona_destino: destino.zona_id
		}
	};
}
