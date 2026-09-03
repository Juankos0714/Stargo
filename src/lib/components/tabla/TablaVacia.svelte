<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { IconInput } from 'morphicons';
	import Icon from '$lib/components/Icon.svelte';

	let {
		icono,
		titulo,
		descripcion,
		children
	}: {
		icono?: IconInput;
		titulo: string;
		descripcion?: string;
		children?: Snippet;
	} = $props();
</script>

<div class="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
	{#if icono}
		<span class="flex size-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
			<Icon icon={icono} class="size-5" />
		</span>
	{/if}
	<p class="text-sm font-semibold text-slate-700">{titulo}</p>
	{#if descripcion}
		<p class="max-w-sm text-xs leading-relaxed text-slate-400">{descripcion}</p>
	{/if}
	{#if children}
		<div class="mt-1">{@render children()}</div>
	{/if}
</div>