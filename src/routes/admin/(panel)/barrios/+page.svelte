<script lang="ts">
	import { api } from '$lib/api';
	import Icon from '$lib/components/Icon.svelte';
	import { Search, Plus, MapPin } from 'lucide';
	import { ordenarZonas, type Barrio, type Zona } from '$lib/types';
	import Tabla from '$lib/components/tabla/Tabla.svelte';
	import TablaEncabezado from '$lib/components/tabla/TablaEncabezado.svelte';
	import TablaVacia from '$lib/components/tabla/TablaVacia.svelte';
	import TablaError from '$lib/components/tabla/TablaError.svelte';
	import TablaCargando from '$lib/components/tabla/TablaCargando.svelte';
	import Paginacion from '$lib/components/tabla/Paginacion.svelte';
	import Badge from '$lib/components/tabla/Badge.svelte';
	import Boton from '$lib/components/tabla/Boton.svelte';
	import CampoMovil from '$lib/components/tabla/CampoMovil.svelte';
	import SoloEscritorio from '$lib/components/tabla/SoloEscritorio.svelte';
	import SoloMovil from '$lib/components/tabla/SoloMovil.svelte';

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
			? 'border-primary/30 bg-primary-light text-primary-dark'
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
				class="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-dark disabled:opacity-60"
			>
				{creando ? 'Agregando…' : '+ Agregar'}
			</button>
		</div>
	</div>
</form>

<!-- Filtros -->
<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
	<div class="relative w-full sm:max-w-xs">
		<Icon icon={Search} class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
		<input
			bind:value={busqueda}
			placeholder="Buscar barrio…"
			class="input pl-9"
		/>
	</div>
	<select bind:value={zonaFiltro} class="input w-full sm:w-auto" aria-label="Filtrar por zona">
		<option value="todas">Todas las zonas</option>
		{#each zonas as zona (zona.id)}
			<option value={zona.id}>{zona.nombre}</option>
		{/each}
	</select>
	<span class="text-xs text-slate-400 sm:ml-auto">
		Mostrando {visibles.length} de {filtrados.length}
	</span>
</div>

<Tabla>
	{#if cargando}
		<TablaCargando columnas={4} filas={5} />
	{:else if error}
		<TablaError
			titulo="No se pudieron cargar los barrios"
			mensaje={error}
			onreintentar={cargar}
		/>
	{:else if visibles.length === 0}
		<TablaVacia
			icono={MapPin}
			titulo={barrios.length === 0 ? 'No hay barrios todavía' : 'No hay barrios que coincidan con la búsqueda'}
			descripcion={barrios.length === 0
				? 'Los barrios aparecerán aquí cuando sean registrados.'
				: 'Ajusta la búsqueda o el filtro de zona para ver más resultados.'}
		/>
	{:else}
		<SoloEscritorio>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<TablaEncabezado
						columnas={[
							{ etiqueta: 'Barrio' },
							{ etiqueta: 'Zona' },
							{ etiqueta: 'Revisado' },
							{ etiqueta: 'Acciones', alineacion: 'derecha' }
						]}
					/>
					<tbody>
						{#each visibles as barrio (barrio.id)}
							<tr class="border-b border-slate-100 transition hover:bg-slate-50/60">
								<td class="px-4 py-2.5 font-medium text-slate-900">
									{barrio.nombre}
									{#if !barrio.zona_id}
										<Badge tono="warning" size="xs" class="ml-2">SIN ZONA</Badge>
									{/if}
								</td>
								<td class="px-4 py-2.5">
									<div class="flex items-center gap-2">
										<select
											value={barrio.zona_id ?? ''}
											onchange={(e) => reasignarZona(barrio, (e.currentTarget as HTMLSelectElement).value)}
											disabled={guardando[barrio.id]}
											class="max-w-56 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 transition focus:border-primary focus:outline-none disabled:opacity-60"
										>
											<option value="">— Sin zona —</option>
											{#each zonas as zona (zona.id)}
												<option value={zona.id}>{zona.nombre}</option>
											{/each}
										</select>
										{#if guardando[barrio.id]}
											<span class="size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" ></span>
										{/if}
									</div>
								</td>
								<td class="px-4 py-2.5">
									<button
										type="button"
										role="switch"
										aria-checked={barrio.revisado}
										onclick={() => toggleRevisado(barrio)}
										class="relative inline-flex h-6 w-11 items-center rounded-full transition {barrio.revisado ? 'bg-primary' : 'bg-slate-300'}"
										title={barrio.revisado ? 'Revisado' : 'Pendiente de revisión'}
									>
										<span
											class="inline-block size-4.5 translate-x-0.5 rounded-full bg-white shadow transition-transform {barrio.revisado ? 'translate-x-[1.4rem]' : ''}"
										></span>
									</button>
								</td>
								<td class="px-4 py-2.5 text-right">
									<Boton variant="peligro" onclick={() => eliminar(barrio)}>
										Eliminar
									</Boton>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</SoloEscritorio>

		<SoloMovil>
			<ul class="space-y-3 p-3 sm:p-4">
				{#each visibles as barrio (barrio.id)}
					<li class="rounded-xl border border-slate-200 bg-white p-4">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="font-semibold text-slate-900">{barrio.nombre}</p>
								{#if !barrio.zona_id}
									<Badge tono="warning" size="xs" class="mt-1.5">SIN ZONA</Badge>
								{/if}
							</div>
						</div>

						<div class="mt-3">
							<CampoMovil etiqueta="Zona">
								<select
									value={barrio.zona_id ?? ''}
									onchange={(e) => reasignarZona(barrio, (e.currentTarget as HTMLSelectElement).value)}
									disabled={guardando[barrio.id]}
									class="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition focus:border-primary focus:outline-none disabled:opacity-60"
								>
									<option value="">— Sin zona —</option>
									{#each zonas as zona (zona.id)}
										<option value={zona.id}>{zona.nombre}</option>
									{/each}
								</select>
							</CampoMovil>
						</div>

						<div class="mt-3 flex items-center justify-between">
							<span class="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Revisado</span>
							<div class="flex items-center gap-2">
								{#if guardando[barrio.id]}
									<span class="size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" ></span>
								{/if}
								<button
									type="button"
									role="switch"
									aria-checked={barrio.revisado}
									onclick={() => toggleRevisado(barrio)}
									class="relative inline-flex h-6 w-11 items-center rounded-full transition {barrio.revisado ? 'bg-primary' : 'bg-slate-300'}"
									title={barrio.revisado ? 'Revisado' : 'Pendiente de revisión'}
								>
									<span
										class="inline-block size-4.5 translate-x-0.5 rounded-full bg-white shadow transition-transform {barrio.revisado ? 'translate-x-[1.4rem]' : ''}"
									></span>
								</button>
							</div>
						</div>

						<div class="mt-3 flex justify-end gap-2 border-t border-slate-100 pt-3">
							<Boton variant="peligro" onclick={() => eliminar(barrio)}>
								Eliminar
							</Boton>
						</div>
					</li>
				{/each}
			</ul>
		</SoloMovil>

		{#if totalPaginas > 1}
			<Paginacion
				pagina={paginaActual}
				totalPaginas={totalPaginas}
				onCambio={(p) => (pagina = p)}
				resumen={`Mostrando ${visibles.length} de ${filtrados.length} barrios`}
			/>
		{/if}
	{/if}
</Tabla>

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
		border-color: rgb(23 104 255);
		box-shadow: 0 0 0 3px rgb(23 104 255 / 0.25);
	}
</style>