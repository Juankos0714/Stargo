<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	// Se evalúa en el cuerpo (antes del primer render) para no parpadear:
	// SSR y jsdom (sin matchMedia) devuelven false, así el escritorio es el
	// render por defecto y las pruebas de componentes ven la tabla.
	let activo = $state(
		typeof window !== 'undefined' &&
			typeof window.matchMedia === 'function' &&
			window.matchMedia('(max-width: 767px)').matches
	);

	$effect(() => {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
		const mq = window.matchMedia('(max-width: 767px)');
		const actualizar = () => (activo = mq.matches);
		actualizar();
		mq.addEventListener('change', actualizar);
		return () => mq.removeEventListener('change', actualizar);
	});
</script>

{#if activo}
	{@render children()}
{/if}