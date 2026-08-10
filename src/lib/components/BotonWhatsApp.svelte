<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { urlWhatsApp } from '$lib/types';

	/**
	 * Botón «Contactar por WhatsApp» (Fase 19). Único punto de construcción
	 * del link wa.me para admin y domiciliario: se parametriza solo la
	 * plantilla del mensaje (mensajeWhatsAppAdmin / mensajeWhatsAppDomiciliario).
	 * No se pinta si el pedido no tiene teléfono.
	 */
	let {
		telefono,
		mensaje,
		label = 'Contactar por WhatsApp',
		class: clase = ''
	}: {
		telefono: string | null;
		/** Texto completo del mensaje (la plantilla la arma el llamador por rol). */
		mensaje: string;
		label?: string;
		class?: string;
	} = $props();

	const url = $derived(urlWhatsApp(telefono, mensaje));
</script>

{#if url}
	<a
		href={url}
		target="_blank"
		rel="noopener noreferrer"
		class="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3.5 py-2 text-xs font-semibold text-green-700 transition hover:border-green-400 hover:bg-green-100 {clase}"
	>
		<Icon name="comment-sms" class="size-3.5" />
		{label}
	</a>
{/if}
