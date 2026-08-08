import { supabaseBrowser } from '$lib/supabase-browser';

export type RealtimeEstado = 'conectando' | 'conectado' | 'desconectado';	export interface SuscripcionCambios {
	tabla:
		| 'pedidos'
		| 'pedido_eventos'
		| 'domiciliarios'
		| 'pagos_domiciliarios'
		| 'comision_niveles'
		| 'comision_config';
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
 * Se suscribe a cambios de una tabla de Supabase. Devuelve una función
 * para cancelar la suscripción.
 *
 * Realtime se reconecta automáticamente; el callback onEstado permite a
 * la UI mostrar un indicador y re-cargar datos al volver la conexión.
 */
export function suscribirCambios(opts: SuscripcionCambios): () => void {
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
