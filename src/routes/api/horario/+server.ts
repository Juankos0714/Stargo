import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAnon, getSupabaseAsUser } from '$lib/server/supabase';
import { requireAdmin } from '$lib/server/auth';
import { esHoraValida, validarHoras } from '$lib/logic/horario';
import type { HorarioDia, HorarioExcepcion, HorarioHoy } from '$lib/types';

/**
 * Horarios de operación (Fase 13):
 *
 *   GET  /api/horario                  → estado de HOY (público, rpc horario_hoy)
 *   GET  /api/horario?completo=1       → semana + excepciones (solo admin)
 *   PUT  /api/horario                  → upsert de un día semanal (admin):
 *          { tipo: 'semanal', dia_semana, apertura, cierre, activo }
 *        o de una excepción:
 *          { tipo: 'excepcion', fecha, apertura, cierre, activo, motivo }
 *   DELETE /api/horario?tipo=excepcion&fecha=YYYY-MM-DD (solo admin)
 *
 * El estado de "abierto ahora" lo calcula la BD (public.horario_hoy()), que
 * es la misma fuente que usa crear_pedido() para bloquear pedidos fuera de
 * horario.
 */

/** Horas válidas: HH:MM de 24 horas. */
function horaValida(h: unknown): h is string {
	return typeof h === 'string' && esHoraValida(h);
}

async function leerHorarioHoy(db: SupabaseClient): Promise<HorarioHoy | null> {
	const r = await db.rpc('horario_hoy');
	return (r.data as HorarioHoy) ?? null;
}

export const GET: RequestHandler = async (event) => {
	const url = new URL(event.request.url);

	// Estado de HOY (público): lo usa nuevo-pedido para avisar si está cerrado.
	if (!url.searchParams.has('completo')) {
		const hoy = await leerHorarioHoy(getSupabaseAnon());
		if (!hoy) return json({ error: 'No se pudo calcular el horario de hoy.' }, { status: 500 });
		return json({ data: hoy });
	}

	// Semana + excepciones (solo admin).
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);
	const [rSemanal, rExc] = await Promise.all([
		db.from('horario_operacion').select('*').order('dia_semana'),
		db.from('horario_excepcion').select('*').order('fecha', { ascending: false })
	]);
	if (rSemanal.error) return json({ error: rSemanal.error.message }, { status: 500 });
	if (rExc.error) return json({ error: rExc.error.message }, { status: 500 });
	return json({
		data: {
			semanal: (rSemanal.data ?? []) as HorarioDia[],
			excepciones: (rExc.data ?? []) as HorarioExcepcion[]
		}
	});
};

export const PUT: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);
	const body = await event.request.json().catch(() => ({}));

	const tipo = body?.tipo;
	if (tipo !== 'semanal' && tipo !== 'excepcion') {
		return json({ error: 'Tipo inválido: usa semanal o excepcion.' }, { status: 400 });
	}

	const apertura = body?.apertura;
	const cierre = body?.cierre;
	if (!horaValida(apertura) || !horaValida(cierre)) {
		return json({ error: 'Las horas deben tener formato HH:MM (24 horas).' }, { status: 400 });
	}
	const errorHoras = validarHoras(apertura, cierre);
	if (errorHoras) return json({ error: errorHoras }, { status: 400 });
	const activo = body?.activo !== false;

	if (tipo === 'semanal') {
		const dia = Number(body?.dia_semana);
		if (!Number.isInteger(dia) || dia < 1 || dia > 7) {
			return json({ error: 'Día inválido: usa 1 (Lunes) … 7 (Domingo).' }, { status: 400 });
		}
		const { data, error: err } = await db
			.from('horario_operacion')
			.upsert({ dia_semana: dia, apertura, cierre, activo }, { onConflict: 'dia_semana' })
			.select()
			.single();
		if (err) return json({ error: err.message }, { status: 400 });
		return json({ data });
	}

	// excepcion
	const fecha = String(body?.fecha ?? '');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
		return json({ error: 'Fecha inválida: usa YYYY-MM-DD.' }, { status: 400 });
	}
	const motivo = typeof body?.motivo === 'string' && body.motivo.trim() ? body.motivo.trim().slice(0, 300) : null;
	const { data, error: err } = await db
		.from('horario_excepcion')
		.upsert({ fecha, apertura, cierre, activo, motivo }, { onConflict: 'fecha' })
		.select()
		.single();
	if (err) return json({ error: err.message }, { status: 400 });
	return json({ data });
};

export const DELETE: RequestHandler = async (event) => {
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const url = new URL(event.request.url);
	const tipo = url.searchParams.get('tipo');
	const fecha = url.searchParams.get('fecha') ?? '';
	if (tipo !== 'excepcion') {
		return json({ error: 'Solo se eliminan excepciones (?tipo=excepcion&fecha=YYYY-MM-DD).' }, { status: 400 });
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
		return json({ error: 'Fecha inválida: usa YYYY-MM-DD.' }, { status: 400 });
	}
	const { data, error: err } = await db.from('horario_excepcion').delete().eq('fecha', fecha).select().single();
	if (err) return json({ error: err.message }, { status: 400 });
	if (!data) return json({ error: 'Excepción no encontrada.' }, { status: 404 });
	return json({ data });
};
