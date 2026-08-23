import { supabaseBrowser } from '$lib/supabase-browser';
import { esCapacitor } from '$lib/capacitor-auth';
import { apiFetch } from '$lib/api';

export type RealtimeEstado = 'conectando' | 'conectado' | 'desconectado';
export interface SuscripcionCambios {
	tabla:
		| 'pedidos'
		| 'pedido_eventos'
		| 'domiciliarios'
		| 'pagos_domiciliarios'
		| 'comision_niveles'
		| 'comision_config'
		| 'horario_operacion'
		| 'horario_excepcion'
		| 'notificaciones';
	evento?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
	filtro?: Record<string, string>;
	/** Se llama con cada evento de cambio (payload de Realtime). */
	onCambio: (payload: unknown) => void;
	/** Se llama con el estado de la conexión del canal. */
	onEstado?: (estado: RealtimeEstado) => void;
}

function filtrar(filtro: Record<string, string>): string {
	return Object.entries(filtro)
		.map(([col, valor]) => `${col}=eq.${valor}`)
		.join(' and ');
}

/**
 * En Capacitor, los WebSockets de Supabase Realtime no funcionan de forma
 * confiable. Usamos polling HTTP como alternativa: consulta la tabla cada
 * N segundos y dispara onCambio si hay diferencias.
 */
function pollingFallback(opts: SuscripcionCambios): () => void {
	let active = true;
	let timer: ReturnType<typeof setInterval> | undefined;

	// Mapear tabla a endpoint API
	const endpointMap: Record<string, string> = {
		pedidos: '/api/pedidos',
		domiciliarios: '/api/domiciliarios',
		notificaciones: '/api/notificaciones'
	};

	const endpoint = endpointMap[opts.tabla];
	if (!endpoint) {
		// Tabla sin endpoint de polling conocido — marcar como conectado de todos modos
		opts.onEstado?.('conectado');
		return () => {};
	}

	// Marcar como conectado inmediatamente (polling funciona vía REST)
	opts.onEstado?.('conectado');

	let lastData: string | null = null;

	const poll = async () => {
		if (!active) return;
		try {
			const res = await apiFetch(endpoint, { headers: { Accept: 'application/json' } });
			if (!res.ok || !active) return;
			const body = await res.json().catch(() => ({}));
			const current = JSON.stringify(body?.data ?? null);
			if (lastData !== null && current !== lastData) {
				// Detectar INSERT vs UPDATE comparando longitudes
				const prevLen = JSON.parse(lastData)?.length ?? 0;
				const currLen = Array.isArray(body?.data) ? body.data.length : 0;
				const tipo = currLen > prevLen ? 'INSERT' : 'UPDATE';
				opts.onCambio({ eventType: tipo, new: body?.data });
			}
			lastData = current;
		} catch {
			// Silently ignore polling errors
		}
	};

	// Poll every 15 seconds
	timer = setInterval(poll, 15_000);

	return () => {
		active = false;
		if (timer) clearInterval(timer);
	};
}

/**
 * Se suscribe a cambios de una tabla de Supabase. Devuelve una función
 * para cancelar la suscripción.
 *
 * En web usa Supabase Realtime (WebSocket). En Capacitor usa polling HTTP.
 */
export function suscribirCambios(opts: SuscripcionCambios): () => void {
	// En Capacitor, usar polling en vez de WebSocket
	if (esCapacitor()) {
		return pollingFallback(opts);
	}

	// En web, usar Supabase Realtime (WebSocket)
	const canal = supabaseBrowser
		.channel(`cambios-${opts.tabla}-${Math.random().toString(36).slice(2, 8)}`)
		.on(
			'postgres_changes',
			{
				event: opts.evento ?? '*',
				schema: 'public',
				table: opts.tabla,
				filter: opts.filtro && Object.keys(opts.filtro).length > 0 ? filtrar(opts.filtro) : undefined
			},
			(payload) => opts.onCambio(payload)
		)
		.subscribe((status) => {
			if (!opts.onEstado) return;
			if (status === 'SUBSCRIBED') opts.onEstado('conectado');
			else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') opts.onEstado('desconectado');
			else opts.onEstado('conectando');
		});

	return () => {
		supabaseBrowser.removeChannel(canal);
	};
}

/** Retrasa llamadas: útil para refrescar tras ráfagas de eventos. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms = 300) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return (...args: A) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => fn(...args), ms);
	};
}
