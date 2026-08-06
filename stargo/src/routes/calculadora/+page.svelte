<script lang="ts">
	import SearchSelect, { type SearchItem } from '$lib/components/SearchSelect.svelte';
	import { api } from '$lib/api';
	import { formatearPeso, type Barrio, type Zona } from '$lib/types';

	let barrios = $state<Barrio[]>([]);
	let zonas = $state<Zona[]>([]);
	let origen = $state<string | null>(null);
	let destino = $state<string | null>(null);
	let cargando = $state(true);
	let errorCarga = $state<string | null>(null);
	let calculando = $state(false);
	let error = $state<string | null>(null);
	let resultado = $state<{ valor: number | null; meta: Record<string, unknown> } | null>(null);
	let calculado = $state(false);
	let calcId = 0;

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
		error = null;
		calculado = false;
		const r = await api.post<{ valor: number | null; meta: Record<string, unknown> }>(
			'/api/calcular_tarifa',
			{ barrio_origen: origen, barrio_destino: destino }
		);
		// Ignorar respuestas obsoletas si el usuario cambió los barrios.
		if (id !== calcId) return;
		calculando = false;
		if (r.error) {
			error = r.error;
			resultado = null;
			return;
		}
		resultado = { valor: r.data?.valor ?? null, meta: r.data?.meta ?? {} };
		calculado = true;
	}

	function intercambiar() {
		const tmp = origen;
		origen = destino;
		destino = tmp;
	}

	$effect(() => {
		cargar();
	});

	// Auto-cálculo cuando ambos barrios están seleccionados.
	$effect(() => {
		if (origen && destino) calcular();
	});

	const meta = $derived(resultado?.meta ?? {});
	const disponible = $derived(meta.disponible === true);
	const motivo = $derived(String(meta.motivo ?? ''));
</script>

<svelte:head>
	<title>Calculadora — StarGo</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-b from-slate-50 via-emerald-50/40 to-slate-50">
	<header class="border-b border-slate-200/70 bg-white/80 backdrop-blur">
		<div class="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
			<a href="/" class="flex items-center gap-2.5">
				<div class="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500">
					<svg class="size-4.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M5 11 4 4h4l3 7" />
						<path d="M5 11h14l1 3H6" />
						<circle cx="6" cy="17" r="1.5" />
						<circle cx="17" cy="17" r="1.5" />
					</svg>
				</div>
				<span class="font-bold tracking-tight text-slate-900">StarGo</span>
			</a>
			<a href="/admin" class="text-sm font-medium text-slate-500 transition hover:text-emerald-600">Admin →</a>
		</div>
	</header>

	<main class="mx-auto max-w-3xl px-6 py-12">
		<div class="text-center">
			<h1 class="text-3xl font-extrabold tracking-tight text-slate-900">Calculadora de tarifas</h1>
			<p class="mt-2 text-slate-500">Selecciona el barrio de origen y destino para ver el precio del domicilio.</p>
		</div>

		<div class="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-8">
			{#if cargando}
				<div class="flex items-center justify-center gap-3 py-16 text-slate-500">
					<span class="size-5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" ></span>
					Cargando barrios…
				</div>
			{:else if errorCarga}
				<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
					No se pudieron cargar los barrios: {errorCarga}
				</div>
			{:else}
				<div class="grid items-end gap-5 sm:grid-cols-[1fr_auto_1fr]">
					<div>
						<label for="origen" class="mb-1.5 block text-sm font-semibold text-slate-700">Barrio de origen</label>
						<SearchSelect
							id="origen"
							items={itemsBarrios}
							value={origen}
							onchange={(id) => (origen = id)}
							placeholder="Ej: Centro, Barrio La Rivera…"
						/>
					</div>

					<button
						type="button"
						onclick={intercambiar}
						title="Intercambiar origen y destino"
						aria-label="Intercambiar origen y destino"
						class="mx-auto flex size-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-emerald-400 hover:text-emerald-600 active:scale-95"
					>
						<svg class="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="m17 2 4 4-4 4M21 6H3M7 22l-4-4 4-4M3 18h18" />
						</svg>
					</button>

					<div>
						<label for="destino" class="mb-1.5 block text-sm font-semibold text-slate-700">Barrio de destino</label>
						<SearchSelect
							id="destino"
							items={itemsBarrios}
							value={destino}
							onchange={(id) => (destino = id)}
							placeholder="Ej: Mall Privilegio, Alfonso López…"
						/>
					</div>
				</div>

				{#if error}
					<div class="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
				{/if}

				<div class="mt-7 min-h-36 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-6">
					{#if !calculado}
						<p class="flex items-center gap-2 text-sm text-slate-400">
							<svg class="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<circle cx="12" cy="12" r="10" />
								<path d="M12 16v-4M12 8h.01" />
							</svg>
							Selecciona ambos barrios para calcular la tarifa automáticamente.
						</p>
					{:else if disponible}
						<div class="flex flex-col items-center gap-1.5 text-center">
							<span class="text-xs font-semibold tracking-wide text-emerald-600 uppercase">Tarifa {String(meta.zona_origen)} → {String(meta.zona_destino)}</span>
							<span class="text-5xl font-extrabold tracking-tight text-slate-900">{formatearPeso(resultado?.valor)}</span>
							<p class="mt-2 text-sm text-slate-500">
								{String(meta.barrio_origen)} <span class="text-slate-300">·</span> {nombreZona(String(meta.zona_origen))}
								<br />
								{String(meta.barrio_destino)} <span class="text-slate-300">·</span> {nombreZona(String(meta.zona_destino))}
							</p>
						</div>
					{:else}
						<div class="flex flex-col items-center gap-1.5 text-center">
							<span class="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
								<svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />
								</svg>
								{#if motivo === 'zona_no_disponible'}
									Zona no disponible
								{:else if motivo === 'sin_tarifa'}
									Sin tarifa definida
								{:else}
									Barrio no encontrado
								{/if}
							</span>
							<p class="mt-2 max-w-md text-sm text-slate-500">
								{#if motivo === 'zona_no_disponible'}
									Este trayecto pasa por una zona donde el servicio de domicilio no está disponible.
								{:else if motivo === 'sin_tarifa'}
									Aún no hay un precio definido para {String(meta.zona_origen)} → {String(meta.zona_destino)}.
								{:else}
									No se encontraron los barrios seleccionados.
								{/if}
							</p>
						</div>
					{/if}
					{#if calculando}
						<div class="mt-3 flex justify-center">
							<span class="size-5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" ></span>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<p class="mt-6 text-center text-xs text-slate-400">
			La matriz de tarifas es simétrica: si no existe la tarifa directa, se usa la del sentido inverso.
		</p>
	</main>
</div>
