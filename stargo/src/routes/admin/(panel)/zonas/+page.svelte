<script lang="ts">
	import { api } from '$lib/api';
	import { ordenarZonas, type Zona, type ZonaTipo } from '$lib/types';

	let zonas = $state<Zona[]>([]);
	let cargando = $state(true);
	let error = $state<string | null>(null);
	let mensaje = $state<{ tipo: 'ok' | 'err'; texto: string } | null>(null);

	let nuevo = $state({ id: '', nombre: '', tipo: 'urbana' as ZonaTipo, descripcion: '' });
	let creando = $state(false);
	let editando = $state<Record<string, { nombre: string; tipo: ZonaTipo; descripcion: string }>>({});
	let guardando = $state<Record<string, boolean>>({});
	let nuevaZonaAbierta = $state(false);

	const TIPOS: { valor: ZonaTipo; label: string; color: string }[] = [
		{ valor: 'urbana', label: 'Urbana', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
		{ valor: 'destino_solo', label: 'Solo destino', color: 'bg-sky-50 text-sky-700 border-sky-200' },
		{ valor: 'no_disponible', label: 'No disponible', color: 'bg-red-50 text-red-700 border-red-200' }
	];

	const colorTipo = $derived((t: ZonaTipo) => TIPOS.find((x) => x.valor === t)?.color ?? 'bg-slate-100 text-slate-600 border-slate-200');
	const labelTipo = $derived((t: ZonaTipo) => TIPOS.find((x) => x.valor === t)?.label ?? t);

	async function cargar() {
		cargando = true;
		error = null;
		const r = await api.get<Zona[]>('/api/zonas?select=id,nombre,tipo,descripcion');
		cargando = false;
		if (r.error) {
			error = r.error;
			return;
		}
		zonas = ordenarZonas(r.data ?? []);
	}

	async function crear(e: SubmitEvent) {
		e.preventDefault();
		if (!nuevo.id.trim() || !nuevo.nombre.trim()) {
			mensaje = { tipo: 'err', texto: 'El id y el nombre son obligatorios.' };
			return;
		}
		creando = true;
		mensaje = null;
		const r = await api.post<Zona[]>('/api/zonas', {
			op: 'insert',
			filas: [
				{
					id: nuevo.id.trim().toLowerCase().replace(/\s+/g, '_'),
					nombre: nuevo.nombre.trim(),
					tipo: nuevo.tipo,
					descripcion: nuevo.descripcion.trim() || null
				}
			]
		});
		creando = false;
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		nuevo = { id: '', nombre: '', tipo: 'urbana', descripcion: '' };
		nuevaZonaAbierta = false;
		mensaje = { tipo: 'ok', texto: 'Zona creada correctamente.' };
		await cargar();
	}

	function empezarEdicion(zona: Zona) {
		editando[zona.id] = { nombre: zona.nombre, tipo: zona.tipo, descripcion: zona.descripcion ?? '' };
		editando = { ...editando };
	}

	function cancelarEdicion(id: string) {
		const copy = { ...editando };
		delete copy[id];
		editando = copy;
	}

	async function guardarEdicion(zona: Zona) {
		const datos = editando[zona.id];
		if (!datos) return;
		guardando[zona.id] = true;
		guardando = { ...guardando };
		mensaje = null;
		const r = await api.put<Zona[]>(`/api/zonas?filtro=id=${encodeURIComponent(zona.id)}`, {
			datos: {
				nombre: datos.nombre.trim(),
				tipo: datos.tipo,
				descripcion: datos.descripcion.trim() || null
			}
		});
		guardando[zona.id] = false;
		guardando = { ...guardando };
		if (r.error) {
			mensaje = { tipo: 'err', texto: `No se pudo guardar «${zona.nombre}»: ${r.error}` };
			return;
		}
		cancelarEdicion(zona.id);
		mensaje = { tipo: 'ok', texto: `Zona «${zona.nombre}» actualizada.` };
		await cargar();
	}

	async function eliminar(zona: Zona) {
		if (!confirm(`¿Eliminar la zona «${zona.nombre}»? Los barrios y tarifas asociados se borrarán en cascada.`)) return;
		mensaje = null;
		const r = await api.del<Zona[]>(`/api/zonas?filtro=id=${encodeURIComponent(zona.id)}`);
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		mensaje = { tipo: 'ok', texto: `Zona «${zona.nombre}» eliminada.` };
		await cargar();
	}

	$effect(() => {
		cargar();
	});
</script>

<svelte:head>
	<title>Zonas — StarGo Admin</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-center justify-between gap-4">
	<div>
		<h1 class="text-2xl font-extrabold tracking-tight text-slate-900">Zonas tarifarias</h1>
		<p class="mt-1 text-sm text-slate-500">Agrupan barrios y definen la matriz de precios origen → destino.</p>
	</div>
	<button
		type="button"
		onclick={() => (nuevaZonaAbierta = !nuevaZonaAbierta)}
		class="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-600"
	>
		<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
			<path d="M12 5v14M5 12h14" />
		</svg>
		Nueva zona
	</button>
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

{#if nuevaZonaAbierta}
	<form onsubmit={crear} class="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
		<h2 class="mb-4 text-sm font-bold text-emerald-900">Crear zona</h2>
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<div>
				<label for="zona-id" class="mb-1 block text-xs font-semibold text-slate-600">ID (slug)</label>
				<input id="zona-id" bind:value={nuevo.id} placeholder="ej: norte_51_60" class="input" />
			</div>
			<div>
				<label for="zona-nombre" class="mb-1 block text-xs font-semibold text-slate-600">Nombre</label>
				<input id="zona-nombre" bind:value={nuevo.nombre} placeholder="ej: Norte (Calle 51-60)" class="input" />
			</div>
			<div>
				<label for="zona-tipo" class="mb-1 block text-xs font-semibold text-slate-600">Tipo</label>
				<select id="zona-tipo" bind:value={nuevo.tipo} class="input">
					{#each TIPOS as t (t.valor)}
						<option value={t.valor}>{t.label}</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="zona-desc" class="mb-1 block text-xs font-semibold text-slate-600">Descripción</label>
				<input id="zona-desc" bind:value={nuevo.descripcion} placeholder="Límites, referencia…" class="input" />
			</div>
		</div>
		<div class="mt-4 flex gap-2">
			<button
				type="submit"
				disabled={creando}
				class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
			>
				{creando ? 'Creando…' : 'Crear zona'}
			</button>
			<button
				type="button"
				onclick={() => (nuevaZonaAbierta = false)}
				class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
			>
				Cancelar
			</button>
		</div>
	</form>
{/if}

<div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
	{#if cargando}
		<div class="flex items-center justify-center gap-3 py-16 text-slate-500">
			<span class="size-5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" ></span>
			Cargando zonas…
		</div>
	{:else if error}
		<div class="p-6 text-sm text-red-600">No se pudieron cargar las zonas: {error}</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-left text-sm">
				<thead>
					<tr class="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase">
						<th class="px-4 py-3">ID</th>
						<th class="px-4 py-3">Nombre</th>
						<th class="px-4 py-3">Tipo</th>
						<th class="hidden px-4 py-3 lg:table-cell">Descripción</th>
						<th class="px-4 py-3 text-right">Acciones</th>
					</tr>
				</thead>
				<tbody>
					{#each zonas as zona (zona.id)}
						{@const editandoZona = editando[zona.id]}
						<tr class="border-b border-slate-100 transition hover:bg-slate-50/60">
							{#if editandoZona}
								<td class="px-4 py-2.5 font-mono text-xs text-slate-400">{zona.id}</td>
								<td class="px-4 py-2.5"><input bind:value={editandoZona.nombre} class="input" /></td>
								<td class="px-4 py-2.5">
									<select bind:value={editandoZona.tipo} class="input">
										{#each TIPOS as t (t.valor)}
											<option value={t.valor}>{t.label}</option>
										{/each}
									</select>
								</td>
								<td class="hidden px-4 py-2.5 lg:table-cell">
									<input bind:value={editandoZona.descripcion} class="input" placeholder="Sin descripción" />
								</td>
								<td class="px-4 py-2.5 text-right">
									<div class="inline-flex gap-1.5">
										<button
											type="button"
											onclick={() => guardarEdicion(zona)}
											disabled={guardando[zona.id]}
											class="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-60"
										>
											{guardando[zona.id] ? 'Guardando…' : 'Guardar'}
										</button>
										<button
											type="button"
											onclick={() => cancelarEdicion(zona.id)}
											class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
										>
											Cancelar
										</button>
									</div>
								</td>
							{:else}
								<td class="px-4 py-3 font-mono text-xs text-slate-500">{zona.id}</td>
								<td class="px-4 py-3 font-medium text-slate-900">{zona.nombre}</td>
								<td class="px-4 py-3">
									<span class="inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium {colorTipo(zona.tipo)}">
										{labelTipo(zona.tipo)}
									</span>
								</td>
								<td class="hidden max-w-xs truncate px-4 py-3 text-slate-500 lg:table-cell">
									{zona.descripcion ?? '—'}
								</td>
								<td class="px-4 py-3 text-right">
									<div class="inline-flex gap-1.5">
										<button
											type="button"
											onclick={() => empezarEdicion(zona)}
											class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
										>
											Editar
										</button>
										<button
											type="button"
											onclick={() => eliminar(zona)}
											class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:border-red-300 hover:bg-red-50"
										>
											Eliminar
										</button>
									</div>
								</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if zonas.length === 0}
			<p class="p-8 text-center text-sm text-slate-400">Aún no hay zonas. Crea la primera con «Nueva zona».</p>
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
