<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	// Sin matchMedia (SSR o jsdom) el escritorio es el render por defecto:
	// así las pruebas de componentes ven la tabla y el HTML inicial la incluye.
	let activo = $state(
		typeof window === 'undefined' ||
			typeof window.matchMedia !== 'function' ||
			window.matchMedia('(min-width: 768px)').matches
	);

	$effect(() => {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
		const mq = window.matchMedia('(min-width: 768px)');
		const actualizar = () => (activo = mq.matches);
		actualizar();
		mq.addEventListener('change', actualizar);
		return () => mq.removeEventListener('change', actualizar);
	});
</script>

{#if activo}
	{@render children()}
{/if}