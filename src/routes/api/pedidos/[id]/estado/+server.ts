import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser } from '$lib/server/supabase';
import { requireRol } from '$lib/server/auth';
import { transicionar } from '$lib/logic/estado-pedido';
import { comisionDiaria, fechaBogota, nivelesParaFecha, nivelDiario } from '$lib/logic/comisiones';
import type { ComisionHistorico, ComisionNivel } from '$lib/types';
import { ESTADOS_PEDIDO, type EstadoPedido } from '$lib/types';

/**
 * POST /api/pedidos/[id]/estado — cambia el estado de un pedido.
 *
 * Permite a administradores (cancelar) y al domiciliario asignado
 * (aceptar → recogido → en camino → entregado). Se pre-valida la transición
 * con la máquina de estados pura (fail-fast, mismos mensajes que la BD) y
 * la validación final de rol/propiedad/transiciones ocurre en el RPC
 * transicionar_pedido (SECURITY DEFINER), que además registra cada cambio
 * en historial_estados.
 */
export const POST: RequestHandler = async (event) => {
	const { sesion, esAdmin } = await requireRol(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const { id } = event.params;
	const body = await event.request.json().catch(() => ({}));
	const nuevoEstado = String(body?.estado ?? '').trim() as EstadoPedido;
	const notas = String(body?.notas ?? '').trim() || null;
	const motivo = String(body?.motivo ?? '').trim() || null;

	if (!Object.hasOwn(ESTADOS_PEDIDO, nuevoEstado)) {
		return json({ error: 'Estado inválido.' }, { status: 400 });
	}
	if (notas && notas.length > 500) {
		return json({ error: 'La nota es demasiado larga (máx. 500 caracteres).' }, { status: 400 });
	}
	if (motivo && motivo.length > 300) {
		return json({ error: 'El motivo es demasiado largo (máx. 300 caracteres).' }, { status: 400 });
	}

	// Pre-validación con la máquina de estados pura: falla rápido sin tocar
	// Postgres y con los mismos mensajes de la BD. La BD sigue siendo la
	// autoridad final (si el pedido no es visible para el rol, el RPC decide).
	const rol = esAdmin ? 'admin' : 'domiciliario';
	const { data: actual } = await db.from('pedidos').select('estado').eq('id', id).limit(1);
	const estadoActual = (actual?.[0]?.estado as EstadoPedido | undefined) ?? null;
	if (estadoActual) {
		try {
			transicionar(rol, estadoActual, nuevoEstado);
		} catch (e) {
			return json({ error: (e as Error).message }, { status: 400 });
		}
	}

	const { data, error: err } = await db.rpc('transicionar_pedido', {
		p_pedido_id: id,
		p_estado: nuevoEstado,
		p_nota: notas,
		p_motivo: nuevoEstado === 'cancelado' ? motivo : null
	});
	if (err) return json({ error: err.message }, { status: 400 });

	// Fase 23: Al entregar, registrar la comisión generada en el ledger de deuda.
	// Calcula la comisión incremental (diferencia antes/después de esta entrega).
	if (nuevoEstado === 'entregado' && data?.domiciliario_id) {
		try {
			await registrarComisionDeuda(db, data.pedido_id, data.domiciliario_id);
		} catch {
			// Best-effort: si falla el registro de deuda, el pedido ya cambió de estado.
			// El admin puede registrar la comisión manualmente después.
		}
	}

	return json({ data });
};

/**
 * Registra la comisión generada por un pedido entregado en el ledger de deuda.
 * Calcula la comisión incremental: la diferencia entre la comisión diaria
 * DESPUÉS y ANTES de agregar este pedido al total del día.
 */
async function registrarComisionDeuda(
	db: ReturnType<typeof getSupabaseAsUser>,
	pedidoId: string,
	domiciliarioId: string
): Promise<void> {
	// 1) Obtener el pedido entregado para saber su total y fecha
	const { data: pedido } = await db
		.from('pedidos')
		.select('total, tarifa_base, recargo_total, updated_at, domiciliario_id')
		.eq('id', pedidoId)
		.maybeSingle();

	if (!pedido || !pedido.domiciliario_id) return;

	const totalPedido = pedido.total ?? (pedido.tarifa_base + (pedido.recargo_total ?? 0));
	if (totalPedido <= 0) return;

	const fechaPedido = fechaBogota(pedido.updated_at);
	if (!fechaPedido) return;

	// 2) Obtener escalera congelada para ese día o la vigente
	const { data: historico } = await db
		.from('comision_historico')
		.select('niveles')
		.eq('fecha', fechaPedido)
		.maybeSingle();

	let niveles: ComisionNivel[];
	if (historico?.niveles) {
		niveles = historico.niveles as ComisionNivel[];
	} else {
		const { data: nivelesData } = await db.from('comision_niveles').select('*').order('nivel');
		niveles = (nivelesData ?? []) as ComisionNivel[];
	}

	if (niveles.length === 0) return;

	// 3) Obtener todos los pedidos entregados de ESTE domiciliario en ESTE día
	//    (incluyendo el que acabamos de entregar)
	const inicioDia = new Date(fechaPedido + 'T05:00:00Z'); // 00:00 Bogotá = 05:00 UTC
	const finDia = new Date(inicioDia);
	finDia.setUTCDate(finDia.getUTCDate() + 1);

	const { data: entregados } = await db
		.from('pedidos')
		.select('total, tarifa_base, recargo_total')
		.eq('estado', 'entregado')
		.eq('domiciliario_id', domiciliarioId)
		.gte('updated_at', inicioDia.toISOString())
		.lt('updated_at', finDia.toISOString());

	if (!entregados || entregados.length === 0) return;

	// 4) Calcular comisión diaria ACTUAL (con este pedido incluido)
	const totalDia = entregados.reduce((acc, e) => {
		const t = e.total ?? (e.tarifa_base + (e.recargo_total ?? 0));
		return acc + Math.max(0, t);
	}, 0);

	const comisionActual = comisionDiaria(niveles, totalDia);

	// 5) Calcular comisión diaria ANTES de este pedido (sin este pedido)
	const totalDiaAntes = totalDia - totalPedido;
	const comisionAntes = comisionDiaria(niveles, totalDiaAntes);

	// 6) La comisión incremental es la diferencia
	const comisionIncremental = Math.max(0, comisionActual - comisionAntes);

	if (comisionIncremental <= 0) return;

	// 7) Registrar en el ledger
	await db.rpc('registrar_generacion_deuda', {
		p_pedido_id: pedidoId,
		p_domiciliario_id: domiciliarioId,
		p_monto: comisionIncremental
	});
}
