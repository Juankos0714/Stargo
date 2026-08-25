import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { calcularTarifa } from '$lib/server/tarifas';
import {
	calcularPrecio,
	crearTramoPrincipal,
	type TipoDiligencia,
	type Tramo,
	type RecargoSeleccionado
} from '$lib/logic/tarifas-nuevas';
import type { SectorId } from '$lib/logic/matriz-domicilio';
import type { TipoPago } from '$lib/logic/tabla-recargos';

/**
 * Mapea el nombre/zona de la BD al sector de la matriz_domicilio.
 * Busca coincidencia parcial en el nombre de la zona.
 */
function mapearZonaASector(nombreZona: string, zonaId: string): SectorId {
	const nombre = (nombreZona ?? '').toLowerCase();
	const id = (zonaId ?? '').toLowerCase();

	// Mapeo por nombre de zona (coincidencia parcial)
	if (nombre.includes('centro')) return 'centro';
	if (nombre.includes('norte')) {
		if (nombre.includes('50') || nombre.includes('38')) return 'norte_38_50';
		if (nombre.includes('19') || nombre.includes('37')) return 'norte_19_37';
		return 'norte_1_18';
	}
	if (nombre.includes('sur')) {
		if (nombre.includes('puerto') || nombre.includes('espejo')) return 'sur_despues_puerto_espejo';
		if (nombre.includes('naranjo')) return 'sur_despues_naranjos';
		return 'sur_27_50';
	}

	// Mapeo por ID de zona (fallback)
	if (id.includes('centro')) return 'centro';
	if (id.includes('norte')) return 'norte_1_18';
	if (id.includes('sur')) return 'sur_27_50';

	// Default: centro
	return 'centro';
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const barrioOrigen = String(body?.barrio_origen ?? '').trim();
	const barrioDestino = String(body?.barrio_destino ?? '').trim();
	if (!barrioOrigen || !barrioDestino) {
		return json({ error: 'Faltan barrio_origen o barrio_destino' }, { status: 400 });
	}

	// Legacy: cálculo simple por barrios (domicilio normal)
	const tipoDiligencia = (body?.tipo_diligencia ?? '') as TipoDiligencia;
	const subtipoPago = body?.subtipo_pago as TipoPago | undefined;

	// Si no hay tipo de diligencia o es domicilio simple, usar el motor legacy.
	if (!tipoDiligencia || tipoDiligencia === 'domicilio') {
		const resultado = await calcularTarifa(barrioOrigen, barrioDestino);
		return json({ data: resultado.valor, meta: resultado.meta });
	}

	// Motor nuevo: modelo de tramos para compra/diligencia_bancaria/tramite
	// Resolver barrio → sector de la matriz (el cliente envía UUIDs, la matriz usa IDs descriptivos).
	const resolverSector = async (barrioId: string): Promise<SectorId | null> => {
		const supabase = getSupabaseAnon();
		const { data } = await supabase
			.from('barrios')
			.select('zona_id, nombre')
			.eq('id', barrioId)
			.limit(1);
		if (!data || data.length === 0) return null;
		const zona = data[0];
		// Mapear zona de la BD → sector de la matriz.
		// La zona debe tener un nombre que contenga el sector.
		return mapearZonaASector(zona.nombre, zona.zona_id);
	};

	const sectorOrigen = (body?.sector_origen as SectorId) ?? (await resolverSector(barrioOrigen)) ?? 'centro';
	const sectorDestino = (body?.sector_destino as SectorId) ?? (await resolverSector(barrioDestino)) ?? 'centro';
	const tramoPrincipal = crearTramoPrincipal(sectorOrigen, sectorDestino, tipoDiligencia);

	// Tramos adicionales (recogidas extra)
	const tramosAdicionales: Tramo[] = Array.isArray(body?.tramos_adicionales)
		? body.tramos_adicionales.map((t: { origen: string; destino: string }) => ({
				origen: t.origen as SectorId,
				destino: t.destino as SectorId,
				proposito: 'recogida_extra' as const
			}))
		: [];

	// Recargos seleccionados
	const recargos: RecargoSeleccionado[] = Array.isArray(body?.recargos)
		? body.recargos.map((r: { id: string; bloques_20min?: number; paradas?: number }) => ({
				id: r.id,
				bloques_20min: r.bloques_20min,
				paradas: r.paradas
			}))
		: [];

	const resultado = calcularPrecio({
		tipo_diligencia: tipoDiligencia,
		subtipo_pago: subtipoPago,
		tramo_principal: tramoPrincipal,
		tramos_adicionales: tramosAdicionales,
		recargos,
		monto_pago: Number(body?.monto_pago) || undefined,
		peso_kg: Number(body?.peso_kg) || undefined
	});

	return json({
		data: resultado.disponible ? resultado.total : null,
		meta: {
			disponible: resultado.disponible,
			aproximado: resultado.aproximado,
			motivo: resultado.disponible ? 'ok' : (resultado.motivo ?? 'sin_tarifa'),
			tramo_principal: resultado.tramo_principal,
			tramos_adicionales: resultado.tramos_adicionales,
			recargos_desglose: resultado.recargos_desglose,
			recargo_total: resultado.recargo_total
		}
	});
};
