<script lang="ts">
	let {
		pagina,
		totalPaginas,
		onCambio,
		resumen
	}: {
		/** Página actual, 0-based. */
		pagina: number;
		totalPaginas: number;
		onCambio: (pagina: number) => void;
		/** Texto tipo «Mostrando 1–50 de 400». */
		resumen?: string;
	} = $props();

	/** Páginas numeradas para escritorio, con elipsis cuando hay muchas. */
	const numeros = $derived.by(() => {
		if (totalPaginas <= 7) return Array.from({ length: totalPaginas }, (_, i) => i);
		const vecinos = [pagina - 1, pagina, pagina + 1].filter((n) => n > 0 && n < totalPaginas - 1);
		const conjunto = [...new Set([0, ...vecinos, totalPaginas - 1])].sort((a, b) => a - b);
		const resultado: (number | '…')[] = [];
		let previo: number | null = null;
		for (const n of conjunto) {
			if (previo !== null && n - previo > 1) resultado.push('…');
			resultado.push(n);
			previo = n;
		}
		return resultado;
	});

	const claseBoton =
		'flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-xs font-medium transition disabled:opacity-40';
</script>

<div class="flex flex-col gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
	{#if resumen}
		<p class="text-xs text-slate-500">{resumen}</p>
	{/if}

	<!-- Móvil: compacto, sin desbordar el viewport -->
	<div class="flex items-center justify-between gap-2 sm:hidden">
		<button
			type="button"
			class="{claseBoton} border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
			onclick={() => onCambio(Math.max(0, pagina - 1))}
			disabled={pagina === 0}
			aria-label="Página anterior"
		>
			←
		</button>
		<span class="text-xs font-medium text-slate-600">
			Página {pagina + 1} de {totalPaginas}
		</span>
		<button
			type="button"
			class="{claseBoton} border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
			onclick={() => onCambio(Math.min(totalPaginas - 1, pagina + 1))}
			disabled={pagina >= totalPaginas - 1}
			aria-label="Página siguiente"
		>
			→
		</button>
	</div>

	<!-- Escritorio: numerado -->
	<div class="hidden items-center gap-1.5 sm:flex">
		<button
			type="button"
			class="{claseBoton} border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
			onclick={() => onCambio(Math.max(0, pagina - 1))}
			disabled={pagina === 0}
		>
			← Anterior
		</button>
		{#each numeros as n, i (i)}
			{#if n === '…'}
				<span class="px-1 text-xs text-slate-400">…</span>
			{:else}
				<button
					type="button"
					class="{claseBoton} {n === pagina
						? 'border-primary bg-primary font-bold text-white'
						: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}"
					onclick={() => onCambio(n)}
					aria-label={`Página ${n + 1}`}
					aria-current={n === pagina ? 'page' : undefined}
				>
					{n + 1}
				</button>
			{/if}
		{/each}
		<button
			type="button"
			class="{claseBoton} border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
			onclick={() => onCambio(Math.min(totalPaginas - 1, pagina + 1))}
			disabled={pagina >= totalPaginas - 1}
		>
			Siguiente →
		</button>
	</div>
</div>