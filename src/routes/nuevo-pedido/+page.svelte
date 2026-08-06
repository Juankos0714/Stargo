<script lang="ts">
	import SearchSelect, { type SearchItem } from '$lib/components/SearchSelect.svelte';
	import { api } from '$lib/api';
	import Logo from '$lib/components/Logo.svelte';
	import { formatearPeso, type Barrio, type Zona } from '$lib/types';

	let barrios = $state<Barrio[]>([]);
	let zonas = $state<Zona[]>([]);
	let cargando = $state(true);
	let errorCarga = $state<string | null>(null);

	let origen = $state<string | null>(null);
	let dirOrigen = $state('');
	let destino = $state<string | null>(null);
	let dirDestino = $state('');
	let observaciones = $state('');

	let precio = $state<{ valor: number | null; meta: Record<string, unknown> } | null>(null);
	let calculando = $state(false);
	let calcId = 0;

	let confirmando = $state(false);
	let error = $state<string | null>(null);
	let creado = $state<{
		pedido_id: string;
		numero: string;
		tarifa_base: number;
		estado: string;
		zona_origen?: string | null;
		zona_destino?: string | null;
	} | null>(null);

	const itemsBarrios = $derived<SearchItem[]>(
		barrios.map((b) => ({
			id: b.id,
			label: b.nombre,
			detalle: zonas.find((z) => z.id === b.zona_id)?.nombre ?? 'Sin zona asignada'
		}))
	);

	const nombreZona = $derived.by(() => {
		const mapa = new Map(zonas.map((z) => [z.id, z.nombre]));
		return (id: string) => mapa.get(id) ?? id;
	});

	const puedeConfirmar = $derived(
		precio?.meta?.disponible === true && dirOrigen.trim().length > 0 && dirDestino.trim().length > 0 && !confirmando
	);

	async function cargar() {
		cargando = true;
		const [rBarrios, rZonas] = await Promise.all([
			api.get<Barrio[]>('/api/barrios?select=id,nombre,zona_id&orden=nombre'),
			api.get<Zona[]>('/api/zonas?select=id,nombre,tipo')
		]);
		if (rBarrios.error) errorCarga = rBarrios.error;
		else barrios = rBarrios.data ?? [];
		if (rZonas.error && !rBarrios.error) errorCarga = rZonas.error;
		else zonas = rZonas.data ?? [];
		cargando = false;
	}

	async function calcular() {
		if (!origen || !destino) return;
		const id = ++calcId;
		calculando = true;
		const r = await api.post<{ valor: number | null; meta: Record<string, unknown> }>('/api/calcular_tarifa', {
			barrio_origen: origen,
			barrio_destino: destino
		});
		if (id !== calcId) return;
		calculando = false;
		if (r.error) {
			precio = null;
			error = r.error;
			return;
		}
		precio = { valor: r.data?.valor ?? null, meta: r.data?.meta ?? {} };
		error = null;
	}

	async function confirmar(e: SubmitEvent) {
		e.preventDefault();
		if (!puedeConfirmar || !origen || !destino) return;
		confirmando = true;
		error = null;
		const r = await api.post<typeof creado>('/api/pedidos', {
			barrio_origen: origen,
			direccion_origen: dirOrigen,
			barrio_destino: destino,
			direccion_destino: dirDestino,
			observaciones: observaciones || undefined
		});
		confirmando = false;
		if (r.error) {
			error = r.error;
			return;
		}
		creado = r.data;
	}

	function reiniciar() {
		creado = null;
		origen = null;
		destino = null;
		dirOrigen = '';
		dirDestino = '';
		observaciones = '';
		precio = null;
		error = null;
	}

	$effect(() => {
		cargar();
	});

	$effect(() => {
		if (origen && destino) calcular();
	});
</script>

