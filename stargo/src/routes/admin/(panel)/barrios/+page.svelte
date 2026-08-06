<script lang="ts">
	import { api } from '$lib/api';
	import { ordenarZonas, type Barrio, type Zona } from '$lib/types';

	let barrios = $state<Barrio[]>([]);
	let zonas = $state<Zona[]>([]);
	let cargando = $state(true);
	let error = $state<string | null>(null);
	let mensaje = $state<{ tipo: 'ok' | 'err'; texto: string } | null>(null);

	let busqueda = $state('');
	let zonaFiltro = $state('todas');
	let pagina = $state(0);
	const pageSize = 50;
	let prevFiltro = $state('');

	let nuevo = $state({ nombre: '', zona_id: '', revisado: false });
	let creando = $state(false);
	let guardando = $state<Record<string, boolean>>({});

	const nombreZona = $derived(new Map(zonas.map((z) => [z.id, z.nombre])));

	const filtrados = $derived.by(() => {
		let lista = barrios;
		const q = busqueda.trim().toLowerCase();
		if (q) lista = lista.filter((b) => b.nombre.toLowerCase().includes(q));
		if (zonaFiltro !== 'todas') lista = lista.filter((b) => b.zona_id === zonaFiltro);
		return lista;
	});

	const totalPaginas = $derived(Math.max(1, Math.ceil(filtrados.length / pageSize)));
	const paginaActual = $derived(Math.min(pagina, totalPaginas - 1));
	const visibles = $derived(filtrados.slice(paginaActual * pageSize, (paginaActual + 1) * pageSize));
	const sinZona = $derived(barrios.filter((b) => !b.zona_id).length);

	// Resetear página al cambiar búsqueda o filtro.
	$effect(() => {
		const key = busqueda + '|' + zonaFiltro;
		if (key !== prevFiltro) {
			prevFiltro = key;
			pagina = 0;
		}
	});

	async function cargar() {
		cargando = true;
		error = null;
		const [rBarrios, rZonas] = await Promise.all([
			api.get<Barrio[]>('/api/barrios?select=id,nombre,zona_id,revisado&orden=nombre'),
			api.get<Zona[]>('/api/zonas?select=id,nombre,tipo')
		]);
		cargando = false;
		if (rBarrios.error || rZonas.error) {
			error = rBarrios.error ?? rZonas.error;
			return;
		}
		barrios = rBarrios.data ?? [];
		zonas = ordenarZonas(rZonas.data ?? []);
		if (!nuevo.zona_id && zonas.length > 0) {
			nuevo.zona_id = zonas.find((z) => z.tipo === 'urbana')?.id ?? zonas[0].id;
		}
	}

	async function agregar(e: SubmitEvent) {
		e.preventDefault();
		if (!nuevo.nombre.trim() || !nuevo.zona_id) {
			mensaje = { tipo: 'err', texto: 'Ingresa el nombre y selecciona una zona.' };
			return;
		}
		creando = true;
		mensaje = null;
		const r = await api.post<Barrio[]>('/api/barrios', {
			op: 'insert',
			filas: [{ nombre: nuevo.nombre.trim(), zona_id: nuevo.zona_id, revisado: nuevo.revisado }]
		});
		creando = false;
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		if (r.data && r.data.length === 0) {
			mensaje = { tipo: 'err', texto: `«${nuevo.nombre}» ya existe.` };
		} else {
			mensaje = { tipo: 'ok', texto: `Barrio «${nuevo.nombre}» agregado.` };
			nuevo = { nombre: '', zona_id: nuevo.zona_id, revisado: false };
			await cargar();
		}
	}

	async function reasignarZona(barrio: Barrio, zonaId: string) {
		const nuevaZona = zonaId === '' ? null : zonaId;
		if (nuevaZona === (barrio.zona_id ?? null)) return;
		guardando[barrio.id] = true;
		guardando = { ...guardando };
		const r = await api.put<Barrio[]>(`/api/barrios?filtro=id=${encodeURIComponent(barrio.id)}`, {
			datos: { zona_id: nuevaZona }
		});
		guardando[barrio.id] = false;
		guardando = { ...guardando };
		if (r.error) {
			mensaje = { tipo: 'err', texto: `No se pudo reasignar «${barrio.nombre}»: ${r.error}` };
			return;
		}
		barrio.zona_id = nuevaZona;
		barrios = [...barrios];
		mensaje = {
			tipo: 'ok',
			texto: nuevaZona ? `«${barrio.nombre}» → ${nombreZona.get(nuevaZona) ?? nuevaZona}` : `«${barrio.nombre}» sin zona`
		};
	}

	async function toggleRevisado(barrio: Barrio) {
		guardando[barrio.id] = true;
		guardando = { ...guardando };
		const r = await api.put<Barrio[]>(`/api/barrios?filtro=id=${encodeURIComponent(barrio.id)}`, {
			datos: { revisado: !barrio.revisado }
		});
		guardando[barrio.id] = false;
		guardando = { ...guardando };
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		barrio.revisado = !barrio.revisado;
		barrios = [...barrios];
	}

	async function eliminar(barrio: Barrio) {
		if (!confirm(`¿Eliminar el barrio «${barrio.nombre}»?`)) return;
		mensaje = null;
		const r = await api.del<Barrio[]>(`/api/barrios?filtro=id=${encodeURIComponent(barrio.id)}`);
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		mensaje = { tipo: 'ok', texto: `Barrio «${barrio.nombre}» eliminado.` };
		await cargar();
	}

	$effect(() => {
		cargar();
	});
