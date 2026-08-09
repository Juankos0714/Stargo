<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { hidratarSesionRealtime } from '$lib/supabase-browser';
	import { suscribirCambios } from '$lib/realtime';
	import { pushSoportado, suscribirPush, estaSuscrito } from '$lib/push';
	import Icon from './Icon.svelte';

	interface Notificacion {
		id: number;
		tipo: 'nuevo_pedido' | 'cambio_estado';
		titulo: string;
		cuerpo: string | null;
		pedido_id: string | null;
		created_at: string;
	}

	interface Props {
		/** A dónde navega al tocar una notificación (p. ej. '/admin/pedidos'). */
		urlBase?: string;
		/** 'claro' (topbar móvil) u 'oscuro' (sidebar). */
		tono?: 'claro' | 'oscuro';
	}
	let { urlBase = '/', tono = 'claro' }: Props = $props();

	let abierto = $state(false);
	let lista = $state<Notificacion[]>([]);
	let cargando = $state(true);
	let marcando = $state(false);
	// Estado de Web Push (opcional): null = no se puede saber aún.
	let pushActivo = $state<boolean | null>(null);
	let activandoPush = $state(false);
	let pushMensaje = $state<string | null>(null);

	function hace(iso: string): string {
		const ms = Date.now() - new Date(iso).getTime();
		const min = Math.floor(ms / 60000);
		if (min < 1) return 'ahora';
		if (min < 60) return `hace ${min} min`;
		const h = Math.floor(min / 60);
		if (h < 24) return `hace ${h} h`;
		return `hace ${Math.floor(h / 24)} d`;
	}

	async function cargar() {
		const r = await api.get<Notificacion[]>('/api/notificaciones');
		cargando = false;
		if (r.error) {
			lista = [];
			return;
		}
		lista = r.data ?? [];
	}

	async function marcarLeidas(ids: number[]) {
		if (ids.length === 0) return;
		await api.put('/api/notificaciones', { ids });
		lista = lista.filter((n) => !ids.includes(n.id));
	}

	async function abrirNotificacion(n: Notificacion) {
		if (!n.id) return;
		await marcarLeidas([n.id]);
		abierto = false;
		goto(urlBase);
	}

	async function marcarTodo() {
		marcando = true;
		await marcarLeidas(lista.map((n) => n.id));
		marcando = false;
	}

	async function activarPush() {
		activandoPush = true;
		pushMensaje = null;
		const r = await suscribirPush();
		activandoPush = false;
		if (r.ok) {
			pushActivo = true;
			pushMensaje = 'Notificaciones activadas.';
		} else {
			pushMensaje = r.error ?? 'No se pudo activar.';
		}
	}

	$effect(() => {
		let activo = true;
		let limpiar: (() => void) | undefined;
		hidratarSesionRealtime().then(() => {
			if (!activo) return;
			limpiar = suscribirCambios({
				tabla: 'notificaciones',
				onCambio: () => cargar()
			});
		});
		cargar();
		estaSuscrito().then((s) => {
			if (activo) pushActivo = s;
		});
		return () => {
			activo = false;
			limpiar?.();
		};
	});
</script>

<div class="relative">
	<button
		type="button"
		aria-label="Notificaciones"
		aria-expanded={abierto}
		onclick={() => {
			abierto = !abierto;
			if (abierto) cargar();
		}}
		class="relative flex size-9 items-center justify-center rounded-lg transition {tono === 'oscuro'
			? 'text-slate-300 hover:bg-white/10 hover:text-white'
			: 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}"
	>
		<Icon name="bell" class="size-4.5" />
		{#if lista.length > 0}
			<span
				class="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
			>
				{lista.length > 9 ? '9+' : lista.length}
			</span>
		{/if}
	</button>

	{#if abierto}
		<!-- Backdrop para cerrar al hacer clic fuera -->
		<div class="fixed inset-0 z-30" role="presentation" onclick={() => (abierto = false)}></div>

		<div class="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
			<div class="flex items-center justify-between border-b border-slate-100 px-4 py-3">
				<p class="text-xs font-bold tracking-wide text-slate-500 uppercase">Notificaciones</p>
				{#if lista.length > 0}
					<button
						type="button"
						onclick={marcarTodo}
						disabled={marcando}
						class="text-xs font-semibold text-primary-dark transition hover:underline disabled:opacity-50"
					>
						{marcando ? 'Marcando…' : 'Marcar todo leído'}
					</button>
				{/if}
			</div>

			{#if cargando}
				<div class="flex items-center justify-center gap-2 px-4 py-8 text-xs text-slate-400">
					<span class="size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
					Cargando…
				</div>
			{:else if lista.length === 0}
				<p class="px-4 py-8 text-center text-xs text-slate-400">No tienes notificaciones nuevas.</p>
			{:else}
				<ul class="max-h-72 divide-y divide-slate-100 overflow-y-auto">
					{#each lista as n (n.id)}
						<li>
							<button
								type="button"
								onclick={() => abrirNotificacion(n)}
								class="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
							>
								<span
									class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full {n.tipo === 'nuevo_pedido'
										? 'bg-primary-light text-primary'
										: 'bg-emerald-50 text-emerald-600'}"
								>
									<Icon name={n.tipo === 'nuevo_pedido' ? 'clipboard-list' : 'circle-check'} class="size-3.5" />
								</span>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm font-semibold text-slate-900">{n.titulo}</span>
									{#if n.cuerpo}
										<span class="mt-0.5 block line-clamp-2 text-xs text-slate-500">{n.cuerpo}</span>
									{/if}
									<span class="mt-0.5 block text-[10px] text-slate-400">{hace(n.created_at)}</span>
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			{#if pushSoportado()}
				<div class="border-t border-slate-100 bg-slate-50 px-4 py-3">
					{#if pushActivo === false}
						<button
							type="button"
							onclick={activarPush}
							disabled={activandoPush}
							class="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white transition hover:bg-primary-dark disabled:opacity-60"
						>
							<Icon name="bell" class="size-3.5" />
							{activandoPush ? 'Activando…' : 'Activar notificaciones push'}
						</button>
					{:else if pushActivo === true}
						<p class="text-center text-xs text-emerald-700">🔔 Notificaciones push activadas.</p>
					{/if}
					{#if pushMensaje && pushActivo !== true}
						<p class="mt-1.5 text-center text-[10px] text-slate-500">{pushMensaje}</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
