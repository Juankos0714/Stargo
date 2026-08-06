<script lang="ts">
	import { colorEstado, etiquetaEstado, type EstadoPedido } from '$lib/types';

	/**
	 * Badge de estado de pedido: color y texto canónicos para los 7 estados.
	 * Extraído en la Parte 4 (pruebas de componentes) como punto único de
	 * verdad, reemplazando los spans repetidos en los paneles.
	 */
	const TAMANOS = {
		xs: 'px-2 py-0.5 text-[10px]',
		sm: 'px-2.5 py-0.5 text-xs',
		md: 'px-2.5 py-1 text-xs',
		lg: 'px-3 py-1 text-sm'
	} as const;

	let {
		estado,
		size = 'sm',
		class: clase = '',
		testid
	}: {
		estado: EstadoPedido;
		size?: keyof typeof TAMANOS;
		class?: string;
		/** id para los selectores de los tests E2E (data-testid). */
		testid?: string;
	} = $props();
</script>

<span data-testid={testid} class="inline-flex rounded-full border font-semibold {clase} {TAMANOS[size]} {colorEstado(estado)}">
	{etiquetaEstado(estado)}
</span>
