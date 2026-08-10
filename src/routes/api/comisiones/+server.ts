import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAsUser } from '$lib/server/supabase';
import { requireAdmin } from '$lib/server/auth';
import { redondearComision } from '$lib/logic/comisiones';
import type { ComisionConfig, ComisionNivel } from '$lib/types';

/**
 * Niveles de comisión (Fase 11 + 12) — solo admin:
 *
 *   GET    /api/comisiones            → lista todos los niveles (por nivel) y
 *                                       la config de la escalera (meta.config:
 *                                       paso y cantidad de niveles)
 *   POST   /api/comisiones            → agrega un nivel (continúa la escalera
 *                                       con el PASO configurado; acepta
 *                                       overrides opcionales de hasta/valor)
 *   PUT    /api/comisiones?id=X       → edita valor y/o hasta de un nivel
 *                                       (valida que los rangos sigan ordenados)
 *   DELETE /api/comisiones?id=X       → elimina un nivel (no el último)
 *   PUT    /api/comisiones/config     → reacomoda TODA la escalera con un paso
 *                                       y una cantidad de niveles nuevos (RPC)
 *
 * La escritura pasa por RPCs SECURITY DEFINER (Fase 18 hardening) que
 * congelan el día y escriben en la MISMA transacción (agregar/actualizar/
 * eliminar_nivel_comision); la lectura del domiciliario llega vía /mi-cuenta.
 */

/** Id fijo de la fila única de comision_config (la migración Fase 12 lo crea). */
const CONFIG_ID = '00000000-0000-0000-0000-000000000001';

/** Lee la config de la escalera; respaldo si aún no existe la fila (pre-Fase 12). */
async function leerConfig(db: SupabaseClient, niveles: ComisionNivel[]): Promise<ComisionConfig> {
	const { data: cfg } = await db.from('comision_config').select('*').eq('id', CONFIG_ID).maybeSingle();
	if (cfg) return cfg as ComisionConfig;
	const ordenados = [...niveles].sort((a, b) => a.nivel - b.nivel);
	const paso =
		ordenados.length > 1 && ordenados[1].hasta > ordenados[0].hasta
			? ordenados[1].hasta - ordenados[0].hasta
			: ordenados[0]?.hasta ?? 10000;
	return { id: CONFIG_ID, paso, niveles: ordenados.length };
}

/** Mantiene comision_config.niveles al día con la cantidad real de niveles. */
async function sincronizarNiveles(db: SupabaseClient): Promise<void> {
	const { count } = await db.from('comision_niveles').select('*', { count: 'exact', head: true });
	const { data: cfg } = await db.from('comision_config').select('paso').eq('id', CONFIG_ID).maybeSingle();
	await db.from('comision_config').upsert({
		id: CONFIG_ID,
		...(cfg ? { paso: cfg.paso } : {}),
		niveles: count ?? 0,
		updated_at: new Date().toISOString()
	});
}

export const GET: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const { data, error: err } = await db.from('comision_niveles').select('*').order('nivel');
	if (err) return json({ error: err.message }, { status: 500 });
	const niveles = (data ?? []) as ComisionNivel[];
	return json({ data: niveles, meta: { config: await leerConfig(db, niveles) } });
};

export const POST: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const body = await event.request.json().catch(() => ({}));
	const { data: actuales } = await db
		.from('comision_niveles')
		.select('nivel, hasta, valor')
		.order('nivel', { ascending: false })
		.limit(1);
	const ultimo = (actuales ?? [])[0] as ComisionNivel | undefined;

	// Por defecto continúa la escalera con el PASO configurado: nivel = max+1,
	// hasta = max + paso, valor = el del último nivel (o $1.300 si no hay).
	const { data: cfg } = await db.from('comision_config').select('paso').eq('id', CONFIG_ID).maybeSingle();
	const paso = (cfg?.paso as number | undefined) ?? 10000;
	const hastaInput = Number(body?.hasta);
	const valorInput = Number(body?.valor);
	const hasta =
		Number.isFinite(hastaInput) && hastaInput > 0 ? Math.round(hastaInput) : (ultimo?.hasta ?? 0) + paso;
	const valor =
		Number.isFinite(valorInput) && valorInput >= 0
			? redondearComision(valorInput)
			: (ultimo?.valor ?? 1300);
	const nivel = (ultimo?.nivel ?? 0) + 1;

	if (!Number.isFinite(hasta) || hasta <= 0) {
		return json({ error: 'El tope del nivel debe ser mayor que cero.' }, { status: 400 });
	}
	// El tope se guarda en un INTEGER: cap explícito para un mensaje claro
	// (el RPC reconfigurar_escalera valida los mismos límites).
	if (hasta > 2_000_000_000) {
		return json({ error: 'El tope del nivel no puede superar $2.000.000.000.' }, { status: 400 });
	}
	if (nivel > 200) {
		return json({ error: 'La escalera no puede superar los 200 niveles.' }, { status: 400 });
	}
	if (!Number.isFinite(valor) || valor < 0) {
		return json({ error: 'El valor de la comisión no puede ser negativo.' }, { status: 400 });
	}
	// El nivel nuevo se agrega al final de la escalera: su tope debe superar
	// al máximo existente (si no, quedaría un nivel inalcanzable y fuera de
	// orden, ya que la búsqueda ordena por nivel).
	if (ultimo && hasta <= ultimo.hasta) {
		return json(
			{ error: `El tope debe ser mayor que ${ultimo.hasta} (tope del nivel ${ultimo.nivel}).` },
			{ status: 400 }
		);
	}

	// El RPC congela HOY con la escalera vigente y agrega el nivel en la MISMA
	// transacción (hardening Fase 18): el cambio aplica desde mañana.
	const { data, error: err } = await db.rpc('agregar_nivel_comision', {
		p_nivel: nivel,
		p_hasta: hasta,
		p_valor: valor
	});
	if (err) return json({ error: err.message }, { status: 400 });
	await sincronizarNiveles(db);
	return json({ data });
};

