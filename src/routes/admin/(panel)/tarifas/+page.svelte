<script lang="ts">
	import { api } from '$lib/api';
	import Icon from '$lib/components/Icon.svelte';
	import { Save, Check } from 'lucide';
	import { ordenarZonas, type Tarifa, type Zona } from '$lib/types';

	let zonas = $state<Zona[]>([]);
	let tarifas = $state<Tarifa[]>([]);
	let cargando = $state(true);
	let error = $state<string | null>(null);
	let mensaje = $state<{ tipo: 'ok' | 'err'; texto: string } | null>(null);

	// Valores crudos de cada celda (o → d), como string para edición.
	let celdas = $state<Record<string, string>>({});
	let guardando = $state<Record<string, boolean>>({});
	let guardadoOk = $state<Record<string, boolean>>({});

	const key = (o: string, d: string) => `${o}|${d}`;

	const origenes = $derived(ordenarZonas(zonas.filter((z) => z.tipo === 'urbana')));
	const destinos = $derived(ordenarZonas(zonas.filter((z) => z.tipo === 'urbana' || z.tipo === 'destino_solo')));

	const mapaTarifas = $derived.by(() => {
		const m = new Map<string, number>();
		for (const t of tarifas) m.set(key(t.zona_origen_id, t.zona_destino_id), t.valor);
		return m;
	});

	const paresDefinidos = $derived(tarifas.length);
	const totalPares = $derived(origenes.length * destinos.length);

	function flash(keyCelda: string) {
		guardadoOk[keyCelda] = true;
		guardadoOk = { ...guardadoOk };
		setTimeout(() => {
			guardadoOk[keyCelda] = false;
			guardadoOk = { ...guardadoOk };
		}, 1600);
	}

	/** Restaura la celda al último valor persistido tras un error de guardado. */
	function revertirCelda(k: string) {
		const previo = mapaTarifas.get(k);
		celdas[k] = previo != null ? String(previo) : '';
		celdas = { ...celdas };
	}

	async function cargar() {
		cargando = true;
		error = null;
		const [rZonas, rTarifas] = await Promise.all([
			api.get<Zona[]>('/api/zonas?select=id,nombre,tipo'),
			api.get<Tarifa[]>('/api/tarifas?select=zona_origen_id,zona_destino_id,valor')
		]);
		cargando = false;
		if (rZonas.error || rTarifas.error) {
			error = rZonas.error ?? rTarifas.error;
			return;
		}
		zonas = rZonas.data ?? [];
		tarifas = rTarifas.data ?? [];

		const celdasNuevas: Record<string, string> = {};
		for (const t of tarifas) {
			celdasNuevas[key(t.zona_origen_id, t.zona_destino_id)] = String(t.valor);
		}
		celdas = celdasNuevas;
	}

	async function guardarCelda(origen: string, destino: string) {
		const k = key(origen, destino);
		const raw = (celdas[k] ?? '').trim();

		if (raw === '') {
			// Sin valor → eliminar la tarifa de este par.
			const existente = mapaTarifas.has(k);
			if (!existente) return;
			guardando[k] = true;
			guardando = { ...guardando };
			mensaje = null;
			const r = await api.del<Tarifa[]>(
				`/api/tarifas?filtro=zona_origen_id=${encodeURIComponent(origen)}&filtro=zona_destino_id=${encodeURIComponent(destino)}`
			);
			guardando[k] = false;
			guardando = { ...guardando };
			if (r.error) {
				mensaje = { tipo: 'err', texto: r.error };
				revertirCelda(k);
				return;
			}
			tarifas = tarifas.filter((t) => !(t.zona_origen_id === origen && t.zona_destino_id === destino));
			flash(k);
			mensaje = { tipo: 'ok', texto: 'Tarifa eliminada.' };
			return;
		}

		const valor = Number(raw);
		if (!Number.isFinite(valor) || valor < 0) {
			mensaje = { tipo: 'err', texto: `Valor inválido en ${origen} → ${destino}.` };
			return;
		}

		guardando[k] = true;
		guardando = { ...guardando };
		mensaje = null;
		const r = await api.post<Tarifa[]>('/api/tarifas', {
			op: 'upsert',
			onConflict: 'zona_origen_id,zona_destino_id',
			filas: [{ zona_origen_id: origen, zona_destino_id: destino, valor }]
		});
		guardando[k] = false;
		guardando = { ...guardando };
		if (r.error) {
			mensaje = { tipo: 'err', texto: `${origen} → ${destino}: ${r.error}` };
			revertirCelda(k);
			return;
		}
		const fila = r.data?.[0];
		if (fila) {
			const restantes = tarifas.filter((t) => !(t.zona_origen_id === origen && t.zona_destino_id === destino));
			tarifas = [...restantes, { ...fila }];
			celdas[k] = String(fila.valor);
			celdas = { ...celdas };
		}
		flash(k);
	}

	$effect(() => {
		cargar();
	});
