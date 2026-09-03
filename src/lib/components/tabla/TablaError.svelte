<script lang="ts">
	import { TriangleAlert, RefreshCw } from 'lucide';
	import Icon from '$lib/components/Icon.svelte';
	import Boton from './Boton.svelte';

	let {
		titulo = 'No se pudieron cargar los datos',
		mensaje,
		onreintentar
	}: {
		titulo?: string;
		mensaje: string;
		onreintentar?: () => void;
	} = $props();
</script>

<div class="flex flex-col items-center gap-3 px-6 py-12 text-center">
	<span class="flex size-11 items-center justify-center rounded-full bg-red-50 text-red-500">
		<Icon icon={TriangleAlert} class="size-5" />
	</span>
	<p class="max-w-md text-sm font-semibold text-slate-700">
		{titulo}{mensaje ? `: ${mensaje}` : ''}
	</p>
	{#if onreintentar}
		<Boton variant="secundario" size="sm" onclick={onreintentar}>
			<Icon icon={RefreshCw} class="size-3.5" />
			Reintentar
		</Boton>
	{/if}
</div>