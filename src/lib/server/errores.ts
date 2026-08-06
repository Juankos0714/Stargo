import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAnon } from './supabase';

/**
 * Registro de errores en la tabla `errores_app` (Parte 9 — observabilidad).
 *
 * Lo usan hooks.server (errores 5xx/rate limits), hooks.client (errores de
 * frontend) y el endpoint /api/errores. Es SIEMPRE best-effort: un fallo de
 * red o de la BD aquí NUNCA puede romper el flujo que está reportando.
 */

export interface ErrorParaRegistrar {
	origen: 'cliente' | 'servidor';
	tipo: string;
	mensaje: string;
	ruta?: string | null;
}

/** Límites que validan el RPC (espejo de la función SQL registrar_error). */
export const ERROR_LIMITES = {
	tipo: 40,
	mensaje: 1000,
	ruta: 300
} as const;

/** Recorta a los límites del RPC para no fallar la inserción. */
function recortar(e: ErrorParaRegistrar): ErrorParaRegistrar {
	return {
		origen: e.origen === 'servidor' ? 'servidor' : 'cliente',
		tipo: String(e.tipo ?? 'otro').slice(0, ERROR_LIMITES.tipo),
		mensaje: String(e.mensaje ?? 'sin mensaje').slice(0, ERROR_LIMITES.mensaje),
		ruta: e.ruta ? String(e.ruta).slice(0, ERROR_LIMITES.ruta) : null
	};
}

/**
 * Registra un error (best-effort). Nunca lanza. Acepta un cliente inyectado
 * (los tests usan uno simulado) o el cliente anónimo por defecto.
 */
export async function registrarError(
	e: ErrorParaRegistrar,
	db?: SupabaseClient
): Promise<{ ok: boolean }> {
	const valido = recortar(e);
	try {
		const cliente = db ?? getSupabaseAnon();
		const { error } = await cliente.rpc('registrar_error', {
			p_origen: valido.origen,
			p_tipo: valido.tipo,
			p_mensaje: valido.mensaje,
			p_ruta: valido.ruta
		});
		if (error) return { ok: false };
		return { ok: true };
	} catch {
		return { ok: false };
	}
}