export const PUT: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const url = new URL(event.request.url);
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'Falta el id del nivel.' }, { status: 400 });

	const body = await event.request.json().catch(() => ({}));
	const tieneValor = typeof body?.valor === 'number' && Number.isFinite(body.valor);
	const tieneHasta = typeof body?.hasta === 'number' && Number.isFinite(body.hasta);
	if (!tieneValor && !tieneHasta) {
		return json({ error: 'Envía al menos un campo: valor o hasta.' }, { status: 400 });
	}

	const { data: fila } = await db.from('comision_niveles').select('*').eq('id', id).maybeSingle();
	if (!fila) return json({ error: 'Nivel no encontrado.' }, { status: 404 });

	const cambios: Record<string, number> = {};
	if (tieneValor) {
		if (body.valor < 0) return json({ error: 'La comisión no puede ser negativa.' }, { status: 400 });
		cambios.valor = redondearComision(body.valor);
	}

	if (tieneHasta) {
		const hasta = Math.round(body.hasta);
		if (hasta <= 0) return json({ error: 'El tope del nivel debe ser mayor que cero.' }, { status: 400 });
		// El nuevo tope debe dejar los rangos ordenados (previo.hasta < hasta <
		// siguiente.hasta) para que la escalera siga siendo contigua.
		const { data: vecinos } = await db
			.from('comision_niveles')
			.select('nivel, hasta')
			.order('nivel');
		const lista = (vecinos ?? []) as { nivel: number; hasta: number }[];
		const idx = lista.findIndex((n) => n.nivel === fila.nivel);
		const previo = idx > 0 ? lista[idx - 1] : null;
		const siguiente = idx >= 0 && idx < lista.length - 1 ? lista[idx + 1] : null;
		if (previo && hasta <= previo.hasta) {
			return json(
				{ error: `El tope debe ser mayor que ${previo.hasta} (tope del nivel ${previo.nivel}).` },
				{ status: 400 }
			);
		}
		if (siguiente && hasta >= siguiente.hasta) {
			return json(
				{ error: `El tope debe ser menor que ${siguiente.hasta} (tope del nivel ${siguiente.nivel}).` },
				{ status: 400 }
			);
		}
		cambios.hasta = hasta;
	}

	// El RPC congela HOY con la escalera vigente y actualiza el nivel en la MISMA
	// transacción (hardening Fase 18): el cambio aplica desde mañana.
	const { data, error: err } = await db.rpc('actualizar_nivel_comision', {
		p_id: id,
		p_valor: cambios.valor ?? null,
		p_hasta: cambios.hasta ?? null
	});
	if (err) return json({ error: err.message }, { status: 400 });
	if (!data) return json({ error: 'Nivel no encontrado.' }, { status: 404 });
	return json({ data });
};

export const DELETE: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const url = new URL(event.request.url);
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'Falta el id del nivel.' }, { status: 400 });

	// No se puede quedar sin niveles: sin niveles la comisión sería 0 para todo.
	const { count } = await db.from('comision_niveles').select('*', { count: 'exact', head: true });
	if ((count ?? 0) <= 1) {
		return json({ error: 'Debe existir al menos un nivel de comisión.' }, { status: 400 });
	}

	// El RPC congela HOY con la escalera vigente y elimina el nivel en la MISMA
	// transacción (hardening Fase 18): el cambio aplica desde mañana.
	const { data, error: err } = await db.rpc('eliminar_nivel_comision', { p_id: id });
	if (err) return json({ error: err.message }, { status: 400 });
	if (!data) return json({ error: 'Nivel no encontrado.' }, { status: 404 });
	await sincronizarNiveles(db);
	return json({ data });
};
