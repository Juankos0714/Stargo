<script lang="ts">
	import { api } from '$lib/api';
	import Icon from '$lib/components/Icon.svelte';
	import { CircleCheck, Plus, RefreshCw, Search, SlidersHorizontal, Receipt } from 'lucide';
	import { formatearMontoCampo, normalizarMontoCampo, TIPOS_RECARGO, etiquetaTipoRecargo, type Recargo, type TipoRecargo } from '$lib/types';
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

	let recargos = $state<Recargo[]>([]);
	let cargando = $state(true);
	let error = $state<string | null>(null);
	let mensaje = $state<{ tipo: 'ok' | 'err'; texto: string } | null>(null);

	let nuevo = $state({
		codigo: '',
		nombre: '',
		tipo: 'otro' as TipoRecargo,
		valor: 0,
		descripcion: '',
		activo: true
	});
	let creando = $state(false);
	let formAbierto = $state(false);
	let editando = $state<Record<string, { nombre: string; tipo: string; valor: number; descripcion: string; activo: boolean }>>({});
	let guardando = $state<Record<string, boolean>>({});
	let alternando = $state<Record<string, boolean>>({});
	let busqueda = $state('');
	let filtroTipo = $state<string>('todos');
	let filtroEstado = $state<'todos' | 'activos' | 'inactivos'>('todos');

	const colorTipo = $derived((t: string) => TIPOS_RECARGO.find((x) => x.valor === t)?.color ?? 'bg-slate-100 text-slate-600 border-slate-200');

	const ordenado = $derived(
		[...recargos].sort((a, b) => {
			const t = a.tipo.localeCompare(b.tipo);
			return t !== 0 ? t : a.nombre.localeCompare(b.nombre, 'es');
		})
	);
	const recargosFiltrados = $derived(
		ordenado.filter((r) => {
			const texto = `${r.codigo} ${r.nombre} ${r.descripcion ?? ''}`.toLocaleLowerCase('es');
			if (busqueda.trim() && !texto.includes(busqueda.trim().toLocaleLowerCase('es'))) return false;
			if (filtroTipo !== 'todos' && r.tipo !== filtroTipo) return false;
			return filtroEstado === 'todos' || (filtroEstado === 'activos' ? r.activo : !r.activo);
		})
	);
	const activos = $derived(recargos.filter((r) => r.activo).length);

	async function cargar() {
		cargando = true;
		error = null;
		const r = await api.get<Recargo[]>('/api/recargos?select=*&orden=codigo');
		cargando = false;
		if (r.error) {
			error = r.error;
			return;
		}
		recargos = (r.data ?? []).map((x) => ({ ...x, activo: x.activo !== false }));
	}

	async function crear(e: SubmitEvent) {
		e.preventDefault();
		if (!nuevo.codigo.trim() || !nuevo.nombre.trim()) {
			mensaje = { tipo: 'err', texto: 'El código y el nombre son obligatorios.' };
			return;
		}
		if (nuevo.valor < 0) {
			mensaje = { tipo: 'err', texto: 'El valor no puede ser negativo.' };
			return;
		}
		creando = true;
		mensaje = null;
		const r = await api.post<Recargo[]>('/api/recargos', {
			op: 'insert',
			filas: [
				{
					codigo: nuevo.codigo.trim().toLowerCase().replace(/\s+/g, '_'),
					nombre: nuevo.nombre.trim(),
					tipo: nuevo.tipo,
					valor: Math.round(nuevo.valor),
					descripcion: nuevo.descripcion.trim() || null,
					activo: nuevo.activo
				}
			]
		});
		creando = false;
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		nuevo = { codigo: '', nombre: '', tipo: 'otro', valor: 0, descripcion: '', activo: true };
		formAbierto = false;
		mensaje = { tipo: 'ok', texto: 'Recargo creado correctamente.' };
		await cargar();
	}

	function empezarEdicion(r: Recargo) {
		editando[r.codigo] = {
			nombre: r.nombre,
			tipo: r.tipo,
			valor: r.valor,
			descripcion: r.descripcion ?? '',
			activo: r.activo
		};
		editando = { ...editando };
	}

	function cancelarEdicion(codigo: string) {
		const copy = { ...editando };
		delete copy[codigo];
		editando = copy;
	}

	async function guardarEdicion(r: Recargo) {
		const datos = editando[r.codigo];
		if (!datos) return;
		if (!datos.nombre.trim() || datos.valor < 0) {
			mensaje = { tipo: 'err', texto: 'Revisa el nombre y el valor del recargo.' };
			return;
		}
		guardando[r.codigo] = true;
		guardando = { ...guardando };
		mensaje = null;
		const r2 = await api.put<Recargo[]>(`/api/recargos?filtro=codigo=${encodeURIComponent(r.codigo)}`, {
			datos: {
				nombre: datos.nombre.trim(),
				tipo: datos.tipo,
				valor: Math.round(datos.valor),
				descripcion: datos.descripcion.trim() || null,
				activo: datos.activo
			}
		});
		guardando[r.codigo] = false;
		guardando = { ...guardando };
		if (r2.error) {
			mensaje = { tipo: 'err', texto: `No se pudo guardar «${r.nombre}»: ${r2.error}` };
			return;
		}
		cancelarEdicion(r.codigo);
		mensaje = { tipo: 'ok', texto: `Recargo «${r.nombre}» actualizado. El nuevo valor se usará en los próximos pedidos.` };
		await cargar();
	}

	async function alternarActivo(r: Recargo) {
		alternando[r.codigo] = true;
		alternando = { ...alternando };
		mensaje = null;
		const r2 = await api.put<Recargo[]>(`/api/recargos?filtro=codigo=${encodeURIComponent(r.codigo)}`, {
			datos: { activo: !r.activo }
		});
		alternando[r.codigo] = false;
		alternando = { ...alternando };
		if (r2.error) {
			mensaje = { tipo: 'err', texto: r2.error };
			return;
		}
		mensaje = { tipo: 'ok', texto: `${r.nombre} ${r.activo ? 'desactivado' : 'activado'}.` };
		await cargar();
	}

	async function eliminar(r: Recargo) {
		if (!confirm(`¿Eliminar el recargo «${r.nombre}»? Los pedidos que ya lo usaron conservan su copia.`)) return;
		mensaje = null;
		const r2 = await api.del<Recargo[]>(`/api/recargos?filtro=codigo=${encodeURIComponent(r.codigo)}`);
		if (r2.error) {
			mensaje = { tipo: 'err', texto: r2.error };
			return;
		}
		mensaje = { tipo: 'ok', texto: `Recargo «${r.nombre}» eliminado.` };
		await cargar();
	}

	$effect(() => {
		cargar();
	});
