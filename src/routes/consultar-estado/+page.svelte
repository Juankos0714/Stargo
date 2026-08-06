<script lang="ts">
	import { api } from '$lib/api';
	import Logo from '$lib/components/Logo.svelte';
	import { debounce, suscribirCambios, type RealtimeEstado } from '$lib/realtime';
	import IndicadorRealtime from '$lib/components/IndicadorRealtime.svelte';
	import {
		colorEstado,
		etiquetaEstado,
		formatearPeso,
		type PedidoConsultado,
		type EstadoPedido
	} from '$lib/types';
	import { page } from '$app/state';

	let numero = $state('');
	let buscando = $state(false);
	let error = $state<string | null>(null);
	let resultado = $state<PedidoConsultado | null>(null);
	let consultado = $state(false);
	let estadoRealtime = $state<RealtimeEstado>('conectando');
	let canalActivo = $state<(() => void) | null>(null);

	function formatearFecha(iso: string): string {
		return new Date(iso).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	const consultarDebounced = debounce((codigo: string) => consultar(codigo, true), 300);

	/**
	 * Se suscribe a los eventos públicos del pedido (pedido_eventos): al
	 * recibir un cambio de estado, se re-consulta para refrescar el panel
	 * en vivo sin recargar. Realtime se reconecta solo.
	 */
	function suscribirEventos(codigo: string) {
		canalActivo?.();
		canalActivo = null;
		if (!codigo) return;
		canalActivo = suscribirCambios({
			tabla: 'pedido_eventos',
			filtro: { numero: codigo },
			onCambio: () => consultarDebounced(codigo),
			onEstado: (estado) => (estadoRealtime = estado)
		});
	}

	async function consultar(n?: string, silencioso = false) {
		const codigo = (n ?? numero).trim().toUpperCase();
		if (!codigo) return;
		numero = codigo;
		if (!silencioso) {
			buscando = true;
			error = null;
			resultado = null;
			consultado = false;
		}
		const r = await api.get<PedidoConsultado>(`/api/pedidos/consultar?numero=${encodeURIComponent(codigo)}`);
		if (!silencioso) buscando = false;
		if (r.error) {
			if (!silencioso) {
				error = r.error;
				consultado = true;
			}
			return;
		}
		resultado = r.data;
		consultado = true;
		error = null;
		suscribirEventos(codigo);
	}

	$effect(() => {
		const inicial = String(page.url.searchParams.get('numero') ?? '');
		if (inicial && !consultado) {
			numero = inicial.trim().toUpperCase();
			consultar(inicial);
		}
	});

	$effect(() => {
		// Cancelar el canal al desmontar la página.
		return () => {
			canalActivo?.();
		};
	});
</script>

<svelte:head>
	<title>Consultar estado — StarGo</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-b from-slate-50 via-primary-light/40 to-slate-50">
	<header class="border-b border-slate-200/70 bg-white/80 backdrop-blur">
		<div class="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
			<a href="/" class="flex items-center">
				<Logo type="full" surface="light" height={32} priority />
			</a>
			<a href="/nuevo-pedido" class="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-primary-light hover:text-primary">Hacer un pedido →</a>
		</div>
	</header>

	<main class="mx-auto max-w-2xl px-6 py-12">
		<div class="flex items-start justify-center gap-3 text-center">
			<div>
				<h1 class="text-3xl font-extrabold tracking-tight text-slate-900">Consultar estado</h1>
				<p class="mt-2 text-slate-500">Ingresa el código que recibiste al confirmar tu pedido.</p>
			</div>
			{#if canalActivo}
				<div class="mt-1.5">
					<IndicadorRealtime estado={estadoRealtime} />
				</div>
			{/if}
		</div>

		<form
			onsubmit={(e) => {
				e.preventDefault();
				consultar();
			}}
			class="mx-auto mt-8 flex max-w-md gap-2"
		>
			<input
				type="text"
				bind:value={numero}
				placeholder="Código del pedido (ej: K7F2XM)"
				autocomplete="off"
				class="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-lg uppercase tracking-widest text-slate-900 shadow-sm transition placeholder:font-sans placeholder:text-sm placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
			/>
			<button
				type="submit"
				disabled={buscando || !numero.trim()}
				class="shrink-0 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
			>
				{buscando ? 'Buscando…' : 'Buscar'}
			</button>
		</form>

		<div class="mt-8">
			{#if buscando}
				<div class="flex items-center justify-center gap-3 py-16 text-slate-500">
					<span class="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
					Consultando…
				</div>
			{:else if error && consultado}
				<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-700">{error}</div>
			{:else if resultado}
				<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-900/5 sm:p-8">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div>
							<p class="text-xs font-semibold tracking-wide text-slate-400 uppercase">Pedido</p>
							<p class="font-mono text-2xl font-black tracking-widest text-slate-900">{resultado.pedido.numero}</p>
						</div>
						<span class="inline-flex rounded-full border px-3 py-1 text-sm font-semibold {colorEstado(resultado.pedido.estado as EstadoPedido)}">
							{etiquetaEstado(resultado.pedido.estado as EstadoPedido)}
						</span>
					</div>

					<div class="mt-6 grid gap-4 sm:grid-cols-2">
						<div class="rounded-xl bg-slate-50 p-4">
							<p class="text-xs font-semibold text-slate-400 uppercase">Origen</p>
							<p class="mt-1 font-medium text-slate-900">{resultado.pedido.barrio_origen_nombre ?? '—'}</p>
							<p class="text-sm text-slate-500">{resultado.pedido.direccion_origen}</p>
						</div>
						<div class="rounded-xl bg-slate-50 p-4">
							<p class="text-xs font-semibold text-slate-400 uppercase">Destino</p>
							<p class="mt-1 font-medium text-slate-900">{resultado.pedido.barrio_destino_nombre ?? '—'}</p>
							<p class="text-sm text-slate-500">{resultado.pedido.direccion_destino}</p>
						</div>
					</div>

					{#if resultado.pedido.observaciones}
						<p class="mt-4 text-sm text-slate-600">
							<span class="font-semibold text-slate-700">Observaciones:</span> {resultado.pedido.observaciones}
						</p>
					{/if}

					<div class="mt-6 flex items-center justify-between rounded-xl border border-primary/30 bg-primary-light/60 px-4 py-3">
						<span class="text-sm font-semibold text-slate-600">Tarifa</span>
						<span class="text-xl font-extrabold text-primary-dark">{formatearPeso(resultado.pedido.tarifa_base)}</span>
					</div>

					<h2 class="mt-7 text-sm font-bold tracking-wide text-slate-500 uppercase">Historial del pedido</h2>
					<ol class="mt-4 space-y-0">
						{#each resultado.historial as hito, i (hito.id ?? i)}
							<li class="relative flex gap-4 pb-6 last:pb-0">
								{#if i < resultado.historial.length - 1}
									<span class="absolute top-5 left-[9px] h-full w-0.5 bg-slate-200"></span>
								{/if}
								<span class="mt-1 size-5 shrink-0 rounded-full border-2 border-primary bg-white"></span>
								<div>
									<p class="text-sm font-semibold text-slate-900">{etiquetaEstado(hito.estado as EstadoPedido)}</p>
									{#if hito.notas}
										<p class="text-xs text-slate-500">{hito.notas}</p>
									{/if}
									<p class="mt-0.5 text-xs text-slate-400">{formatearFecha(hito.created_at)}</p>
								</div>
							</li>
						{/each}
					</ol>
				</div>
			{:else}
				<p class="py-16 text-center text-sm text-slate-400">
					Tu pedido y su historial de estados aparecerán aquí.
				</p>
			{/if}
		</div>
	</main>
</div>
