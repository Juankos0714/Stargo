<script lang="ts">
	import SearchSelect, { type SearchItem } from '$lib/components/SearchSelect.svelte';
	import { api } from '$lib/api';
	import Icon from '$lib/components/Icon.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import { etiquetaTipoRecargo, formatearPeso, type Barrio, type Recargo, type Zona } from '$lib/types';
	import { calcularRecargos } from '$lib/logic/recargos';
	import { validarPedido } from '$lib/logic/validacion';

	let barrios = $state<Barrio[]>([]);
	let zonas = $state<Zona[]>([]);
	let recargos = $state<Recargo[]>([]);
	let cargando = $state(true);
	let errorCarga = $state<string | null>(null);

	let origen = $state<string | null>(null);
	let dirOrigen = $state('');
	let destino = $state<string | null>(null);
	let dirDestino = $state('');
	let observaciones = $state('');
	let recargosSel = $state<string[]>([]);
	let errores = $state<Record<string, string>>({});

	let precio = $state<{ valor: number | null; meta: Record<string, unknown> } | null>(null);
	let calculando = $state(false);
	let calcId = 0;

	let confirmando = $state(false);
	let error = $state<string | null>(null);
	let creado = $state<{
		pedido_id: string;
		numero: string;
		tarifa_base: number;
		recargos?: { codigo: string; nombre: string; valor: number }[] | null;
		recargo_total?: number;
		total?: number | null;
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

	// ---------- Recargos (Fase 7) ----------
	const recargosActivos = $derived(
		recargos
			.filter((r) => r.activo)
			.sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nombre.localeCompare(b.nombre, 'es'))
	);

	const grupos = $derived.by(() => {
		const m = new Map<string, Recargo[]>();
		for (const r of recargosActivos) {
			const arr = m.get(r.tipo) ?? [];
			arr.push(r);
			m.set(r.tipo, arr);
		}
		return [...m.entries()].map(([tipo, items]) => ({ tipo, label: etiquetaTipoRecargo(tipo), items }));
	});

	const calculoRecargos = $derived(calcularRecargos(recargosActivos, recargosSel));
	const recargosAplicados = $derived(calculoRecargos.aplicados);
	const recargoTotal = $derived(calculoRecargos.total);
	const totalEstimado = $derived(
		precio?.meta?.disponible === true && precio?.valor != null ? precio.valor + recargoTotal : null
	);

	// El botón se habilita con la tarifa disponible; la validación de campos
	// se dispara al confirmar y muestra errores por campo (Fase 7).
	const puedeConfirmar = $derived(precio?.meta?.disponible === true && !confirmando);

	function validar(): boolean {
		errores = validarPedido({
			barrioOrigen: origen,
			barrioDestino: destino,
			direccionOrigen: dirOrigen,
			direccionDestino: dirDestino,
			observaciones,
			recargos: recargosSel
		});
		return Object.keys(errores).length === 0;
	}

	async function cargar() {
		cargando = true;
		const [rBarrios, rZonas, rRecargos] = await Promise.all([
			api.get<Barrio[]>('/api/barrios?select=id,nombre,zona_id&orden=nombre'),
			api.get<Zona[]>('/api/zonas?select=id,nombre,tipo'),
			api.get<Recargo[]>('/api/recargos?select=*')
		]);
		if (rBarrios.error) errorCarga = rBarrios.error;
		else barrios = rBarrios.data ?? [];
		if (rZonas.error && !rBarrios.error) errorCarga = rZonas.error;
		else zonas = rZonas.data ?? [];
		if (!rRecargos.error) recargos = rRecargos.data ?? [];
		cargando = false;
	}

	async function calcular() {
		if (!origen || !destino) return;
		const id = ++calcId;
		calculando = true;
		// El endpoint responde { data: <número>, meta: {...} }: `data` es la tarifa
		// y `meta` trae disponible/motivo/barrios/zonas.
		const r = await api.post<number>('/api/calcular_tarifa', {
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
		precio = { valor: r.data, meta: r.meta ?? {} };
		error = null;
	}

	async function confirmar(e: SubmitEvent) {
		e.preventDefault();
		if (!puedeConfirmar || !origen || !destino) return;
		if (!validar()) return;
		confirmando = true;
		error = null;
		const r = await api.post<typeof creado>('/api/pedidos', {
			barrio_origen: origen,
			direccion_origen: dirOrigen,
			barrio_destino: destino,
			direccion_destino: dirDestino,
			observaciones: observaciones || undefined,
			recargos: recargosSel
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
		recargosSel = [];
		errores = {};
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
					<Icon name="check" class="size-8" />
				</div>
				<h1 class="mt-5 text-2xl font-extrabold tracking-tight text-slate-900">¡Pedido confirmado!</h1>
				<p class="mt-2 text-sm text-slate-500">Guarda tu código para consultar el estado del pedido:</p>
				<p
					data-testid="codigo-pedido"
					class="mt-4 inline-block rounded-xl border-2 border-dashed border-success bg-green-50 px-6 py-3 font-mono text-3xl font-black tracking-widest text-green-700"
				>
					{creado.numero}
				</p>
				<div class="mt-6 space-y-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
					<p class="flex justify-between">
						<span>Tarifa base</span>
						<span class="font-bold text-slate-900">{formatearPeso(creado.tarifa_base)}</span>
					</p>
					{#each creado.recargos ?? [] as r (r.codigo)}
						<p class="flex justify-between">
							<span class="text-left">{r.nombre}</span>
							<span class="font-semibold text-slate-800">{formatearPeso(r.valor)}</span>
						</p>
					{/each}
					<p class="flex justify-between border-t border-slate-200 pt-2">
						<span class="font-semibold">Total</span>
						<span class="font-extrabold text-slate-900">
							{formatearPeso(creado.total ?? (creado.tarifa_base + (creado.recargo_total ?? 0)))}
						</span>
					</p>
					<p class="flex justify-between">
						<span>Estado</span>
						<span class="inline-flex rounded-full border border-amber-200 bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Pendiente</span>
					</p>
				</div>
				<p class="mt-4 flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-xs text-amber-800">
					<Icon name="triangle-exclamation" class="mt-0.5 size-3.5 shrink-0" />
					<span>Este valor es un estimado: el precio final lo confirma el domiciliario según el servicio que realmente realice.</span>
				</p>
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
				<form class="mt-8 space-y-6" onsubmit={confirmar} novalidate>
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
								{#if errores.origen}
									<p class="mt-1 text-xs text-red-600">{errores.origen}</p>
								{/if}
							</div>
							<div>
								<label for="dir-origen" class="mb-1.5 block text-sm font-semibold text-slate-700">Dirección</label>
								<input
									id="dir-origen"
									type="text"
									bind:value={dirOrigen}
									maxlength="300"
									placeholder="Calle 10 # 15-20, Apto 301"
									class="w-full rounded-xl border px-4 py-2.5 text-sm shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 bg-white text-slate-900 {errores.dirOrigen ? 'border-red-400' : 'border-slate-300'}"
								/>
								{#if errores.dirOrigen}
									<p class="mt-1 text-xs text-red-600">{errores.dirOrigen}</p>
								{/if}
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
								{#if errores.destino}
									<p class="mt-1 text-xs text-red-600">{errores.destino}</p>
								{/if}
							</div>
							<div>
								<label for="dir-destino" class="mb-1.5 block text-sm font-semibold text-slate-700">Dirección</label>
								<input
									id="dir-destino"
									type="text"
									bind:value={dirDestino}
									maxlength="300"
									placeholder="Carrera 19 # 20-30"
									class="w-full rounded-xl border px-4 py-2.5 text-sm shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 bg-white text-slate-900 {errores.dirDestino ? 'border-red-400' : 'border-slate-300'}"
								/>
								{#if errores.dirDestino}
									<p class="mt-1 text-xs text-red-600">{errores.dirDestino}</p>
								{/if}
							</div>
						</div>
					</div>

					<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
						<h2 class="mb-1 flex items-center gap-2 text-sm font-bold tracking-wide text-slate-500 uppercase">
							<span class="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">3</span>
							Recargos <span class="font-normal normal-case text-slate-400">(opcional)</span>
						</h2>
						<p class="mb-4 ml-7 text-xs text-slate-400">
							Marca lo que aplica a tu pedido: compras, espera, paradas, peso o método de pago.
						</p>
						{#if recargosActivos.length === 0}
							<p class="text-sm text-slate-400">No hay recargos configurados por el momento.</p>
						{:else}
							<div class="grid gap-5 sm:grid-cols-2">
								{#each grupos as g (g.tipo)}
									<fieldset>
										<legend class="text-xs font-bold tracking-wide text-slate-500 uppercase">{g.label}</legend>
										<div class="mt-2 space-y-2">
											{#each g.items as r (r.codigo)}
												<label
													class="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-primary-light/40"
												>
													<input type="checkbox" value={r.codigo} bind:group={recargosSel} class="mt-1 size-4 accent-[#1768FF]" />
													<span class="min-w-0 flex-1">
														<span class="block text-sm font-semibold text-slate-800">{r.nombre}</span>
														{#if r.descripcion}
															<span class="block text-xs text-slate-500">{r.descripcion}</span>
														{/if}
													</span>
													<span class="shrink-0 text-sm font-bold text-slate-900">{formatearPeso(r.valor)}</span>
												</label>
											{/each}
										</div>
									</fieldset>
								{/each}
							</div>
						{/if}
						{#if errores.recargos}
							<p class="mt-2 text-xs text-red-600">{errores.recargos}</p>
						{/if}
					</div>

					<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
						<h2 class="mb-4 text-sm font-bold tracking-wide text-slate-500 uppercase">Observaciones <span class="font-normal normal-case text-slate-400">(opcional)</span></h2>
						<textarea
							bind:value={observaciones}
							rows="3"
							maxlength="1000"
							placeholder="Ej: entregar en portería, llamar al llegar…"
							class="w-full rounded-xl border border-slate-300 bg-white min-h-11 px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
						></textarea>
						{#if errores.observaciones}
							<p class="mt-1 text-xs text-red-600">{errores.observaciones}</p>
						{/if}
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
									<p class="mt-1 text-3xl font-extrabold tracking-tight text-slate-900">{formatearPeso(totalEstimado)}</p>
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

						{#if precio?.meta?.disponible && recargosAplicados.length > 0}
							<div class="mt-4 space-y-1.5 rounded-xl bg-white p-4 text-sm shadow-sm">
								<p class="flex justify-between text-slate-600">
									<span>Tarifa base</span>
									<span class="font-semibold text-slate-900">{formatearPeso(precio?.valor)}</span>
								</p>
								{#each recargosAplicados as r (r.codigo)}
									<p class="flex justify-between text-slate-600">
										<span>{r.nombre}</span>
										<span class="font-semibold text-slate-800">{formatearPeso(r.valor)}</span>
									</p>
								{/each}
								<p class="flex justify-between border-t border-slate-200 pt-1.5 font-bold text-slate-900">
									<span>Total estimado</span>
									<span>{formatearPeso(totalEstimado)}</span>
								</p>
							</div>
						{/if}

						{#if precio?.meta?.disponible}
							<div class="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
								<Icon name="triangle-exclamation" class="mt-0.5 size-3.5 shrink-0" />
								<span>
									Este es un <strong>estimado</strong>: el precio final lo confirma el domiciliario según el servicio real que realice
									(compras, peso, paradas, espera, método de pago, etc.).
								</span>
							</div>
						{/if}

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
						{#if !precio?.meta?.disponible && origen && destino}
							<p class="mt-2 text-center text-xs text-slate-400">No se puede confirmar sin una tarifa disponible.</p>
						{/if}
					</div>
				</form>
			{/if}
		{/if}
	</main>
</div>
