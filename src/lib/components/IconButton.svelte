<script lang="ts">
	/**
	 * Botón reutilizable que envuelve un ícono.
	 * Se usa para botones de menú, acciones, etc.
	 *
	 * Ejemplo:
	 *   <IconButton onclick={() => open = !open} label="Abrir menú">
	 *     <Icon icon={Menu} class="size-4.5" />
	 *   </IconButton>
	 */
	import type { Snippet } from 'svelte';

	let {
		onclick,
		label = 'Botón',
		children,
		class: clase = '',
		...rest
	}: {
		onclick?: (e: MouseEvent) => void;
		label?: string;
		children: Snippet;
		class?: string;
		[key: string]: unknown;
	} = $props();
</script>

<button type="button" {onclick} aria-label={label} class={clase} {...rest}>
	{@render children()}
</button>