</script>

<svelte:head>
	<title>Barrios — StarGo Admin</title>
</svelte:head>

<header class="mb-6">
	<h1 class="text-2xl font-extrabold tracking-tight text-slate-900">Barrios</h1>
	<p class="mt-1 text-sm text-slate-500">
		{barrios.length} barrios · {sinZona} sin zona asignada. Cada barrio pertenece a una zona tarifaria.
	</p>
</header>

{#if mensaje}
	<div
		class="mb-5 rounded-xl border px-4 py-3 text-sm {mensaje.tipo === 'ok'
			? 'border-emerald-200 bg-emerald-50 text-emerald-700'
			: 'border-red-200 bg-red-50 text-red-700'}"
	>
		{mensaje.texto}
	</div>
{/if}

<!-- Agregar barrio -->
<form onsubmit={agregar} class="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
	<h2 class="mb-4 text-sm font-bold tracking-wide text-slate-500 uppercase">Agregar barrio</h2>
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		<div class="lg:col-span-2">
			<label for="nuevo-nombre" class="mb-1 block text-xs font-semibold text-slate-600">Nombre</label>
			<input
				id="nuevo-nombre"
				bind:value={nuevo.nombre}
				placeholder="ej: Barrio La Esperanza"
				class="input"
			/>
		</div>
		<div>
			<label for="nuevo-zona" class="mb-1 block text-xs font-semibold text-slate-600">Zona</label>
			<select id="nuevo-zona" bind:value={nuevo.zona_id} class="input">
				{#each zonas as zona (zona.id)}
					<option value={zona.id}>{zona.nombre}</option>
				{/each}
			</select>
		</div>
		<div class="flex items-end">
			<button
				type="submit"
				disabled={creando}
				class="w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-600 disabled:opacity-60"
			>
				{creando ? 'Agregando…' : '+ Agregar'}
			</button>
		</div>
	</div>
</form>

<!-- Filtros -->
<div class="mb-4 flex flex-wrap items-center gap-3">
	<div class="relative min-w-52 flex-1 sm:max-w-xs">
		<svg class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="11" cy="11" r="8" />
			<path d="m21 21-4.3-4.3" />
		</svg>
		<input
			bind:value={busqueda}
			placeholder="Buscar barrio…"
			class="input pl-9"
		/>
	</div>
	<select bind:value={zonaFiltro} class="input w-auto" aria-label="Filtrar por zona">
		<option value="todas">Todas las zonas</option>
		{#each zonas as zona (zona.id)}
			<option value={zona.id}>{zona.nombre}</option>
		{/each}
	</select>
	<span class="text-xs text-slate-400">
		Mostrando {visibles.length} de {filtrados.length}
	</span>
</div>

<div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
	{#if cargando}
		<div class="flex items-center justify-center gap-3 py-16 text-slate-500">
			<span class="size-5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" ></span>
			Cargando barrios…
		</div>
	{:else if error}
		<div class="p-6 text-sm text-red-600">No se pudieron cargar los barrios: {error}</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-left text-sm">
				<thead>
					<tr class="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase">
						<th class="px-4 py-3">Barrio</th>
						<th class="px-4 py-3">Zona</th>
						<th class="px-4 py-3">Revisado</th>
						<th class="px-4 py-3 text-right">Acciones</th>
					</tr>
				</thead>
				<tbody>
					{#each visibles as barrio (barrio.id)}
						<tr class="border-b border-slate-100 transition hover:bg-slate-50/60">
							<td class="px-4 py-2.5 font-medium text-slate-900">
								{barrio.nombre}
								{#if !barrio.zona_id}
									<span class="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">SIN ZONA</span>
								{/if}
							</td>
							<td class="px-4 py-2.5">
								<div class="flex items-center gap-2">
									<select
										value={barrio.zona_id ?? ''}
										onchange={(e) => reasignarZona(barrio, (e.currentTarget as HTMLSelectElement).value)}
										disabled={guardando[barrio.id]}
										class="max-w-56 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 transition focus:border-emerald-400 focus:outline-none disabled:opacity-60"
									>
										<option value="">— Sin zona —</option>
										{#each zonas as zona (zona.id)}
											<option value={zona.id}>{zona.nombre}</option>
										{/each}
									</select>
									{#if guardando[barrio.id]}
										<span class="size-3.5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" ></span>
									{/if}
								</div>
							</td>
							<td class="px-4 py-2.5">
								<button
									type="button"
									role="switch"
									aria-checked={barrio.revisado}
									onclick={() => toggleRevisado(barrio)}
									class="relative inline-flex h-6 w-11 items-center rounded-full transition {barrio.revisado ? 'bg-emerald-500' : 'bg-slate-300'}"
									title={barrio.revisado ? 'Revisado' : 'Pendiente de revisión'}
								>
									<span
										class="inline-block size-4.5 translate-x-0.5 rounded-full bg-white shadow transition-transform {barrio.revisado ? 'translate-x-[1.4rem]' : ''}"
									></span>
								</button>
							</td>
							<td class="px-4 py-2.5 text-right">
								<button
									type="button"
									onclick={() => eliminar(barrio)}
									class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:border-red-300 hover:bg-red-50"
								>
									Eliminar
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if visibles.length === 0}
			<p class="p-8 text-center text-sm text-slate-400">No hay barrios que coincidan con la búsqueda.</p>
		{/if}

		{#if totalPaginas > 1}
			<div class="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
				<span>
					Página {paginaActual + 1} de {totalPaginas}
				</span>
				<div class="flex gap-1.5">
					<button
						type="button"
						onclick={() => (pagina = Math.max(0, paginaActual - 1))}
						disabled={paginaActual === 0}
						class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium transition hover:bg-slate-100 disabled:opacity-40"
					>
						← Anterior
					</button>
					<button
						type="button"
						onclick={() => (pagina = Math.min(totalPaginas - 1, paginaActual + 1))}
						disabled={paginaActual >= totalPaginas - 1}
						class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium transition hover:bg-slate-100 disabled:opacity-40"
					>
						Siguiente →
					</button>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.input {
		width: 100%;
		border-radius: 0.5rem;
		border: 1px solid rgb(203 213 225);
		background: white;
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
		color: rgb(15 23 42);
		transition: border-color 0.15s, box-shadow 0.15s;
	}
	.input:focus {
		outline: none;
		border-color: rgb(16 185 129);
		box-shadow: 0 0 0 3px rgb(16 185 129 / 0.25);
	}
</style>
