<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children, class: clase = '' }: { children: Snippet; class?: string } = $props();
</script>

<div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm {clase}">
	{@render children()}
</div>