<script lang="ts">
	import type { RealtimeEstado } from '$lib/realtime';

	let { estado }: { estado: RealtimeEstado } = $props();
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap
		{estado === 'conectado'
			? 'border-emerald-200 bg-emerald-50 text-emerald-700'
			: estado === 'desconectado'
				? 'border-red-200 bg-red-50 text-red-600'
				: 'border-amber-200 bg-amber-50 text-amber-700'}"
	title={estado === 'desconectado' ? 'Sin conexión: reintentando…' : undefined}
>
	<span
		class="size-1.5 rounded-full
			{estado === 'conectado'
				? 'bg-emerald-500'
				: estado === 'desconectado'
					? 'animate-pulse bg-red-500'
					: 'animate-pulse bg-amber-500'}"
	></span>
	{#if estado === 'conectado'}
		En vivo
	{:else if estado === 'desconectado'}
		Reconectando…
	{:else}
		Conectando…
	{/if}
</span>
