<script lang="ts">
	import { api } from '$lib/api';
	import Icon from '$lib/components/Icon.svelte';
	import { Plus, Layers } from 'lucide';
	import { ordenarZonas, type Zona, type ZonaTipo } from '$lib/types';
	import Tabla from '$lib/components/tabla/Tabla.svelte';
	import TablaEncabezado from '$lib/components/tabla/TablaEncabezado.svelte';
	import TablaVacia from '$lib/components/tabla/TablaVacia.svelte';
	import TablaError from '$lib/components/tabla/TablaError.svelte';
	import TablaCargando from '$lib/components/tabla/TablaCargando.svelte';
	import Badge from '$lib/components/tabla/Badge.svelte';
	import Boton from '$lib/components/tabla/Boton.svelte';
	import CampoMovil from '$lib/components/tabla/CampoMovil.svelte';
	import SoloEscritorio from '$lib/components/tabla/SoloEscritorio.svelte';
	import SoloMovil from '$lib/components/tabla/SoloMovil.svelte';

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
		{ valor: 'urbana', label: 'Urbana', color: 'bg-primary-light text-primary-dark border-primary/30' },
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
		class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-dark"
	>
		<Icon icon={Plus} class="size-4" />
		Nueva zona
	</button>
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

{#if nuevaZonaAbierta}
	<form onsubmit={crear} class="mb-6 rounded-2xl border border-primary/30 bg-primary-light/50 p-5">
		<h2 class="mb-4 text-sm font-bold text-primary-dark">Crear zona</h2>
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
				class="rounded-lg bg-primary-dark px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
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

<Tabla>
	{#if cargando}
		<TablaCargando columnas={5} filas={5} />
	{:else if error}
		<TablaError
			titulo="No se pudieron cargar las zonas"
			mensaje={error}
			onreintentar={cargar}
		/>
	{:else if zonas.length === 0}
		<TablaVacia
			icono={Layers}
			titulo="No hay zonas todavía"
			descripcion="Las zonas agrupan barrios y definen la matriz de precios. Crea la primera para comenzar."
		>
			<Boton variant="primario" onclick={() => (nuevaZonaAbierta = true)}>
				<Icon icon={Plus} class="size-3.5" />
				Crear zona
			</Boton>
		</TablaVacia>
	{:else}
		<SoloEscritorio>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<TablaEncabezado
						columnas={[
							{ etiqueta: 'ID' },
							{ etiqueta: 'Nombre' },
							{ etiqueta: 'Tipo' },
							{ etiqueta: 'Descripción', clase: 'hidden lg:table-cell' },
							{ etiqueta: 'Acciones', alineacion: 'derecha' }
						]}
					/>
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
											<Boton
												variant="primario"
												onclick={() => guardarEdicion(zona)}
												disabled={guardando[zona.id]}
											>
												{guardando[zona.id] ? 'Guardando…' : 'Guardar'}
											</Boton>
											<Boton onclick={() => cancelarEdicion(zona.id)}>
												Cancelar
											</Boton>
										</div>
									</td>
								{:else}
									<td class="px-4 py-3 font-mono text-xs text-slate-500">{zona.id}</td>
									<td class="px-4 py-3 font-medium text-slate-900">{zona.nombre}</td>
									<td class="px-4 py-3">
										<Badge tono={zona.tipo === 'urbana' ? 'primary' : zona.tipo === 'destino_solo' ? 'info' : 'error'}>
											{labelTipo(zona.tipo)}
										</Badge>
									</td>
									<td class="hidden max-w-xs truncate px-4 py-3 text-slate-500 lg:table-cell" title={zona.descripcion ?? ''}>
										{zona.descripcion ?? '—'}
									</td>
									<td class="px-4 py-3 text-right">
										<div class="inline-flex gap-1.5">
											<Boton variant="secundario" onclick={() => empezarEdicion(zona)}>
												Editar
											</Boton>
											<Boton variant="peligro" onclick={() => eliminar(zona)}>
												Eliminar
											</Boton>
										</div>
									</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</SoloEscritorio>

		<SoloMovil>
			<ul class="space-y-3 p-3 sm:p-4">
				{#each zonas as zona (zona.id)}
					{@const editandoZona = editando[zona.id]}
					<li class="rounded-xl border border-slate-200 bg-white p-4">
						{#if editandoZona}
							<p class="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Editar zona</p>
							<div class="mt-3 space-y-3">
								<div>
									<label for={`zona-movil-nombre-${zona.id}`} class="mb-1 block text-xs font-semibold text-slate-600">Nombre</label>
									<input id={`zona-movil-nombre-${zona.id}`} bind:value={editandoZona.nombre} class="input" />
								</div>
								<div>
									<label for={`zona-movil-tipo-${zona.id}`} class="mb-1 block text-xs font-semibold text-slate-600">Tipo</label>
									<select id={`zona-movil-tipo-${zona.id}`} bind:value={editandoZona.tipo} class="input">
										{#each TIPOS as t (t.valor)}
											<option value={t.valor}>{t.label}</option>
										{/each}
									</select>
								</div>
								<div>
									<label for={`zona-movil-desc-${zona.id}`} class="mb-1 block text-xs font-semibold text-slate-600">Descripción</label>
									<input id={`zona-movil-desc-${zona.id}`} bind:value={editandoZona.descripcion} class="input" placeholder="Sin descripción" />
								</div>
							</div>
							<div class="mt-4 flex gap-2">
								<Boton
									variant="primario"
									onclick={() => guardarEdicion(zona)}
									disabled={guardando[zona.id]}
								>
									{guardando[zona.id] ? 'Guardando…' : 'Guardar'}
								</Boton>
								<Boton onclick={() => cancelarEdicion(zona.id)}>
									Cancelar
								</Boton>
							</div>
						{:else}
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<p class="font-semibold text-slate-900">{zona.nombre}</p>
									<p class="mt-0.5 font-mono text-xs text-slate-400">{zona.id}</p>
								</div>
								<Badge tono={zona.tipo === 'urbana' ? 'primary' : zona.tipo === 'destino_solo' ? 'info' : 'error'}>
									{labelTipo(zona.tipo)}
								</Badge>
							</div>
							{#if zona.descripcion}
								<div class="mt-3">
									<CampoMovil etiqueta="Descripción">
										<p class="text-slate-600">{zona.descripcion}</p>
									</CampoMovil>
								</div>
							{/if}
							<div class="mt-4 flex gap-2 border-t border-slate-100 pt-3">
								<Boton variant="secundario" onclick={() => empezarEdicion(zona)}>
									Editar
								</Boton>
								<Boton variant="peligro" onclick={() => eliminar(zona)}>
									Eliminar
								</Boton>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</SoloMovil>
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