</script>

<svelte:head>
	<title>Recargos — StarGo Admin</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-center justify-between gap-4">
	<div>
		<h1 class="text-2xl font-extrabold tracking-tight text-slate-900">Recargos</h1>
		<p class="mt-1 text-sm text-slate-500">
			Configura los valores que se aplican en los próximos pedidos. Los pedidos ya creados conservan su valor original.
		</p>
	</div>
	<button
		type="button"
		onclick={() => (formAbierto = !formAbierto)}
		class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-dark"
	>
		<Icon icon={Plus} class="size-4" />
		Nuevo recargo
	</button>
</header>

<section class="mb-6 grid gap-3 sm:grid-cols-3">
	<div class="rounded-xl border border-primary/20 bg-primary-light/50 p-4">
		<p class="text-xs font-semibold tracking-wide text-primary-dark uppercase">Recargos activos</p>
		<p class="mt-1 text-2xl font-extrabold text-slate-900">{activos}</p>
		<p class="mt-1 text-xs text-slate-500">Disponibles para nuevas cotizaciones.</p>
	</div>
	<div class="rounded-xl border border-slate-200 bg-white p-4">
		<p class="text-xs font-semibold tracking-wide text-slate-500 uppercase">Configurados</p>
		<p class="mt-1 text-2xl font-extrabold text-slate-900">{recargos.length}</p>
		<p class="mt-1 text-xs text-slate-500">Activos e inactivos en el catálogo.</p>
	</div>
	<div class="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
		<div class="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-emerald-700 uppercase"><Icon icon={CircleCheck} class="size-3.5" /> Actualización inmediata</div>
		<p class="mt-1 text-sm font-semibold text-emerald-900">Guardar aplica el precio nuevo.</p>
		<p class="mt-1 text-xs text-emerald-700">No hace falta publicar ni reiniciar la aplicación.</p>
	</div>
