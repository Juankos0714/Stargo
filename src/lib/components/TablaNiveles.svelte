<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { Receipt } from 'lucide';
	import { formatearPeso, vistaCompactaNiveles, type NivelConRango } from '$lib/types';

	interface Props {
		/** Niveles de la escalera con su rango calculado (rangoDeNiveles). */
		niveles: NivelConRango[];
		/**
		 * Nivel a resaltar (p. ej. el que alcanza el total del día del
		 * domiciliario). null desactiva el resaltado y el badge.
		 */
		nivelDestacado?: number | null;
		/** Etiqueta del nivel destacado en el badge y en la fila resaltada. */
		etiquetaDestacado?: string;
		/** Título de la sección (se muestra junto al conteo de niveles). */
		titulo?: string;
		/** Nota al pie de la tabla. */
		notaPie?: string;
	}

	let {
		niveles,
		nivelDestacado = null,
		etiquetaDestacado = 'hoy',
		titulo = 'Comisión por nivel según el total del día',
		notaPie = 'La comisión del día se calcula según el total acumulado de las entregas: se cobra el valor de cada nivel que cruza el total del día.'
	}: Props = $props();

	/** Vista compacta: si es false se muestran los primeros 5 y los últimos 3 niveles. */
	let verNivelesCompletos = $state(false);

	/** Niveles a mostrar (primera parte, resto y cuántos quedan ocultos). */
	const vista = $derived.by(() => vistaCompactaNiveles(niveles, verNivelesCompletos));

	/** Resumen de comisiones vigentes (valor único o rango) para el encabezado compacto. */
	const resumenComision = $derived.by(() => {
		const valores = [...new Set(niveles.map((n) => n.valor))].sort((a, b) => a - b);
		if (valores.length === 0) return '';
		if (valores.length === 1) return formatearPeso(valores[0]);
		return `${formatearPeso(valores[0])} – ${formatearPeso(valores[valores.length - 1])}`;
	});

	/** El nivel destacado existe en la escalera (evita mensajes engañosos si llega un dato inválido). */
	const destacadoValido = $derived(nivelDestacado !== null && niveles.some((n) => n.nivel === nivelDestacado));

	/** Si el nivel destacado quedó oculto en la vista compacta (intermedios), su número. */
	const nivelOcultoDestacado = $derived(
		!verNivelesCompletos &&
			destacadoValido &&
			!vista.primeros.some((n) => n.nivel === nivelDestacado) &&
			!vista.resto.some((n) => n.nivel === nivelDestacado)
			? nivelDestacado
			: null
	);

	/** Texto del botón que alterna la vista compacta/completa. */
	const textoControl = $derived.by(() => {
		if (verNivelesCompletos) return 'Mostrar solo el inicio y el final de la tabla…';
		if (nivelOcultoDestacado !== null) {
			return vista.ocultos === 1
				? `Ver el nivel intermedio (${etiquetaDestacado}: nivel ${nivelOcultoDestacado})…`
				: `Ver los ${vista.ocultos} niveles intermedios (${etiquetaDestacado}: nivel ${nivelOcultoDestacado})…`;
		}
		return vista.ocultos === 1
			? 'Ver 1 nivel intermedio…'
			: `Ver los ${vista.ocultos} niveles intermedios…`;
	});
</script>

{#if niveles.length > 0}
	<details class="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
		<summary
			class="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-primary-dark hover:underline"
		>
			<Icon icon={Receipt} class="size-3.5 shrink-0" />
			<span>{titulo} ({niveles.length} niveles)</span>
			{#if destacadoValido}
				<span
					class="ml-auto whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700"
				>
					{etiquetaDestacado}: nivel {nivelDestacado}
				</span>
			{/if}
			{#if resumenComision}
				<span
					class="ml-auto whitespace-nowrap rounded-full bg-primary-light px-2 py-0.5 text-[10px] font-bold text-primary"
				>
					comisión {resumenComision}
				</span>
			{/if}
		</summary>
		<ul class="mt-2 divide-y divide-slate-100 border-t border-slate-100">
			{#each vista.primeros as n, i (n.id)}
				<li
					class="flex flex-wrap items-center gap-x-2 py-2 text-xs text-slate-600 {n.nivel ===
					nivelDestacado
						? '-mx-3 rounded-lg bg-primary-light/50 px-3'
						: ''}"
				>
					<span
						class="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-light text-[10px] font-bold text-primary"
					>
						{n.nivel}
					</span>
					<span class="font-medium text-slate-800">
						{i === 0
							? `Pedidos hasta ${formatearPeso(n.hasta)}`
							: `Pedidos de ${formatearPeso(n.desde)} a ${formatearPeso(n.hasta)}`}
					</span>
					<span class="ml-auto font-bold text-slate-900">comisión {formatearPeso(n.valor)}</span>
					{#if n.nivel === nivelDestacado}
						<span class="rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold text-white">
							{etiquetaDestacado}
						</span>
					{/if}
				</li>
			{/each}
			{#if vista.mostrarControl}
				<li class="py-1">
					<button
						type="button"
						onclick={() => (verNivelesCompletos = !verNivelesCompletos)}
						class="w-full rounded-lg border border-dashed border-slate-200 px-3 py-1.5 text-[11px] font-semibold transition hover:border-primary {verNivelesCompletos
							? 'text-slate-500 hover:bg-slate-50'
							: 'text-primary-dark hover:bg-primary-light/40'}"
					>
						{textoControl}
					</button>
				</li>
			{/if}
			{#each vista.resto as n, i (n.id)}
				<li
					class="flex flex-wrap items-center gap-x-2 py-2 text-xs text-slate-600 {n.nivel ===
					nivelDestacado
						? '-mx-3 rounded-lg bg-primary-light/50 px-3'
						: ''}"
				>
					<span
						class="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-light text-[10px] font-bold text-primary"
					>
						{n.nivel}
					</span>
					<span class="font-medium text-slate-800">
						{`Pedidos de ${formatearPeso(n.desde)} a ${formatearPeso(n.hasta)}`}
					</span>
					<span class="ml-auto font-bold text-slate-900">comisión {formatearPeso(n.valor)}</span>
					{#if n.nivel === nivelDestacado}
						<span class="rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold text-white">
							{etiquetaDestacado}
						</span>
					{/if}
				</li>
			{/each}
		</ul>
		{#if notaPie}
			<p class="mt-2 text-[11px] text-slate-400">{notaPie}</p>
		{/if}
	</details>
{/if}