<svelte:head>
	<title>Nuevo pedido — StarGo</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-b from-slate-50 via-primary-light/40 to-slate-50">
	<header class="border-b border-slate-200/70 bg-white/80 backdrop-blur">
		<div class="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
			<a href="/" class="flex items-center">
				<Logo type="full" surface="light" height={32} priority />
			</a>
			<nav class="flex items-center gap-3 text-sm">
				<a href="/consultar-estado" class="font-medium text-slate-500 transition hover:text-primary">Consultar estado</a>
			</nav>
		</div>
	</header>

	<main class="mx-auto max-w-3xl px-6 py-12">
		{#if creado}
			<!-- Confirmación -->
			<div class="mx-auto max-w-lg rounded-2xl border border-success/30 bg-white p-8 text-center shadow-lg">
				<div class="mx-auto flex size-16 items-center justify-center rounded-full bg-success text-white shadow-lg shadow-slate-900/10">
					<svg class="size-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
						<path d="M20 6 9 17l-5-5" />
					</svg>
				</div>
				<h1 class="mt-5 text-2xl font-extrabold tracking-tight text-slate-900">¡Pedido confirmado!</h1>
				<p class="mt-2 text-sm text-slate-500">Guarda tu código para consultar el estado del pedido:</p>
				<p class="mt-4 inline-block rounded-xl border-2 border-dashed border-success bg-green-50 px-6 py-3 font-mono text-3xl font-black tracking-widest text-green-700">
					{creado.numero}
				</p>
				<div class="mt-6 space-y-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
					<p class="flex justify-between">
						<span>Tarifa</span>
						<span class="font-bold text-slate-900">{formatearPeso(creado.tarifa_base)}</span>
					</p>
					<p class="flex justify-between">
						<span>Estado</span>
						<span class="inline-flex rounded-full border border-amber-200 bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Pendiente</span>
					</p>
				</div>
				<div class="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
					<a
						href="/consultar-estado?numero={creado.numero}"
						class="rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-dark"
					>
						Consultar estado
					</a>
					<button
						type="button"
						onclick={reiniciar}
						class="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
					>
						Crear otro pedido
					</button>
				</div>
			</div>
		{:else}
			<div class="text-center">
				<h1 class="text-3xl font-extrabold tracking-tight text-slate-900">Hacer un pedido</h1>
				<p class="mt-2 text-slate-500">La tarifa se calcula automáticamente al seleccionar los barrios.</p>
			</div>

			{#if cargando}
				<div class="mt-10 flex items-center justify-center gap-3 py-16 text-slate-500">
					<span class="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
					Cargando barrios…
				</div>
			{:else if errorCarga}
				<div class="mt-10 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
					No se pudieron cargar los barrios: {errorCarga}
				</div>
			{:else}
				<form class="mt-8 space-y-6" onsubmit={confirmar}>
					<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
						<h2 class="mb-4 flex items-center gap-2 text-sm font-bold tracking-wide text-slate-500 uppercase">
							<span class="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">1</span>
							Origen
						</h2>
						<div class="grid gap-4 sm:grid-cols-2">
							<div>
								<label for="ped-origen" class="mb-1.5 block text-sm font-semibold text-slate-700">Barrio de origen</label>
								<SearchSelect
									id="ped-origen"
									items={itemsBarrios}
									value={origen}
									onchange={(id) => (origen = id)}
									placeholder="Ej: Barrio La Rivera…"
								/>
							</div>
							<div>
								<label for="dir-origen" class="mb-1.5 block text-sm font-semibold text-slate-700">Dirección</label>
								<input
									id="dir-origen"
									type="text"
									bind:value={dirOrigen}
									placeholder="Calle 10 # 15-20, Apto 301"
									class="w-full rounded-xl border border-slate-300 bg-white min-h-11 px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
								/>
							</div>
						</div>
					</div>

					<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
						<h2 class="mb-4 flex items-center gap-2 text-sm font-bold tracking-wide text-slate-500 uppercase">
							<span class="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">2</span>
							Destino
						</h2>
						<div class="grid gap-4 sm:grid-cols-2">
							<div>
								<label for="ped-destino" class="mb-1.5 block text-sm font-semibold text-slate-700">Barrio de destino</label>
								<SearchSelect
									id="ped-destino"
									items={itemsBarrios}
									value={destino}
									onchange={(id) => (destino = id)}
									placeholder="Ej: Mall Privilegio…"
								/>
							</div>
							<div>
								<label for="dir-destino" class="mb-1.5 block text-sm font-semibold text-slate-700">Dirección</label>
								<input
									id="dir-destino"
									type="text"
									bind:value={dirDestino}
									placeholder="Carrera 19 # 20-30"
									class="w-full rounded-xl border border-slate-300 bg-white min-h-11 px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
								/>
							</div>
						</div>
					</div>

					<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
						<h2 class="mb-4 text-sm font-bold tracking-wide text-slate-500 uppercase">Observaciones <span class="font-normal normal-case text-slate-400">(opcional)</span></h2>
						<textarea
							bind:value={observaciones}
							rows="3"
							placeholder="Ej: entregar en portería, llamar al llegar…"
							class="w-full rounded-xl border border-slate-300 bg-white min-h-11 px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
						></textarea>
					</div>

					<div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
						<div class="flex items-center justify-between gap-4">
							<div>
								<p class="text-xs font-semibold tracking-wide text-slate-500 uppercase">Tarifa del trayecto</p>
								{#if !origen || !destino}
									<p class="mt-1 text-sm text-slate-400">Selecciona ambos barrios para ver el precio.</p>
								{:else if calculando}
									<p class="mt-1 flex items-center gap-2 text-sm text-slate-500">
										<span class="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
										Calculando…
									</p>
								{:else if precio?.meta?.disponible}
									<p class="mt-1 text-3xl font-extrabold tracking-tight text-slate-900">{formatearPeso(precio?.valor)}</p>
									<p class="mt-0.5 text-xs text-slate-500">
										{nombreZona(String(precio?.meta?.zona_origen))} → {nombreZona(String(precio?.meta?.zona_destino))}
									</p>
								{:else}
									<p class="mt-1 text-sm font-medium text-red-600">
										No disponible: este trayecto no tiene tarifa o pasa por una zona sin servicio.
									</p>
								{/if}
							</div>
							{#if calculando}
								<span class="size-8 animate-spin rounded-full border-[3px] border-primary border-t-transparent"></span>
							{/if}
						</div>

						{#if error}
							<div class="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
						{/if}

						<button
							type="submit"
							disabled={!puedeConfirmar}
							class="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-slate-900/10 transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
						>
							{#if confirmando}
								<span class="size-4 animate-spin rounded-full border-2 border-white/50 border-t-white"></span>
								Confirmando…
							{:else}
								Confirmar pedido
							{/if}
						</button>
						{#if !puedeConfirmar && origen && destino}
							<p class="mt-2 text-center text-xs text-slate-400">
								{!precio?.meta?.disponible
									? 'No se puede confirmar sin una tarifa disponible.'
									: 'Completa las direcciones de origen y destino para confirmar.'}
							</p>
						{/if}
					</div>
				</form>
			{/if}
		{/if}
	</main>
</div>
