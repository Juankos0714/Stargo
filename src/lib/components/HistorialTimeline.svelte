<script lang="ts">
	import { etiquetaEstado, type EstadoPedido, type HistorialEstado } from '$lib/types';
	import { formatearFecha } from '$lib/logic/formato';

	/**
	 * Línea de tiempo del historial de estados de un pedido (consulta del
	 * cliente). Extraída en la Parte 4 para poder testearla de forma aislada.
	 */
	let { historial }: { historial: HistorialEstado[] } = $props();
</script>

<ol class="mt-4 space-y-0">
	{#each historial as hito, i (hito.id ?? i)}
		<li class="relative flex gap-4 pb-6 last:pb-0">
			{#if i < historial.length - 1}
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
