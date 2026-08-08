import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser } from '$lib/server/supabase';
import { miDomiciliarioId, requireDomiciliario } from '$lib/server/auth';
import { obtenerCuentaDomiciliario } from '$lib/server/cuenta';
import type { CuentaDomiciliario } from '$lib/types';

/**
 * GET /api/domiciliarios/mi-cuenta — cuenta del domiciliario autenticado.
 *
 * Devuelve la comisión vigente por pedido, si está bloqueado por falta de
 * pago y el desglose de su deuda (generado por pedidos entregados, abonos
 * registrados y saldo pendiente). El domiciliario lo usa para saber
 * cuánto debe a la app.
 */
export const GET: RequestHandler = async (event) => {
	const sesion = await requireDomiciliario(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	const domiciliarioId = await miDomiciliarioId(sesion);
	if (!domiciliarioId) {
		return json({ error: 'Domiciliario inactivo.' }, { status: 403 });
	}

	const { niveles, bloqueado, resumen, hoy } = await obtenerCuentaDomiciliario(db, domiciliarioId);
	const cuenta: CuentaDomiciliario = {
		niveles,
		bloqueado,
		...resumen,
		hoy
	};
	return json({ data: cuenta });
};
