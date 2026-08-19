<script lang="ts">
	import { api } from '$lib/api';
	import Icon from '$lib/components/Icon.svelte';
	import { Plus } from 'lucide';
	import { TIPOS_RECARGO, etiquetaTipoRecargo, type Recargo, type TipoRecargo } from '$lib/types';

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

	const colorTipo = $derived((t: string) => TIPOS_RECARGO.find((x) => x.valor === t)?.color ?? 'bg-slate-100 text-slate-600 border-slate-200');

	const ordenado = $derived(
		[...recargos].sort((a, b) => {
			const t = a.tipo.localeCompare(b.tipo);
			return t !== 0 ? t : a.nombre.localeCompare(b.nombre, 'es');
		})
	);

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
		mensaje = { tipo: 'ok', texto: `Recargo «${r.nombre}» actualizado.` };
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
			Variaciones del precio: compras, tiempo de espera, paradas, peso y pagos. El cliente los elige al hacer el pedido.
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

{#if mensaje}
	<div
		class="mb-5 rounded-xl border px-4 py-3 text-sm {mensaje.tipo === 'ok'
			? 'border-primary/30 bg-primary-light text-primary-dark'
			: 'border-red-200 bg-red-50 text-red-700'}"
	>
		{mensaje.texto}
	</div>
{/if}

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
				<input id="rec-valor" type="number" min="0" step="500" bind:value={nuevo.valor} class="input" />
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

<div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
	{#if cargando}
		<div class="flex items-center justify-center gap-3 py-16 text-slate-500">
			<span class="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
			Cargando recargos…
		</div>
	{:else if error}
		<div class="p-6 text-sm text-red-600">No se pudieron cargar los recargos: {error}</div>
	{:else if ordenado.length === 0}
		<p class="p-10 text-center text-sm text-slate-400">
			Aún no hay recargos. Crea el primero con «Nuevo recargo» para que aparezca en el formulario de pedidos.
		</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-left text-sm">
				<thead>
					<tr class="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase">
						<th class="px-4 py-3">Código</th>
						<th class="px-4 py-3">Nombre</th>
						<th class="px-4 py-3">Tipo</th>
						<th class="px-4 py-3 text-right">Valor</th>
						<th class="hidden px-4 py-3 lg:table-cell">Descripción</th>
						<th class="px-4 py-3">Estado</th>
						<th class="px-4 py-3 text-right">Acciones</th>
					</tr>
				</thead>
				<tbody>
					{#each ordenado as r (r.codigo)}
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
									<input type="number" min="0" step="500" bind:value={editandoRecargo.valor} class="input w-28 text-right" />
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
										<button
											type="button"
											onclick={() => guardarEdicion(r)}
											disabled={guardando[r.codigo]}
											class="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
										>
											{guardando[r.codigo] ? 'Guardando…' : 'Guardar'}
										</button>
										<button
											type="button"
											onclick={() => cancelarEdicion(r.codigo)}
											class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
										>
											Cancelar
										</button>
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
								<td class="hidden max-w-xs truncate px-4 py-3 text-slate-500 lg:table-cell">
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
										{r.activo ? 'Activo' : 'Inactivo'}
									</button>
								</td>
								<td class="px-4 py-3 text-right">
									<div class="inline-flex gap-1.5">
										<button
											type="button"
											onclick={() => empezarEdicion(r)}
											class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-primary hover:bg-primary-light hover:text-primary-dark"
										>
											Editar
										</button>
										<button
											type="button"
											onclick={() => eliminar(r)}
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
		border-color: rgb(23 104 255);
		box-shadow: 0 0 0 3px rgb(23 104 255 / 0.25);
	}
</style>
