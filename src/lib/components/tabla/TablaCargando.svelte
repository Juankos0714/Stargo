<script lang="ts">
	let { columnas = 4, filas = 5 }: { columnas?: number; filas?: number } = $props();
</script>

<div class="overflow-x-auto">
	<table class="w-full text-left text-sm" aria-hidden="true">
		<tbody>
			{#each Array(filas) as _, i (i)}
				<tr class="border-b border-slate-100">
					{#each Array(columnas) as _, j (j)}
						<td class="px-4 py-4">
							<div
								class="h-3.5 animate-pulse rounded bg-slate-100"
								style="width: {55 + ((i * 17 + j * 31) % 35)}%"
							></div>
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>