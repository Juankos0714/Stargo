import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser } from '$lib/server/supabase';
import { requireRol } from '$lib/server/auth';
import { transicionar } from '$lib/logic/estado-pedido';
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

	// Fase 24: Al entregar, registrar la comisión por servicio en el ledger.
	// Cada servicio genera una comisión = tarifa del nivel vigente del domiciliario.
	if (nuevoEstado === 'entregado' && data?.domiciliario_id) {
		try {
			await registrarComisionDeuda(db, data.pedido_id, data.domiciliario_id);
		} catch (e) {
			// Log the error but don't fail the whole request — the pedido
			// state change already succeeded. The admin can retry or register
			// the commission manually. This is NOT silent: the error appears
			// in server logs for monitoring and debugging.
			console.error(
				`[Fase24] Error registering debt for pedido ${data.pedido_id}:`,
				e instanceof Error ? e.message : String(e)
			);
		}
	}

	return json({ data });
};

/**
 * Registra la comisión generada por un servicio completado en el ledger
 * de deuda (Fase 24 — comisión por servicio, no por día).
 *
 * Flujo:
 *   1. Verificar idempotencia (pedido ya registrado)
 *   2. Leer nivel actual del domiciliario
 *   3. Buscar la tarifa configurada para ese nivel
 *   4. Registrar en el ledger con nivel y tarifa
 */
async function registrarComisionDeuda(
	db: ReturnType<typeof getSupabaseAsUser>,
	pedidoId: string,
	domiciliarioId: string
): Promise<void> {
	// 0) Idempotencia: si ya existe un movimiento para este pedido, salir.
	//    Esto evita llamadas duplicadas al RPC (retry, race condition).
	const { data: existente } = await db
		.from('deuda_movimientos')
		.select('id')
		.eq('domiciliario_id', domiciliarioId)
		.eq('referencia_tipo', 'pedido')
		.eq('referencia_id', pedidoId)
		.maybeSingle();
	if (existente) return;

	// 1) Leer nivel actual del domiciliario
	const { data: dom } = await db
		.from('domiciliarios')
		.select('nivel')
		.eq('id', domiciliarioId)
		.maybeSingle();

	const nivel = dom?.nivel ?? 1;

	// 2) Buscar la tarifa configurada para ese nivel
	const { data: comisionNivel } = await db
		.from('comision_niveles')
		.select('valor')
		.eq('nivel', nivel)
		.maybeSingle();

	const tarifa = comisionNivel?.valor ?? 0;

	// Sin tarifa configurada: no generar deuda (nivel sin comisión)
	if (tarifa <= 0) return;

	// 3) Registrar en el ledger (el RPC maneja idempotencia y FOR UPDATE)
	await db.rpc('registrar_generacion_deuda', {
		p_pedido_id: pedidoId,
		p_domiciliario_id: domiciliarioId,
		p_monto: tarifa,
		p_nivel: nivel,
		p_tarifa: tarifa
	});
}
