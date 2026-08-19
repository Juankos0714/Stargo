<script lang="ts">
	/**
	 * Icono reutilizable basado en MorphIcon + Lucide.
	 * Acepta un objeto IconInput de Lucide (array [tag, attrs]) o un string d.
	 *
	 * Ejemplo:
	 *   <Icon icon={Menu} class="size-4" />
	 */
	import { MorphIcon } from 'morphicons-svelte';
	import type { IconInput } from 'morphicons';

	let {
		icon,
		strokeWidth,
		color,
		label,
		class: clase = ''
	}: {
		icon: IconInput;
		strokeWidth?: number | string;
		color?: string;
		label?: string;
		class?: string;
	} = $props();
</script>

<MorphIcon {icon} {strokeWidth} {color} {label} class={clase} />
