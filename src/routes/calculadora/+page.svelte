<script lang="ts">
	import SearchSelect, { type SearchItem } from '$lib/components/SearchSelect.svelte';
	import { api } from '$lib/api';
	import Logo from '$lib/components/Logo.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
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
	// El deep-link comparte la selección: /calculadora?origen=<id>&destino=<id>.
	// `deepLinkAplicado` evita que la primera pasada vuelva a escribir la URL.
	let deepLinkAplicado = $state(false);

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
		// El endpoint responde { data: <número>, meta: {...} }: `data` es la tarifa
		// y `meta` trae disponible/motivo/barrios/zonas.
		const r = await api.post<number>('/api/calcular_tarifa', {
			barrio_origen: origen,
			barrio_destino: destino
		});
		// Ignorar respuestas obsoletas si el usuario cambió los barrios.
		if (id !== calcId) return;
		calculando = false;
		if (r.error) {
			error = r.error;
			resultado = null;
			return;
		}
		resultado = { valor: r.data, meta: r.meta ?? {} };
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

	// Deep-link: aplica ?origen=&destino= una vez cargados los barrios (solo si
	// los ids existen) y mantiene la URL sincronizada al cambiar la selección,
	// para que el enlace sea compartible y sobreviva al refresco.
	$effect(() => {
		if (cargando || barrios.length === 0) return;
		const q = page.url.searchParams;
		const o = q.get('origen');
		const d = q.get('destino');
		const existe = (id: string | null) => id !== null && barrios.some((b) => b.id === id);

		if (!deepLinkAplicado && (o || d)) {
			// Primera pasada con deep-link: aplicar los ids de la URL (si existen)
			// o limpiarla si son inválidos. Tras esto se sincroniza normal.
			deepLinkAplicado = true;
			if (!existe(o) && !existe(d)) {
				goto(page.url.pathname, { replaceState: true, keepFocus: true, noScroll: true });
			} else {
				origen = existe(o) ? o : null;
				destino = existe(d) ? d : null;
			}
			return;
		}
		deepLinkAplicado = true;
		// Reflejar la selección del usuario en la URL (shareable) y evitar
		// el loop cuando la URL ya coincide con la selección.
		const params = new URLSearchParams();
		if (origen) params.set('origen', origen);
		if (destino) params.set('destino', destino);
		const qs = params.toString();
		if (page.url.searchParams.toString() !== qs) {
			goto(qs ? `${page.url.pathname}?${qs}` : page.url.pathname, {
				replaceState: true,
				keepFocus: true,
				noScroll: true
			});
		}
	});

	function solicitarPedido() {
		if (!origen || !destino) return;
		const params = new URLSearchParams();
		params.set('origen', origen);
		params.set('destino', destino);
		goto(`/nuevo-pedido?${params.toString()}`);
	}

	const meta = $derived(resultado?.meta ?? {});
	const disponible = $derived(meta.disponible === true);
	const motivo = $derived(String(meta.motivo ?? ''));
</script>

<svelte:head>
	<title>Calculadora — StarGo</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-b from-slate-50 via-primary-light/40 to-slate-50">
	<header class="border-b border-slate-200/70 bg-white/80 backdrop-blur">
		<div class="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
			<a href="/" class="flex items-center">
				<Logo type="full" surface="light" height={32} priority />
			</a>
			<nav class="flex items-center gap-3 text-sm">
				<a href="/nuevo-pedido" class="font-medium text-slate-500 transition hover:text-primary">Hacer un pedido →</a>
				<a href="/consultar-estado" class="font-medium text-slate-500 transition hover:text-primary">Consultar estado</a>
			</nav>
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
					<span class="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" ></span>
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
						class="mx-auto flex size-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-primary hover:text-primary-dark active:scale-95"
					>
						<Icon name="arrows-left-right" class="size-4.5" />
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
							<Icon name="circle-info" class="size-4.5" />
							Selecciona ambos barrios para calcular la tarifa automáticamente.
						</p>
					{:else if disponible}
						<div class="flex flex-col items-center gap-1.5 text-center">
							<span class="text-xs font-semibold tracking-wide text-primary-dark uppercase">Tarifa {String(meta.zona_origen)} → {String(meta.zona_destino)}</span>
							<span class="text-5xl font-extrabold tracking-tight text-slate-900">{formatearPeso(resultado?.valor)}</span>
							<p class="mt-2 text-sm text-slate-500">
								{String(meta.barrio_origen)} <span class="text-slate-300">·</span> {nombreZona(String(meta.zona_origen))}
								<br />
								{String(meta.barrio_destino)} <span class="text-slate-300">·</span> {nombreZona(String(meta.zona_destino))}
							</p>
							<a
								href="/nuevo-pedido?origen={origen}&destino={destino}"
								class="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-slate-900/10 transition hover:bg-primary-dark"
							>
								Solicitar este domicilio
								<Icon name="arrow-right" class="size-4" />
							</a>
						</div>
					{:else}
						<div class="flex flex-col items-center gap-1.5 text-center">
							<span class="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">									<Icon name="triangle-exclamation" class="size-3.5" />
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
							<span class="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" ></span>
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
