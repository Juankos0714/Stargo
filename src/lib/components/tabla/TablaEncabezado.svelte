<script lang="ts">
	export interface Columna {
		etiqueta: string;
		alineacion?: 'izquierda' | 'derecha' | 'centro';
		/** Clases extra del th (p. ej. «hidden lg:table-cell» para columnas que se restauran en pantallas grandes). */
		clase?: string;
		/** Evita que el texto del encabezado se parta. */
		ahora?: boolean;
	}

	let { columnas }: { columnas: Columna[] } = $props();

	const ALINEACION = {
		izquierda: '',
		derecha: 'text-right',
		centro: 'text-center'
	} as const;
</script>

<thead>
	<tr class="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase">
		{#each columnas as col (col.etiqueta + (col.clase ?? ''))}
			<th class="px-4 py-3 {col.ahora ? 'whitespace-nowrap' : ''} {ALINEACION[col.alineacion ?? 'izquierda']} {col.clase ?? ''}">
				{col.etiqueta}
			</th>
		{/each}
	</tr>
</thead>