</script>

<svelte:head>
	<title>Tarifas — StarGo Admin</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-center justify-between gap-4">
	<div>
		<h1 class="text-2xl font-extrabold tracking-tight text-slate-900">Matriz de tarifas</h1>
		<p class="mt-1 text-sm text-slate-500">
			Edita el precio origen → destino. {paresDefinidos} de {totalPares} pares definidos.
		</p>
	</div>
	<div class="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs text-slate-500 shadow-sm">
		<Icon icon={Save} class="size-3.5 text-primary-dark" />
		Los cambios se guardan automáticamente al salir de la celda (Enter o clic fuera).
	</div>
</header>

{#if mensaje}
	<div
		class="mb-5 rounded-xl border px-4 py-3 text-sm {mensaje.tipo === 'ok'
			? 'border-primary/30 bg-primary-light text-primary-dark'
			: 'border-red-200 bg-red-50 text-red-700'}"
	>
		{mensaje.texto}
	</div>
{/if}

<div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
	{#if cargando}
		<div class="flex items-center justify-center gap-3 py-16 text-slate-500">
			<span class="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" ></span>
			Cargando matriz…
		</div>
	{:else if error}
		<div class="p-6 text-sm text-red-600">No se pudieron cargar los datos: {error}</div>
	{:else}
		<div class="max-h-[70vh] overflow-auto">
			<table class="border-separate border-spacing-0 text-sm">
				<thead>
					<tr>
						<th class="sticky top-0 left-0 z-20 border-b border-r border-slate-200 bg-slate-100 px-4 py-3 text-left text-xs font-bold tracking-wide text-slate-500 uppercase">
							Origen ↓ / Destino →
						</th>
						{#each destinos as destino (destino.id)}
							<th class="sticky top-0 z-10 min-w-36 border-b border-slate-200 bg-slate-100 px-2 py-3 text-center text-xs font-semibold text-slate-600">
								{destino.nombre}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each origenes as origen (origen.id)}
						<tr>
							<th class="sticky left-0 z-10 max-w-52 border-r border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-left align-middle text-xs font-bold text-slate-700">
								{origen.nombre}
							</th>
							{#each destinos as destino (destino.id)}
								{@const k = key(origen.id, destino.id)}
								{@const esDiagonal = origen.id === destino.id}
								{@const reverso = mapaTarifas.get(key(destino.id, origen.id))}
								<td class="border-b border-slate-100 p-1.5 {esDiagonal ? 'bg-primary-light/60' : ''}">
									<div class="relative">
										<input
											type="number"
											min="0"
											step="500"
											value={celdas[k] ?? ''}
											placeholder={reverso != null ? `~${reverso}` : ''}
											aria-label={`${origen.nombre} a ${destino.nombre}`}
											onchange={(e) => {
												celdas[k] = (e.currentTarget as HTMLInputElement).value;
												celdas = { ...celdas };
												guardarCelda(origen.id, destino.id);
											}}
											onkeydown={(e) => {
												if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
											}}
											class="w-full min-w-20 rounded-lg border px-2 py-1.5 text-center text-sm tabular-nums transition {esDiagonal
												? 'border-primary/30 bg-primary-light text-primary-dark focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/30 focus:outline-none'
												: 'border-slate-200 bg-white text-slate-800 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none'}"
										/>
										{#if guardando[k]}
											<span class="absolute -top-1 -right-1 size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" ></span>
										{:else if guardadoOk[k]}
											<span class="absolute -top-1.5 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-white">
												<Icon icon={Check} class="size-2.5" />
											</span>
										{/if}
									</div>
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
			<p>
				El <span class="text-primary-dark">placeholder "~$X"</span> indica que el par inverso ya define el precio (matriz simétrica).
				Vacía una celda y pulsa Enter para quitar esa tarifa. El par (A → B) sin tarifa usa la de (B → A).
			</p>
		</div>
	{/if}
</div>
