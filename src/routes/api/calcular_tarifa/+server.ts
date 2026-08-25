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
	const sectorOrigen = (body?.sector_origen ?? barrioOrigen) as SectorId;
	const sectorDestino = (body?.sector_destino ?? barrioDestino) as SectorId;
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