</section>

{#if mensaje}
	<div
		class="mb-5 rounded-xl border px-4 py-3 text-sm {mensaje.tipo === 'ok'
			? 'border-primary/30 bg-primary-light text-primary-dark'
			: 'border-red-200 bg-red-50 text-red-700'}"
	>
		{mensaje.texto}
	</div>
{/if}

<!-- Filtros -->
<div class="mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
	<div class="relative w-full flex-1">
		<Icon icon={Search} class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
		<input bind:value={busqueda} class="input pl-9" placeholder="Buscar por nombre, código o descripción…" aria-label="Buscar recargos" />
	</div>
	<div class="grid gap-2 sm:flex sm:items-center">
		<div class="flex items-center gap-2">
			<Icon icon={SlidersHorizontal} class="size-4 shrink-0 text-slate-400" />
			<select bind:value={filtroTipo} class="input flex-1 sm:w-44" aria-label="Filtrar por tipo">
				<option value="todos">Todos los tipos</option>
				{#each TIPOS_RECARGO as t (t.valor)}<option value={t.valor}>{t.label}</option>{/each}
			</select>
		</div>
		<select bind:value={filtroEstado} class="input w-full sm:w-36" aria-label="Filtrar por estado">
			<option value="todos">Todos</option><option value="activos">Activos</option><option value="inactivos">Inactivos</option>
		</select>
		<button type="button" onclick={cargar} class="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50" aria-label="Actualizar catálogo" title="Actualizar catálogo"><Icon icon={RefreshCw} class="mx-auto size-4" /></button>
	</div>
</div>

{#if formAbierto}
	<form onsubmit={crear} class="mb-6 rounded-2xl border border-primary/30 bg-primary-light/50 p-5">
		<h2 class="mb-4 text-sm font-bold text-primary-dark">Crear recargo</h2>
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
			<div>
				<label for="rec-codigo" class="mb-1 block text-xs font-semibold text-slate-600">Código (slug)</label>
				<input id="rec-codigo" bind:value={nuevo.codigo} placeholder="ej: compra_supermercado" class="input" />
			</div>
			<div>
				<label for="rec-nombre" class="mb-1 block text-xs font-semibold text-slate-600">Nombre</label>
				<input id="rec-nombre" bind:value={nuevo.nombre} placeholder="ej: Compra en supermercado" class="input" />
			</div>
			<div>
				<label for="rec-tipo" class="mb-1 block text-xs font-semibold text-slate-600">Tipo</label>
				<select id="rec-tipo" bind:value={nuevo.tipo} class="input">
					{#each TIPOS_RECARGO as t (t.valor)}
						<option value={t.valor}>{t.label}</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="rec-valor" class="mb-1 block text-xs font-semibold text-slate-600">Valor (COP)</label>
				<input id="rec-valor" type="text" inputmode="numeric" value={formatearMontoCampo(nuevo.valor)} oninput={(e) => (nuevo.valor = Number(normalizarMontoCampo(e.currentTarget.value) || 0))} class="input" />
			</div>
			<div>
				<label for="rec-desc" class="mb-1 block text-xs font-semibold text-slate-600">Descripción</label>
				<input id="rec-desc" bind:value={nuevo.descripcion} placeholder="Cuándo aplica…" class="input" />
			</div>
		</div>
		<div class="mt-4 flex flex-wrap items-center gap-4">
			<label class="flex items-center gap-2 text-sm font-medium text-slate-700">
				<input type="checkbox" bind:checked={nuevo.activo} class="size-4 accent-[#1768FF]" />
				Activo (visible para los clientes)
			</label>
			<div class="flex gap-2">
				<button
					type="submit"
					disabled={creando}
					class="rounded-lg bg-primary-dark px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
				>
					{creando ? 'Creando…' : 'Crear recargo'}
				</button>
				<button
					type="button"
					onclick={() => (formAbierto = false)}
					class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
				>
					Cancelar
				</button>
			</div>
		</div>
	</form>
{/if}

<Tabla>
	{#if cargando}
		<TablaCargando columnas={7} filas={5} />
	{:else if error}
		<TablaError
			titulo="No se pudieron cargar los recargos"
			mensaje={error}
			onreintentar={cargar}
		/>
	{:else if recargos.length === 0}
		<TablaVacia
			icono={Receipt}
			titulo="No hay recargos todavía"
			descripcion="Los recargos aparecen en el formulario de pedidos para cotizaciones nuevas. Crea el primero para comenzar."
		>
			<Boton variant="primario" onclick={() => (formAbierto = true)}>
				<Icon icon={Plus} class="size-3.5" />
				Nuevo recargo
			</Boton>
		</TablaVacia>
	{:else if recargosFiltrados.length === 0}
		<TablaVacia
			icono={Search}
			titulo="No hay recargos que coincidan con los filtros"
			descripcion="Ajusta la búsqueda o los filtros para ver más resultados."
		/>
	{:else}
		<SoloEscritorio>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<TablaEncabezado
						columnas={[
							{ etiqueta: 'Código' },
							{ etiqueta: 'Nombre' },
							{ etiqueta: 'Tipo' },
							{ etiqueta: 'Valor', alineacion: 'derecha' },
							{ etiqueta: 'Descripción', clase: 'hidden lg:table-cell' },
							{ etiqueta: 'Estado' },
							{ etiqueta: 'Acciones', alineacion: 'derecha' }
						]}
					/>
					<tbody>
						{#each recargosFiltrados as r (r.codigo)}
							{@const editandoRecargo = editando[r.codigo]}
							<tr class="border-b border-slate-100 transition hover:bg-slate-50/60 {!r.activo ? 'opacity-60' : ''}">
								{#if editandoRecargo}
									<td class="px-4 py-2.5 font-mono text-xs text-slate-400">{r.codigo}</td>
									<td class="px-4 py-2.5"><input bind:value={editandoRecargo.nombre} class="input" /></td>
									<td class="px-4 py-2.5">
										<select bind:value={editandoRecargo.tipo} class="input">
											{#each TIPOS_RECARGO as t (t.valor)}
												<option value={t.valor}>{t.label}</option>
											{/each}
										</select>
									</td>
									<td class="px-4 py-2.5">
										<input type="text" inputmode="numeric" value={formatearMontoCampo(editandoRecargo.valor)} oninput={(e) => (editandoRecargo.valor = Number(normalizarMontoCampo(e.currentTarget.value) || 0))} class="input w-28 text-right" />
									</td>
									<td class="hidden px-4 py-2.5 lg:table-cell">
										<input bind:value={editandoRecargo.descripcion} class="input" placeholder="Sin descripción" />
									</td>
									<td class="px-4 py-2.5">
										<label class="flex items-center gap-2 text-xs text-slate-600">
											<input type="checkbox" bind:checked={editandoRecargo.activo} class="size-4 accent-[#1768FF]" />
											Activo
										</label>
									</td>
									<td class="px-4 py-2.5 text-right">
										<div class="inline-flex gap-1.5">
											<Boton
												variant="primario"
												onclick={() => guardarEdicion(r)}
												disabled={guardando[r.codigo]}
											>
												{guardando[r.codigo] ? 'Guardando…' : 'Guardar'}
											</Boton>
											<Boton onclick={() => cancelarEdicion(r.codigo)}>
												Cancelar
											</Boton>
										</div>
									</td>
								{:else}
									<td class="px-4 py-3 font-mono text-xs text-slate-500">{r.codigo}</td>
									<td class="px-4 py-3 font-medium text-slate-900">{r.nombre}</td>
									<td class="px-4 py-3">
										<span class="inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium {colorTipo(r.tipo)}">
											{etiquetaTipoRecargo(r.tipo)}
										</span>
									</td>
									<td class="px-4 py-3 text-right font-bold whitespace-nowrap text-slate-900">
										{Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(r.valor)}
									</td>
									<td class="hidden max-w-xs truncate px-4 py-3 text-slate-500 lg:table-cell" title={r.descripcion ?? ''}>
										{r.descripcion ?? '—'}
									</td>
									<td class="px-4 py-3">
										<button
											type="button"
											onclick={() => alternarActivo(r)}
											disabled={alternando[r.codigo]}
											class="inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold transition disabled:opacity-60 {r.activo
												? 'border-primary/30 bg-primary-light text-primary-dark hover:bg-primary-light'
												: 'border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200'}"
										>
											{alternando[r.codigo] ? '…' : r.activo ? 'Activo' : 'Inactivo'}
										</button>
									</td>
									<td class="px-4 py-3 text-right">
										<div class="inline-flex gap-1.5">
											<Boton variant="secundario" onclick={() => empezarEdicion(r)}>
												Editar
											</Boton>
											<Boton variant="peligro" onclick={() => eliminar(r)}>
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
				{#each recargosFiltrados as r (r.codigo)}
					{@const editandoRecargo = editando[r.codigo]}
					<li class="rounded-xl border border-slate-200 bg-white p-4 {!r.activo ? 'opacity-70' : ''}">
						{#if editandoRecargo}
							<p class="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Editar recargo</p>
							<div class="mt-3 space-y-3">
								<div>
									<label for={`rec-movil-nombre-${r.codigo}`} class="mb-1 block text-xs font-semibold text-slate-600">Nombre</label>
									<input id={`rec-movil-nombre-${r.codigo}`} bind:value={editandoRecargo.nombre} class="input" />
								</div>
								<div>
									<label for={`rec-movil-tipo-${r.codigo}`} class="mb-1 block text-xs font-semibold text-slate-600">Tipo</label>
									<select id={`rec-movil-tipo-${r.codigo}`} bind:value={editandoRecargo.tipo} class="input">
										{#each TIPOS_RECARGO as t (t.valor)}
											<option value={t.valor}>{t.label}</option>
										{/each}
									</select>
								</div>
								<div>
									<label for={`rec-movil-valor-${r.codigo}`} class="mb-1 block text-xs font-semibold text-slate-600">Valor (COP)</label>
									<input id={`rec-movil-valor-${r.codigo}`} type="text" inputmode="numeric" value={formatearMontoCampo(editandoRecargo.valor)} oninput={(e) => (editandoRecargo.valor = Number(normalizarMontoCampo(e.currentTarget.value) || 0))} class="input" />
								</div>
								<div>
									<label for={`rec-movil-desc-${r.codigo}`} class="mb-1 block text-xs font-semibold text-slate-600">Descripción</label>
									<input id={`rec-movil-desc-${r.codigo}`} bind:value={editandoRecargo.descripcion} class="input" placeholder="Sin descripción" />
								</div>
								<label class="flex items-center gap-2 text-sm font-medium text-slate-700">
									<input type="checkbox" bind:checked={editandoRecargo.activo} class="size-4 accent-[#1768FF]" />
									Activo (visible para los clientes)
								</label>
							</div>
							<div class="mt-4 flex gap-2">
								<Boton
									variant="primario"
									onclick={() => guardarEdicion(r)}
									disabled={guardando[r.codigo]}
								>
									{guardando[r.codigo] ? 'Guardando…' : 'Guardar'}
								</Boton>
								<Boton onclick={() => cancelarEdicion(r.codigo)}>
									Cancelar
								</Boton>
							</div>
						{:else}
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<p class="font-semibold text-slate-900">{r.nombre}</p>
									<p class="mt-0.5 font-mono text-xs text-slate-400">{r.codigo}</p>
								</div>
								<span class="inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium {colorTipo(r.tipo)}">
									{etiquetaTipoRecargo(r.tipo)}
								</span>
							</div>
							<div class="mt-3 grid grid-cols-2 gap-3">
								<CampoMovil etiqueta="Valor">
									<p class="font-bold text-slate-900">
										{Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(r.valor)}
									</p>
								</CampoMovil>
								<CampoMovil etiqueta="Estado">
									<button
										type="button"
										onclick={() => alternarActivo(r)}
										disabled={alternando[r.codigo]}
										class="inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold transition disabled:opacity-60 {r.activo
											? 'border-primary/30 bg-primary-light text-primary-dark hover:bg-primary-light'
											: 'border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200'}"
									>
										{alternando[r.codigo] ? '…' : r.activo ? 'Activo' : 'Inactivo'}
									</button>
								</CampoMovil>
							</div>
							{#if r.descripcion}
								<div class="mt-3">
									<CampoMovil etiqueta="Descripción">
										<p class="text-slate-600">{r.descripcion}</p>
									</CampoMovil>
								</div>
							{/if}
							<div class="mt-4 flex gap-2 border-t border-slate-100 pt-3">
								<Boton variant="secundario" onclick={() => empezarEdicion(r)}>
									Editar
								</Boton>
								<Boton variant="peligro" onclick={() => eliminar(r)}>
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