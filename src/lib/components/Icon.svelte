<script lang="ts">
	/**
	 * Icono SVG estático (Font Awesome solid). Los trazos viven en
	 * iconos-data.ts (generado): se renderiza un <svg> directo sin el runtime
	 * de FontAwesome, lo que elimina ese código del bundle del cliente.
	 * El tamaño lo controlan las utilidades size-* de Tailwind (igual que antes).
	 */
	import { iconos } from './icon-registry';

	let { name, class: clase = '', title }: { name: string; class?: string; title?: string } = $props();

	// Nombres desconocidos caen a circle-info (mismo comportamiento que antes).
	const icono = $derived(iconos[name] ?? iconos['circle-info']);
</script>

{#if icono}
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 {icono.w} {icono.h}"
		class="stargo-icon {clase}"
		role={title ? 'img' : undefined}
		aria-hidden={title ? undefined : 'true'}
		focusable="false"
	>
		{#if title}<title>{title}</title>{/if}
		{#if Array.isArray(icono.d)}
			{#each icono.d as d (d)}
				<path fill="currentColor" d={d} />
			{/each}
		{:else}
			<path fill="currentColor" d={icono.d} />
		{/if}
	</svg>
{/if}
