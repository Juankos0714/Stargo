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
import { TABLA_RECARGOS, type TipoPago } from '$lib/logic/tabla-recargos';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const barrioOrigen = String(body?.barrio_origen ?? '').trim();
	const barrioDestino = String(body?.barrio_destino ?? '').trim();
	if (!barrioOrigen || !barrioDestino) {
		return json({ error: 'Faltan barrio_origen o barrio_destino' }, { status: 400 });
	}

	const tipoDiligencia = String(body?.tipo_diligencia ?? '') as TipoDiligencia;
	const subtipoPago = body?.subtipo_pago as TipoPago | undefined;

	// Domicilio normal: resolver tarifa de zona.
	// Los recargos de peso/transferencia se calculan dinámicamente en el frontend
	// con recargoPeso() y recargoTransferencia() (valores escalonados).
	if (!tipoDiligencia || tipoDiligencia === 'domicilio') {
		const resultado = await calcularTarifa(barrioOrigen, barrioDestino);
		// El cliente solo comunica los códigos seleccionados. El valor vigente se
		// obtiene siempre del catálogo activo en BD, nunca del navegador.
		const codigosRecargos = Array.isArray(body?.recargos)
			? body.recargos
					.map((recargo: unknown) =>
						typeof recargo === 'object' && recargo !== null
							? String((recargo as { id?: unknown }).id ?? '').trim()
							: ''
					)
					.filter(Boolean)
			: [];
		const codigosUnicos = [...new Set(codigosRecargos)].slice(0, 15);
		let recargos: { codigo: string; nombre: string; valor: number }[] = [];
		if (codigosUnicos.length > 0) {
			const supabase = (await import('$lib/server/supabase')).getSupabaseAnon();
			const { data: catalogo, error } = await supabase
				.from('recargos')
				.select('codigo, nombre, valor')
				.in('codigo', codigosUnicos)
				.eq('activo', true);
			if (error) return json({ error: 'No se pudieron consultar los recargos.' }, { status: 500 });
			const porCodigo = new Map((catalogo ?? []).map((recargo) => [recargo.codigo, recargo]));
			recargos = codigosUnicos.flatMap((codigo) => {
				const recargo = porCodigo.get(codigo);
				return recargo && Number.isFinite(recargo.valor)
					? [{ codigo: recargo.codigo, nombre: recargo.nombre, valor: recargo.valor }]
					: [];
			});
		}
		return json({
			data: resultado.valor,
			meta: {
				...resultado.meta,
				recargos,
				recargo_total: recargos.reduce((total, recargo) => total + recargo.valor, 0)
			}
		});
	}

	// ===== Pago bancario / corresponsal: precio PLANO + recargos desde BD =====
	if (tipoDiligencia === 'pago' || tipoDiligencia === 'banco') {
		const subtipo: TipoPago = subtipoPago ?? (tipoDiligencia === 'banco' ? 'bancario' : 'corresponsal');
		const valorPlano = TABLA_RECARGOS.pagos[subtipo];

		// Tramos adicionales (recogida extra)
		let total = valorPlano;
		const tramosAdicionales: DesgloseTramo[] = [];
		const tramosAdicionalesInput = Array.isArray(body?.tramos_adicionales) ? body.tramos_adicionales : [];
		for (const t of tramosAdicionalesInput) {
			// Para tramos adicionales de recogida, cobrar tarifa mínima estimada
			total += 5000;
			tramosAdicionales.push({
				origen: 'centro' as SectorId,
				destino: 'centro' as SectorId,
				proposito: 'recogida_extra',
				valor: 5000,
				fuente: 'matriz_domicilio'
			});
		}

		// Consultar recargos seleccionados desde la BD (transferencia, paradas, etc.)
		const codigosRecargos = Array.isArray(body?.recargos)
			? body.recargos
					.map((recargo: unknown) =>
						typeof recargo === 'object' && recargo !== null
							? String((recargo as { id?: unknown }).id ?? '').trim()
							: ''
					)
					.filter(Boolean)
			: [];
		const codigosUnicos = [...new Set(codigosRecargos)].slice(0, 15);
		let recargosBD: { codigo: string; nombre: string; valor: number }[] = [];
		if (codigosUnicos.length > 0) {
			const supabase = (await import('$lib/server/supabase')).getSupabaseAnon();
			const { data: catalogo, error } = await supabase
				.from('recargos')
				.select('codigo, nombre, valor')
				.in('codigo', codigosUnicos)
				.eq('activo', true);
			if (!error && catalogo) {
				const porCodigo = new Map((catalogo ?? []).map((r) => [r.codigo, r]));
				recargosBD = codigosUnicos.flatMap((codigo) => {
					const recargo = porCodigo.get(codigo);
					return recargo && Number.isFinite(recargo.valor)
						? [{ codigo: recargo.codigo, nombre: recargo.nombre, valor: recargo.valor }]
						: [];
				});
			}
		}
		const recargoTotal = recargosBD.reduce((sum, r) => sum + r.valor, 0);
		total += recargoTotal;

		return json({
			data: total,
			meta: {
				disponible: true,
				aproximado: tramosAdicionales.length > 0,
				motivo: 'ok',
				tramo_principal: {
					origen: 'centro',
					destino: 'centro',
					proposito: 'pago',
					valor: valorPlano,
					fuente: 'tabla_pagos'
				},
				tramos_adicionales: tramosAdicionales,
				recargos: recargosBD,
				recargo_total: recargoTotal
			}
		});
	}

	// ===== Compra / trámite / otro: matriz de zonas =====
	// Resolver barrio → sector de la matriz
	let sectorOrigen: SectorId = 'centro';
	let sectorDestino: SectorId = 'centro';

	try {
		const supabase = (await import('$lib/server/supabase')).getSupabaseAnon();
		const [{ data: bOrigen }, { data: bDestino }] = await Promise.all([
			supabase.from('barrios').select('zona_id').eq('id', barrioOrigen).limit(1),
			supabase.from('barrios').select('zona_id').eq('id', barrioDestino).limit(1)
		]);

		if (bOrigen?.[0]?.zona_id && bDestino?.[0]?.zona_id) {
			const [{ data: zOrigen }, { data: zDestino }] = await Promise.all([
				supabase.from('zonas').select('nombre').eq('id', bOrigen[0].zona_id).limit(1),
				supabase.from('zonas').select('nombre').eq('id', bDestino[0].zona_id).limit(1)
			]);
			sectorOrigen = mapearZonaASector(String(zOrigen?.[0]?.nombre ?? ''), bOrigen[0].zona_id);
			sectorDestino = mapearZonaASector(String(zDestino?.[0]?.nombre ?? ''), bDestino[0].zona_id);
		}
	} catch {
		// Si falla la resolución, usar 'centro' como default
	}

	const tramoPrincipal = crearTramoPrincipal(sectorOrigen, sectorDestino, tipoDiligencia);

	// Tramos adicionales (recogida extra)
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

type DesgloseTramo = {
	origen: SectorId;
	destino: SectorId;
	proposito: string;
	valor: number;
	fuente: 'matriz_domicilio' | 'tabla_pagos';
};

/**
 * Mapea el nombre/zona de la BD al sector de la matriz_domicilio.
 */
function mapearZonaASector(nombreZona: string, zonaId: string): SectorId {
	const nombre = String(nombreZona ?? '').toLowerCase();
	const id = String(zonaId ?? '').toLowerCase();

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

	if (id.includes('centro')) return 'centro';
	if (id.includes('norte')) return 'norte_1_18';
	if (id.includes('sur')) return 'sur_27_50';

	return 'centro';
}
