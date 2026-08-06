import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { registrarError } from '$lib/server/errores';

/**
 * POST /api/errores — público (lo usa hooks.client y el reporte de errores
 * de frontend). Registra un error del navegador en errores_app para el
 * dashboard de métricas y las alertas de tasa 5xx/rate limit.
 *
 * Best-effort: ante fallos de red devuelve 200 igual (el reporte de errores
 * nunca puede romper la página que ya está fallando). Sin límite de sesión:
 * los visitantes anónimos también reportan.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const cuerpo = (await request.json().catch(() => null)) as
			| { origen?: unknown; tipo?: unknown; mensaje?: unknown; ruta?: unknown }
			| null;

		const origen = cuerpo?.origen === 'servidor' ? 'servidor' : 'cliente';
		const tipo = typeof cuerpo?.tipo === 'string' ? cuerpo.tipo : 'unhandled';
		const mensaje = typeof cuerpo?.mensaje === 'string' ? cuerpo.mensaje : 'Error de frontend';
		const ruta = typeof cuerpo?.ruta === 'string' ? cuerpo.ruta : null;

		// Solo tipos conocidos: evita que el payload controle la taxonomía.
		const tiposPermitidos = new Set([
			'unhandled',
			'promesa',
			'fetch',
			'error',
			'test',
			'5xx',
			'rate_limit'
		]);
		const tipoFinal = tiposPermitidos.has(tipo) ? tipo : 'unhandled';

		await registrarError({ origen, tipo: tipoFinal, mensaje, ruta }, undefined);
	} catch {
		// El registro es best-effort; si falla no se propaga el error.
	}
	return json({ data: { ok: true } }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
};
