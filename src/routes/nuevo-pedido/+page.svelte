<script lang="ts">
	import SearchSelect, { type SearchItem } from '$lib/components/SearchSelect.svelte';
	import { api } from '$lib/api';
	import Icon from '$lib/components/Icon.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import {
		etiquetaTipoRecargo,
		etiquetaTipoServicio,
		formatearPeso,
		type Barrio,
		type Recargo,
		type TipoServicio,
		type Zona
	} from '$lib/types';
	import { calcularRecargos } from '$lib/logic/recargos';
	import { validarPedido } from '$lib/logic/validacion';
	import { page } from '$app/state';
	import type { HorarioHoy } from '$lib/types';

	let horario = $state<HorarioHoy | null>(null);
	let barrios = $state<Barrio[]>([]);
	let zonas = $state<Zona[]>([]);
	let recargos = $state<Recargo[]>([]);
	let cargando = $state(true);
	let errorCarga = $state<string | null>(null);

	// ---------- Tipo de servicio (Fase 14) ----------
	let tipoServicio = $state<TipoServicio>('domicilio');
	// Preguntas guiadas de compra/diligencia: qué diligencia y si se recoge antes.
	const TIPOS_DILIGENCIA = [
		{
			valor: 'pago',
			label: 'Pago de factura o servicio',
			desc: 'Pagar un recibo, factura o servicio en un punto de pago.'
		},
		{
			valor: 'banco',
			label: 'Pago bancario o corresponsal',
			desc: 'Consignar o pagar en el banco o corresponsal.'
		},
		{
			valor: 'compra',
			label: 'Compra de productos',
			desc: 'Mercado, medicamentos, encargos en tiendas.'
		},
		{
			valor: 'tramite',
			label: 'Trámite o documento',
			desc: 'Radicar, reclamar o entregar papeles.'
		},
		{
			valor: 'otro',
			label: 'Otra diligencia',
			desc: 'Cualquier otro encargo.'
		}
	];
	let tipoDiligencia = $state('');
	let necesitaRecoger = $state<boolean | null>(null);

	let origen = $state<string | null>(null);
	let dirOrigen = $state('');
	let destino = $state<string | null>(null);
	let dirDestino = $state('');
	let observaciones = $state('');
	let recargosSel = $state<string[]>([]);
	let recargosConfirmadosNoAplica = $state(false);
	// Contacto del cliente (Fase 19): el celular es obligatorio y el nombre opcional.
	let nombreCliente = $state('');
	let telefono = $state('');
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
		tipo_servicio?: TipoServicio;
	} | null>(null);

	// En compra/diligencia el origen se pide solo si se debe recoger algo antes.
	const mostrarOrigen = $derived(tipoServicio === 'domicilio' || necesitaRecoger === true);
	const origenRequerido = $derived(tipoServicio === 'domicilio' || necesitaRecoger === true);

	// Decisión explícita de recargos: elegir alguno o marcar «No aplica».
	const recargosDecididos = $derived(recargosSel.length > 0 || recargosConfirmadosNoAplica);

	// Marcar un recargo desmarca «No aplica» (y al revés en el onchange propio).
	function desmarcarNoAplica() {
		recargosConfirmadosNoAplica = false;
	}

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

	// ---------- Recargos (Fase 7 + 16) ----------
	// En un Domicilio normal los recargos de tipo «compra» no aplican (son de
	// compras/diligencias): se ocultan para simplificar el proceso. En
	// Compra/diligencia se ofrecen todos.
	const recargosActivos = $derived(
		recargos
			.filter((r) => r.activo)
			.sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nombre.localeCompare(b.nombre, 'es'))
	);

	const recargosDisponibles = $derived(
		tipoServicio === 'domicilio'
			? recargosActivos.filter((r) => r.tipo !== 'compra')
			: recargosActivos
	);

	const grupos = $derived.by(() => {
		const m = new Map<string, Recargo[]>();
		for (const r of recargosDisponibles) {
			const arr = m.get(r.tipo) ?? [];
			arr.push(r);
			m.set(r.tipo, arr);
		}
		return [...m.entries()].map(([tipo, items]) => ({ tipo, label: etiquetaTipoRecargo(tipo), items }));
	});

	const calculoRecargos = $derived(calcularRecargos(recargosDisponibles, recargosSel));
	const recargosAplicados = $derived(calculoRecargos.aplicados);
	const recargoTotal = $derived(calculoRecargos.total);
	const precioDisponible = $derived(precio?.meta?.disponible === true && precio?.valor != null);
	// Con ruta completa (origen+destino) el estimado incluye la tarifa; sin
	// ella (compra/diligencia solo con destino) va solo el total de recargos.
	const totalEstimado = $derived(precioDisponible ? (precio?.valor ?? 0) + recargoTotal : recargoTotal);
	const tieneRutaCompleta = $derived(Boolean(origen && destino));

	// El botón se habilita con la tarifa disponible (domicilio) o con destino y
	// decisión de recargos (compra/diligencia); la validación de campos se
	// dispara al confirmar y muestra errores por campo.
	const puedeConfirmar = $derived(
		!confirmando &&
			(tipoServicio === 'domicilio'
				? precioDisponible
				: Boolean(destino) && recargosDecididos)
	);

	function validar(): boolean {
		errores = validarPedido({
			barrioOrigen: origenRequerido ? origen : null,
			barrioDestino: destino,
			direccionOrigen: origenRequerido ? dirOrigen : '',
			direccionDestino: dirDestino,
			observaciones,
			recargos: recargosSel,
			tipoServicio,
			recargosConfirmadosNoAplica,
			telefono,
			nombreCliente
		});
		return Object.keys(errores).length === 0;
	}

	async function cargar() {
		cargando = true;
		const [rBarrios, rZonas, rRecargos, rHorario] = await Promise.all([
			api.get<Barrio[]>('/api/barrios?select=id,nombre,zona_id&orden=nombre'),
			api.get<Zona[]>('/api/zonas?select=id,nombre,tipo'),
			api.get<Recargo[]>('/api/recargos?select=*'),
			api.get<HorarioHoy>('/api/horario')
		]);
		if (rBarrios.error) errorCarga = rBarrios.error;
		else barrios = rBarrios.data ?? [];
		if (rZonas.error && !rBarrios.error) errorCarga = rZonas.error;
		else zonas = rZonas.data ?? [];
		if (!rRecargos.error) recargos = rRecargos.data ?? [];
		// El estado del horario es informativo: si no se pudo calcular, el
		// formulario sigue disponible (la BD vuelve a validar al crear).
		if (!rHorario.error) horario = rHorario.data ?? null;
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

	function elegirTipo(tipo: TipoServicio) {
		tipoServicio = tipo;
		// Al cambiar de tipo se limpian los campos que ya no aplican y el precio.
		precio = null;
		error = null;
		if (tipo === 'domicilio') {
			tipoDiligencia = '';
			necesitaRecoger = null;
		}
		if (tipo === 'compra_diligencia' && !mostrarOrigen) {
			origen = null;
			dirOrigen = '';
		}
		// Al volver a Domicilio, se descartan recargos de compra ya elegidos
		// (quedaron seleccionados del modo compra/diligencia).
		if (tipo === 'domicilio') {
			const codigosCompra = new Set(
				recargosActivos.filter((r) => r.tipo === 'compra').map((r) => r.codigo)
			);
			recargosSel = recargosSel.filter((c) => !codigosCompra.has(c));
		}
		errores = {};
	}

	async function confirmar(e: SubmitEvent) {
		e.preventDefault();
		if (!puedeConfirmar) return;
		if (!validar()) return;
		confirmando = true;
		error = null;
		const r = await api.post<typeof creado>('/api/pedidos', {
			barrio_origen: origen,
			direccion_origen: dirOrigen,
			barrio_destino: destino,
			direccion_destino: dirDestino,
		observaciones: observaciones || undefined,
		tipo_servicio: tipoServicio,
		recargos: recargosSel,
		recargos_confirmados_no_aplica: recargosConfirmadosNoAplica,
		nombre_cliente: nombreCliente.trim() || undefined,
		telefono: telefono.trim()
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
		tipoServicio = 'domicilio';
		tipoDiligencia = '';
		necesitaRecoger = null;
		origen = null;
		destino = null;
		dirOrigen = '';
		dirDestino = '';
		observaciones = '';
		recargosSel = [];
		recargosConfirmadosNoAplica = false;
		nombreCliente = '';
		telefono = '';
		errores = {};
		precio = null;
		error = null;
	}

	$effect(() => {
		cargar();
	});

	// Deep-link desde la calculadora: /nuevo-pedido?origen=<id>&destino=<id>
	// preselecciona los barrios apenas se cargan (y la tarifa se calcula sola).
	let deepLinkAplicado = $state(false);
	$effect(() => {
		if (cargando || barrios.length === 0 || deepLinkAplicado) return;
		deepLinkAplicado = true;
		const q = page.url.searchParams;
		const o = q.get('origen');
		const d = q.get('destino');
		const existe = (id: string | null) => id !== null && barrios.some((b) => b.id === id);
		if (existe(o)) origen = o;
		if (existe(d)) destino = d;
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
						<span>Tipo de servicio</span>
						<span class="inline-flex rounded-full border border-primary/30 bg-primary-light px-2.5 py-0.5 text-xs font-semibold text-primary-dark">
							{etiquetaTipoServicio(creado.tipo_servicio)}
						</span>
					</p>
					<p class="flex justify-between">
						<span>{creado.tipo_servicio === 'compra_diligencia' && creado.tarifa_base === 0 ? 'Tarifa (la confirma el domiciliario)' : 'Tarifa base'}</span>
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
				{#if horario?.abierto}
					<p class="mt-2 inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-green-700">
						<Icon name="circle-check" class="size-3.5" />
						Atendemos hoy hasta las {horario.cierre}
					</p>
				{/if}
			</div>

			{#if horario && !horario.abierto}
				<!-- Fuera de horario: la app no recibe pedidos nuevos -->
				<div class="mx-auto mt-10 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center shadow-sm">
					<div class="mx-auto flex size-14 items-center justify-center rounded-full bg-amber-100 text-amber-600">
						<Icon name="clock" class="size-7" />
					</div>
					<h2 class="mt-4 text-xl font-extrabold text-slate-900">Estamos fuera de horario de atención</h2>
					<p class="mt-2 text-sm text-slate-600">
						No se están recibiendo pedidos nuevos en este momento
						{#if horario.fuente === 'excepcion' && horario.motivo} ({horario.motivo}){/if}.
					</p>
					<p class="mt-3 text-sm text-slate-600">
						Horario de hoy: <strong>{horario.apertura} – {horario.cierre}</strong>. Vuelve a intentarlo dentro de ese
						rango o consulta el estado de un pedido ya creado.
					</p>
					<a
						href="/consultar-estado"
						class="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-dark"
					>
						Consultar estado de mi pedido
					</a>
				</div>
			{:else if cargando}
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
					<!-- Paso 0: tipo de servicio (Fase 14) -->
					<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
						<h2 class="mb-1 flex items-center gap-2 text-sm font-bold tracking-wide text-slate-500 uppercase">
							<span class="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">0</span>
							¿Qué necesitas?
						</h2>
						<div class="mt-4 grid gap-3 sm:grid-cols-2">
							<button
								type="button"
								onclick={() => elegirTipo('domicilio')}
								class="rounded-xl border-2 p-4 text-left transition {tipoServicio === 'domicilio'
									? 'border-primary bg-primary-light/40 shadow-sm'
									: 'border-slate-200 hover:border-primary/50'}"
							>
								<span class="flex items-center gap-2 text-sm font-bold text-slate-900">
									<Icon name="truck-fast" class="size-4 text-primary" />
									Domicilio normal
								</span>
								<span class="mt-1 block text-xs text-slate-500">Recoger y entregar entre dos puntos.</span>
							</button>
							<button
								type="button"
									onclick={() => elegirTipo('compra_diligencia')}
								class="rounded-xl border-2 p-4 text-left transition {tipoServicio === 'compra_diligencia'
									? 'border-primary bg-primary-light/40 shadow-sm'
									: 'border-slate-200 hover:border-primary/50'}"
							>
								<span class="flex items-center gap-2 text-sm font-bold text-slate-900">
									<Icon name="cart-shopping" class="size-4 text-primary" />
									Compra / diligencia
								</span>
								<span class="mt-1 block text-xs text-slate-500">Comprar, pagar facturas o hacer trámites.</span>
							</button>
						</div>

						{#if tipoServicio === 'compra_diligencia'}
							<div class="mt-5 rounded-xl border border-primary/20 bg-primary-light/30 p-4">
								<p class="text-xs font-bold tracking-wide text-primary-dark uppercase">Cuéntanos sobre la diligencia</p>

								<fieldset class="mt-3">
									<legend class="text-sm font-semibold text-slate-800">¿Qué tipo de diligencia necesitas?</legend>
									<div class="mt-2 grid gap-2 sm:grid-cols-2">
										{#each TIPOS_DILIGENCIA as td (td.valor)}
											<label
												class="flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition has-[:checked]:border-primary has-[:checked]:bg-white {tipoDiligencia === td.valor ? 'border-primary bg-white' : 'border-slate-200 hover:border-primary/50'}"
											>
												<input
													type="radio"
													name="tipo-diligencia"
													value={td.valor}
													bind:group={tipoDiligencia}
													class="mt-1 size-4 accent-[#1768FF]"
												/>
												<span class="min-w-0">
													<span class="block text-sm font-semibold text-slate-800">{td.label}</span>
													<span class="block text-xs text-slate-500">{td.desc}</span>
												</span>
											</label>
										{/each}
									</div>
								</fieldset>

								<fieldset class="mt-4">
									<legend class="text-sm font-semibold text-slate-800">¿Se debe recoger algo o a alguien antes?</legend>
									<div class="mt-2 flex gap-2">
										<button
											type="button"
											onclick={() => {
												necesitaRecoger = true;
												error = null;
											}}
											class="rounded-xl border-2 px-4 py-2 text-sm font-semibold transition {necesitaRecoger === true ? 'border-primary bg-primary-light text-primary-dark' : 'border-slate-200 text-slate-600 hover:border-primary/50'}"
										>
											Sí, hay recogida
										</button>
										<button
											type="button"
												onclick={() => {
													necesitaRecoger = false;
													origen = null;
													dirOrigen = '';
													errores.origen = '';
													errores.dirOrigen = '';
													error = null;
												}}
											class="rounded-xl border-2 px-4 py-2 text-sm font-semibold transition {necesitaRecoger === false ? 'border-primary bg-primary-light text-primary-dark' : 'border-slate-200 text-slate-600 hover:border-primary/50'}"
										>
											No, solo el destino
										</button>
									</div>
								</fieldset>
							</div>
						{/if}
					</div>

					{#if mostrarOrigen}
					<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
						<h2 class="mb-4 flex items-center gap-2 text-sm font-bold tracking-wide text-slate-500 uppercase">
							<span class="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">1</span>
							{#if tipoServicio === 'compra_diligencia'}Recogida{:else}Origen{/if}
						</h2>
						<div class="grid gap-4 sm:grid-cols-2">								<div>
									<label for="ped-origen" class="mb-1.5 block text-sm font-semibold text-slate-700">
										{#if tipoServicio === 'compra_diligencia'}Barrio de recogida{:else}Barrio de origen{/if}
									</label>
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
							</div>									<div>
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
									</div>						</div>
						</div>
					{/if}

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
					</div>					<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
						<h2 class="mb-1 flex items-center gap-2 text-sm font-bold tracking-wide text-slate-500 uppercase">
							<span class="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">3</span>
							Recargos <span class="font-normal normal-case text-amber-600">(obligatorio)</span>
						</h2>
						<p class="mb-4 ml-7 text-xs text-slate-400">
							{tipoServicio === 'domicilio'
								? 'Marca lo que aplica a tu pedido (peso, espera, paradas o método de pago) o confirma que no aplica.'
								: 'Marca lo que aplica a tu pedido: compras, espera, paradas, peso o método de pago — o confirma que no aplica.'}
						</p>
					{#if recargosDisponibles.length === 0}
						<p class="text-sm text-slate-400">No hay recargos aplicables a este tipo de pedido.</p>
					{:else}
							<label
								class="mb-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 transition hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-primary-light/40"
							>
								<input
									type="checkbox"
									checked={recargosConfirmadosNoAplica}
									onchange={(e) => {
										const marcado = e.currentTarget.checked;
										recargosConfirmadosNoAplica = marcado;
										if (marcado) recargosSel = [];
									}}
									class="mt-1 size-4 accent-[#1768FF]"
								/>
								<span class="min-w-0 flex-1">
									<span class="block text-sm font-semibold text-slate-800">No aplica</span>
									<span class="block text-xs text-slate-500">
										{tipoServicio === 'domicilio'
											? 'Este pedido no tiene peso, esperas, paradas ni pagos especiales.'
											: 'Este pedido no tiene compras, esperas, paradas, peso ni pagos especiales.'}
									</span>
								</span>
							</label>
							<div class="grid gap-5 sm:grid-cols-2">
								{#each grupos as g (g.tipo)}
									<fieldset>
										<legend class="text-xs font-bold tracking-wide text-slate-500 uppercase">{g.label}</legend>
										<div class="mt-2 space-y-2">
											{#each g.items as r (r.codigo)}
												<label
													class="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-primary/50 has-[:checked]:border-primary has-[:checked]:bg-primary-light/40"
												>
													<input
														type="checkbox"
														value={r.codigo}
														bind:group={recargosSel}
														onchange={desmarcarNoAplica}
														class="mt-1 size-4 accent-[#1768FF]"
													/>
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

					<!-- Contacto (Fase 19): el celular es obligatorio para coordinar por WhatsApp -->
					<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
						<h2 class="mb-1 text-sm font-bold tracking-wide text-slate-500 uppercase">Tus datos</h2>
						<p class="mb-4 text-xs text-slate-400">
							El negocio y el domiciliario te contactarán por WhatsApp para coordinar la entrega.
						</p>
						<div class="grid gap-4 sm:grid-cols-2">
							<div>
								<label for="cli-nombre" class="mb-1.5 block text-sm font-semibold text-slate-700">
									Nombre <span class="font-normal text-slate-400">(opcional)</span>
								</label>
								<input
									id="cli-nombre"
									type="text"
									bind:value={nombreCliente}
									maxlength="120"
									placeholder="Ej: Ana María"
									class="w-full rounded-xl border px-4 py-2.5 text-sm shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 bg-white text-slate-900 {errores.nombreCliente ? 'border-red-400' : 'border-slate-300'}"
								/>
								{#if errores.nombreCliente}
									<p class="mt-1 text-xs text-red-600">{errores.nombreCliente}</p>
								{/if}
							</div>
							<div>
								<label for="cli-telefono" class="mb-1.5 block text-sm font-semibold text-slate-700">
									Celular <span class="font-normal text-amber-600">(obligatorio)</span>
								</label>
								<input
									id="cli-telefono"
									type="tel"
									inputmode="numeric"
									bind:value={telefono}
									maxlength="20"
									placeholder="300 123 4567"
									class="w-full rounded-xl border px-4 py-2.5 text-sm shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 bg-white text-slate-900 {errores.telefono ? 'border-red-400' : 'border-slate-300'}"
								/>
								{#if errores.telefono}
									<p class="mt-1 text-xs text-red-600">{errores.telefono}</p>
								{/if}
							</div>
						</div>
					</div>

					<div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
						<div class="flex items-center justify-between gap-4">
							<div>
								<p class="text-xs font-semibold tracking-wide text-slate-500 uppercase">
									{tipoServicio === 'compra_diligencia' ? 'Valor del servicio' : 'Tarifa del trayecto'}
								</p>
								{#if !destino}
									<p class="mt-1 text-sm text-slate-400">Selecciona el barrio de destino para continuar.</p>
								{:else if calculando}
									<p class="mt-1 flex items-center gap-2 text-sm text-slate-500">
										<span class="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
										Calculando…
									</p>
								{:else if precioDisponible}
									<p class="mt-1 text-3xl font-extrabold tracking-tight text-slate-900">{formatearPeso(totalEstimado)}</p>
									<p class="mt-0.5 text-xs text-slate-500">
										{nombreZona(String(precio?.meta?.zona_origen))} → {nombreZona(String(precio?.meta?.zona_destino))}
									</p>
								{:else if tipoServicio === 'compra_diligencia' && !origenRequerido && !tieneRutaCompleta}
									<p class="mt-1 text-xl font-extrabold tracking-tight text-slate-900">Sin tarifa automática</p>
									<p class="mt-0.5 text-xs text-slate-500">
										El domiciliario confirma el precio final al realizar la diligencia{recargoTotal > 0
											? ` (recargos: ${formatearPeso(recargoTotal)})`
											: ''}.
									</p>
								{:else if !tieneRutaCompleta}
									<p class="mt-1 text-sm text-slate-400">
										Selecciona {tipoServicio === 'compra_diligencia' ? 'el barrio de recogida y el de destino' : 'ambos barrios'} para ver el precio.
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

						{#if recargosAplicados.length > 0}
							<div class="mt-4 space-y-1.5 rounded-xl bg-white p-4 text-sm shadow-sm">
								{#if precioDisponible}
									<p class="flex justify-between text-slate-600">
										<span>Tarifa base</span>
										<span class="font-semibold text-slate-900">{formatearPeso(precio?.valor)}</span>
									</p>
								{/if}
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

						{#if precioDisponible || (tipoServicio === 'compra_diligencia' && !origenRequerido && !tieneRutaCompleta)}
							<div class="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
								<Icon name="triangle-exclamation" class="mt-0.5 size-3.5 shrink-0" />
								{#if tipoServicio === 'compra_diligencia' && !tieneRutaCompleta}
									<span>El precio final lo confirma el <strong>domiciliario</strong> al realizar la diligencia según lo que realmente se haga.</span>
								{:else}
									<span>Este es un <strong>estimado</strong>: el precio final lo confirma el domiciliario según el servicio real que realice (compras, peso, paradas, espera, método de pago, etc.).</span>
								{/if}
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
						{#if !puedeConfirmar && !confirmando}
							<p class="mt-2 text-center text-xs text-slate-400">
								{tipoServicio === 'domicilio'
									? tieneRutaCompleta && !precioDisponible
										? 'No se puede confirmar sin una tarifa disponible.'
										: 'Completa los campos para confirmar el pedido.'
									: !destino
											? 'Selecciona el barrio de destino.'
											: !recargosDecididos
													? 'Marca los recargos que aplican o «No aplica» para confirmar.'
													: 'Completa los campos para confirmar el pedido.'}
							</p>
						{/if}
					</div>
				</form>
			{/if}
		{/if}
	</main>
</div>
