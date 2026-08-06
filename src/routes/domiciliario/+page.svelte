<script lang="ts">
	import { page } from '$app/state';
	import { api } from '$lib/api';
	import Icon from '$lib/components/Icon.svelte';
	import BadgeEstado from '$lib/components/BadgeEstado.svelte';
	import { hidratarSesionRealtime } from '$lib/supabase-browser';
	import { debounce, suscribirCambios, type RealtimeEstado } from '$lib/realtime';
	import IndicadorRealtime from '$lib/components/IndicadorRealtime.svelte';
	import {
		ESTADOS_ACTIVOS_DOMICILIARIO,
		ESTADOS_FINALES,
		accionDomiciliario,
		etiquetaEstado,
		formatearPeso,
		type HistorialEstado,
		type Pedido
	} from '$lib/types';

	interface PedidoFila extends Pedido {
		barrio_origen_nombre: string | null;
		barrio_destino_nombre: string | null;
		historial: HistorialEstado[];
	}

	let pedidos = $state<PedidoFila[]>([]);
	let cargando = $state(true);
	let error = $state<string | null>(null);
	let mensaje = $state<{ tipo: 'ok' | 'err'; texto: string } | null>(null);
	let pestana = $state<'activos' | 'completadas'>('activos');
	let guardando = $state<Record<string, boolean>>({});
	let notas = $state<Record<string, string>>({});
	let estadoRealtime = $state<RealtimeEstado>('conectando');

	const activos = $derived(
		pedidos
			.filter((p) => ESTADOS_ACTIVOS_DOMICILIARIO.includes(p.estado))
			.sort((a, b) => a.created_at.localeCompare(b.created_at))
	);
	const completados = $derived(pedidos.filter((p) => ESTADOS_FINALES.includes(p.estado)));

	function formatearFecha(iso: string): string {
		return new Date(iso).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function urlNavegacion(p: PedidoFila): string {
		const destino = `${p.direccion_destino}, ${p.barrio_destino_nombre ?? ''}, Armenia, Quindío`.trim();
		return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destino)}`;
	}

	async function cargar() {
		cargando = true;
		error = null;
		const r = await api.get<PedidoFila[]>('/api/pedidos');
		cargando = false;
		if (r.error) {
			error = r.error;
			return;
		}
		pedidos = r.data ?? [];
	}

	const cargarDebounced = debounce(() => cargar(), 250);

	async function avanzar(p: PedidoFila) {
		const accion = accionDomiciliario(p.estado);
		if (!accion) return;
		const esFinal = accion.estado === 'entregado';
		if (esFinal && !window.confirm(`¿Confirmas que el pedido ${p.numero} fue entregado?`)) return;

		guardando[p.id] = true;
		guardando = { ...guardando };
		mensaje = null;
		const r = await api.post(`/api/pedidos/${p.id}/estado`, {
			estado: accion.estado,
			notas: notas[p.id]?.trim() || undefined
		});
		guardando[p.id] = false;
		guardando = { ...guardando };
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		notas[p.id] = '';
		notas = { ...notas };
		mensaje = { tipo: 'ok', texto: `Pedido ${p.numero}: ${accion.etiqueta.toLowerCase()}.` };
		await cargar();
	}

	$effect(() => {
		let activo = true;
		let limpiar: (() => void) | undefined;
		hidratarSesionRealtime().then(() => {
			if (!activo) return;
			// El domiciliario solo recibe cambios de sus propios pedidos
			// (RLS + filtro por domiciliario_id en el canal).
			const domId = page.data.domiciliarioId;
			limpiar = domId
				? suscribirCambios({
						tabla: 'pedidos',
						filtro: { domiciliario_id: domId },
						onCambio: () => cargarDebounced(),
						onEstado: (estado) => {
							estadoRealtime = estado;
							if (estado === 'conectado') cargarDebounced();
						}
					})
				: undefined;
		});
		cargar();
		// Red de seguridad: refresco periódico por si un evento se pierde
		// (p. ej. cancelación con domiciliario_id nulo o cambios de red).
		const reloj = setInterval(() => cargar(), 60000);
		return () => {
			activo = false;
			clearInterval(reloj);
			limpiar?.();
		};
	});
</script>

<svelte:head>
	<title>Mis entregas — StarGo</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-2xl font-extrabold tracking-tight text-slate-900">Mis entregas</h1>
		<p class="mt-1 text-sm text-slate-500">
			Recibes las asignaciones al instante. Avanza el pedido con cada paso y abre la navegación al destino.
		</p>
	</div>
	<IndicadorRealtime estado={estadoRealtime} />
</header>

{#if mensaje}
	<div
		class="mb-5 rounded-xl border px-4 py-3 text-sm {mensaje.tipo === 'ok'
			? 'border-primary/30 bg-primary-light text-primary-dark'
			: 'border-red-200 bg-red-50 text-red-700'}"
	>
		{mensaje.texto}
	</div>
{/if}

<div class="mb-5 flex gap-1.5">
	<button
		type="button"
		onclick={() => (pestana = 'activos')}
		class="rounded-lg px-3.5 py-2 text-sm font-semibold transition {pestana === 'activos'
			? 'bg-primary text-white shadow-sm'
			: 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}"
	>
		En curso
		<span class="ml-1.5 rounded-full px-1.5 text-xs {pestana === 'activos' ? 'bg-white/20' : 'bg-slate-100'}">
			{activos.length}
		</span>
	</button>
	<button
		type="button"
		onclick={() => (pestana = 'completadas')}
		class="rounded-lg px-3.5 py-2 text-sm font-semibold transition {pestana === 'completadas'
			? 'bg-primary text-white shadow-sm'
			: 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}"
	>
		Completadas
		<span class="ml-1.5 rounded-full px-1.5 text-xs {pestana === 'completadas' ? 'bg-white/20' : 'bg-slate-100'}">
			{completados.length}
		</span>
	</button>
</div>

{#if cargando && pedidos.length === 0}
	<div class="flex items-center justify-center gap-3 py-20 text-slate-500">
		<span class="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
		Cargando tus pedidos…
	</div>
{:else if error}
	<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">No se pudieron cargar los pedidos: {error}</div>
{:else if pestana === 'activos' && activos.length === 0}
	<div class="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 p-14 text-center">
		<div class="mx-auto flex size-14 items-center justify-center rounded-full bg-primary-light text-[#8BB4FF]">
			<Icon name="truck" class="size-7" />
		</div>
		<p class="mt-4 font-semibold text-slate-700">No tienes entregas en curso</p>
		<p class="mt-1 text-sm text-slate-400">Cuando el administrador te asigne un pedido, aparecerá aquí automáticamente.</p>
	</div>
{:else if pestana === 'activos'}
	<div class="space-y-5">
		{#each activos as p (p.id)}
			{@const accion = accionDomiciliario(p.estado)}
			<div class="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
				<div class="flex flex-wrap items-center gap-3 border-b border-slate-100 p-5">
					<div>
						<p class="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">Pedido</p>
						<p class="font-mono text-xl font-black tracking-widest text-slate-900">{p.numero}</p>
					</div>
					<BadgeEstado estado={p.estado} size="md" class="ml-auto" />
					<div class="w-full sm:w-auto sm:text-right">
						<p class="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">Tarifa</p>
						<p class="text-lg font-extrabold text-primary-dark">{formatearPeso(p.tarifa_base)}</p>
					</div>
				</div>

				<div class="grid gap-4 p-5 sm:grid-cols-2">
					<div class="rounded-xl bg-slate-50 p-4">
						<p class="text-xs font-semibold text-slate-400 uppercase">Recoger en</p>
						<p class="mt-1 font-medium text-slate-900">{p.barrio_origen_nombre ?? '—'}</p>
						<p class="text-sm text-slate-600">{p.direccion_origen}</p>
					</div>
					<div class="rounded-xl bg-slate-50 p-4">
						<p class="text-xs font-semibold text-slate-400 uppercase">Entregar en</p>
						<p class="mt-1 font-medium text-slate-900">{p.barrio_destino_nombre ?? '—'}</p>
						<p class="text-sm text-slate-600">{p.direccion_destino}</p>
					</div>
				</div>

				{#if p.observaciones}
					<p class="px-5 pb-2 text-sm text-slate-600">
						<span class="font-semibold text-slate-700">Observaciones:</span> {p.observaciones}
					</p>
				{/if}

				<div class="flex flex-wrap items-center gap-2 px-5 py-4">
					{#if accion}
						<input
							type="text"
							bind:value={notas[p.id]}
							placeholder="Nota (opcional)…"
							class="w-full min-w-40 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 transition placeholder:text-slate-400 focus:border-[#8BB4FF] focus:outline-none"
						/>
						<button
							type="button"
							onclick={() => avanzar(p)}
							disabled={guardando[p.id]}
							class="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:opacity-60"
						>
							{guardando[p.id] ? 'Guardando…' : accion.etiqueta}
						</button>
					{/if}
					<a
						href={urlNavegacion(p)}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition hover:border-[#8BB4FF] hover:text-primary-dark"
					>
						<Icon name="location-dot" class="size-3.5" />
						Abrir navegación
					</a>
					<details class="ml-auto">
						<summary class="cursor-pointer text-xs font-medium text-primary-dark hover:underline">
							Historial ({p.historial.length})
						</summary>
						<ul class="mt-2 space-y-1.5 border-l-2 border-slate-200 pl-3">
							{#each p.historial as hito (hito.id)}
								<li class="text-xs text-slate-500">
									<span class="font-semibold text-slate-700">{etiquetaEstado(hito.estado)}</span>
									{hito.notas ? ` · ${hito.notas}` : ''}
									<span class="text-slate-400"> · {formatearFecha(hito.created_at)}</span>
								</li>
							{/each}
						</ul>
					</details>
				</div>
			</div>
		{/each}
	</div>
{:else if completados.length === 0}
	<div class="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 p-14 text-center text-sm text-slate-400">
		Todavía no has completado ninguna entrega.
	</div>
{:else}
	<div class="space-y-3">
		{#each completados as p (p.id)}
			<div class="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
				<p class="font-mono text-base font-black tracking-widest text-slate-900">{p.numero}</p>
				<p class="text-sm text-slate-500">
					{p.barrio_origen_nombre ?? '—'} → {p.barrio_destino_nombre ?? '—'}
				</p>
				<BadgeEstado estado={p.estado} />
				<span class="ml-auto font-bold text-slate-900">{formatearPeso(p.tarifa_base)}</span>
				<span class="text-xs text-slate-400">{formatearFecha(p.created_at)}</span>
			</div>
		{/each}
	</div>
{/if}
