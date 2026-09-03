<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		etiqueta,
		children,
		class: clase = ''
	}: {
		etiqueta: string;
		children: Snippet;
		class?: string;
	} = $props();
</script>

<div class={clase}>
	<p class="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">{etiqueta}</p>
	<div class="mt-0.5 text-sm text-slate-800">{@render children()}</div>
</div>