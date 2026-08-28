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
	// `transicionar_pedido` solo devuelve el pedido y el nuevo estado. Conservamos
	// el domiciliario antes de la transición para poder cobrar la comisión aun
	// con las versiones del RPC que no lo incluyen en su respuesta.
	const { data: actual } = await db
		.from('pedidos')
		.select('estado, domiciliario_id')
		.eq('id', id)
		.limit(1);
	const pedidoActual = actual?.[0];
	const estadoActual = (pedidoActual?.estado as EstadoPedido | undefined) ?? null;
	const domiciliarioId = pedidoActual?.domiciliario_id ?? null;
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
	if (nuevoEstado === 'entregado' && domiciliarioId) {
		try {
			await registrarComisionDeuda(db, id, domiciliarioId);
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
 * La base de datos obtiene el nivel y la tarifa dentro de una transacción.
 * Así el cliente no puede alterar el valor de la comisión ni dejar una
 * entrega sin registrar por una carrera entre sus lecturas y la escritura.
 */
async function registrarComisionDeuda(
	db: ReturnType<typeof getSupabaseAsUser>,
	pedidoId: string,
	domiciliarioId: string
): Promise<void> {
	// El RPC maneja idempotencia, permisos y bloqueo de fila. `p_monto` se
	// conserva por compatibilidad de firma; la función calcula la tarifa real.
	const { error } = await db.rpc('registrar_generacion_deuda', {
		p_pedido_id: pedidoId,
		p_domiciliario_id: domiciliarioId,
		p_monto: 0,
		// Incluir estos argumentos selecciona explícitamente la versión por
		// servicio (Fase 24), en vez de la antigua sobrecarga de 3 parámetros
		// que interpreta el monto 0 como «no generar deuda».
		p_nivel: null,
		p_tarifa: null
	});
	if (error) throw new Error(error.message);
}
