<script lang="ts">
	import SearchSelect, { type SearchItem } from '$lib/components/SearchSelect.svelte';
	import { api } from '$lib/api';
	import Icon from '$lib/components/Icon.svelte';
	import { Check, TriangleAlert, CircleCheck, Clock, Truck, ShoppingCart } from 'lucide';
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
	import { validarPedido, type TipoDiligencia } from '$lib/logic/validacion';
	import { calcularBaseSugerida } from '$lib/logic/base-necesaria';
	import { page } from '$app/state';
	import type { HorarioHoy } from '$lib/types';
	import { apiFetch } from '$lib/api';
	import { esCapacitor } from '$lib/push-capacitor';

	// El catálogo (barrios, zonas, recargos y horario de hoy) lo resuelve el
	// servidor (+page.server.ts): el formulario ya viene en el HTML inicial,
	// sin las 4 llamadas /api encadenadas que retrasaban el render en mobile.
	// En Capacitor (ssr: false), se cargan via API en el cliente.
	let { data } = $props();
	let horario = $state<HorarioHoy | null>(data?.horario ?? null);
	let barrios = $state<Barrio[]>(data?.barrios ?? []);
	let zonas = $state<Zona[]>(data?.zonas ?? []);
	let recargos = $state<Recargo[]>(data?.recargos ?? []);
	let cargando = $state(!data?.barrios);
	let errorCarga = $state<string | null>(data?.error ?? null);

	// En Capacitor, cargar catálogo via API.
	if (esCapacitor() && barrios.length === 0) {
		Promise.all([
			apiFetch('/api/barrios').then((r) => r.json().catch(() => ({ data: [] }))),
			apiFetch('/api/zonas').then((r) => r.json().catch(() => ({ data: [] }))),
			apiFetch('/api/recargos').then((r) => r.json().catch(() => ({ data: [] }))),
			apiFetch('/api/horario').then((r) => r.json().catch(() => ({ data: null })))
		]).then(([rB, rZ, rR, rH]) => {
			barrios = rB?.data ?? [];
			zonas = rZ?.data ?? [];
			recargos = rR?.data ?? [];
			horario = rH?.data ?? null;
			cargando = false;
		}).catch(() => {
			cargando = false;
			errorCarga = 'No se pudieron cargar los datos.';
		});
	}

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

	// --- Campos específicos por tipo de diligencia ---
	let dilDescripcion = $state('');
	let dilValorFactura = $state('');
	let dilEntidad = $state('');
	let dilProductos = $state('');
	let dilCantidad = $state('');
	let dilPresupuesto = $state('');
	let dilTramite = $state('');
	let dilInstrucciones = $state('');
	let dilLugarTramite = $state('');
	let dilOtraDescripcion = $state('');

	// --- Peso y transferencia obligatorios (domicilio) ---
	let pesoKg = $state('');
	let transferencia = $state<'si' | 'no' | ''>('');
	let transferenciaMonto = $state('');

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
	// Base necesaria (Fase 21): efectivo que el domiciliario debe adelantar.
	let baseNecesaria = $state('');
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
	// Filtra recargos activos con datos válidos: valor >= 0 y nombre no vacío.
	// Esto excluye registros de prueba o corruptos que hayan quedado en la BD
	// (la migración CHECK recargos_valor_no_negativo puede no haberse ejecutado).
	const recargosActivos = $derived(
		recargos
			.filter((r) => r.activo && r.valor >= 0 && r.nombre?.trim())
			.sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nombre.localeCompare(b.nombre, 'es'))
	);

	// ---------- Recargos disponibles ----------
	// En compra/diligencia no se muestran recargos: la info se captura en
	// los campos específicos de la diligencia, así que se devuelve vacío.
	const recargosDisponibles = $derived(
		tipoServicio === 'domicilio'
			? recargosActivos.filter((r) => r.tipo !== 'compra')
			: []
	);

	const calculoRecargos = $derived(calcularRecargos(recargosDisponibles, recargosSel));
	const recargosAplicados = $derived(calculoRecargos.aplicados);
	const recargoTotal = $derived(calculoRecargos.total);
	const precioDisponible = $derived(precio?.meta?.disponible === true && precio?.valor != null);
	// Con ruta completa (origen+destino) el estimado incluye la tarifa; sin
	// ella (compra/diligencia solo con destino) va solo el total de recargos.
	const totalEstimado = $derived(precioDisponible ? (precio?.valor ?? 0) + recargoTotal : recargoTotal);
	const tieneRutaCompleta = $derived(Boolean(origen && destino));
	// valor_mandado: dinero del cliente que el domiciliario adelanta (solo pago/banco).
	const valorMandadoNum = $derived(
		(tipoDiligencia === 'pago' || tipoDiligencia === 'banco') && dilValorFactura.trim()
			? Number(dilValorFactura.trim()) || 0
			: 0
	);

	// El botón se habilita con la tarifa disponible (domicilio) o con destino
	// (compra/diligencia); la validación de campos se dispara al confirmar
	// y muestra errores por campo.
	const puedeConfirmar = $derived(
		!confirmando &&
			(tipoServicio === 'domicilio'
				? precioDisponible
				: Boolean(destino))
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
			nombreCliente,
			tipoDiligencia: tipoDiligencia as TipoDiligencia,
			dilDescripcion,
			dilValorFactura,
				dilEntidad,
			dilProductos,
			dilCantidad,
			dilPresupuesto,
			dilTramite,
			dilInstrucciones,
			dilLugarTramite,
			dilOtraDescripcion,
			peso: pesoKg,
			transferencia,
			transferenciaMonto
		});
		return Object.keys(errores).length === 0;
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

	function limpiarCamposDiligencia() {
		tipoDiligencia = '';
		necesitaRecoger = null;
		dilDescripcion = '';
		dilValorFactura = '';
		dilEntidad = '';
		dilProductos = '';
		dilCantidad = '';
		dilPresupuesto = '';
		dilTramite = '';
		dilInstrucciones = '';
		dilLugarTramite = '';
		dilOtraDescripcion = '';
		pesoKg = '';
		transferencia = '';
		transferenciaMonto = '';
	}			function elegirTipo(tipo: TipoServicio) {
				tipoServicio = tipo;
				// Al cambiar de tipo se limpian los campos que ya no aplican y el precio.
				precio = null;
				error = null;
				if (tipo === 'domicilio') {
					limpiarCamposDiligencia();
				}
				if (tipo === 'compra_diligencia' && !mostrarOrigen) {
					origen = null;
					dirOrigen = '';
				}
				// En compra/diligencia no se muestran recargos (ya se capturan en
				// los campos específicos de la diligencia), así que se fuerza "No aplica".
				if (tipo === 'compra_diligencia') {
					recargosSel = [];
					recargosConfirmadosNoAplica = true;
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

	/** Empaqueta los datos de la diligencia en observaciones como texto estructurado. */
	function empaquetarObservaciones(): string {
		const parts: string[] = [];
		if (tipoServicio === 'compra_diligencia' && tipoDiligencia) {
			parts.push(`[DILIGENCIA: ${TIPOS_DILIGENCIA.find((t) => t.valor === tipoDiligencia)?.label ?? tipoDiligencia}]`);
		}
		if (dilDescripcion.trim()) parts.push(`Descripción: ${dilDescripcion.trim()}`);
		if (dilEntidad.trim()) parts.push(`Entidad: ${dilEntidad.trim()}`);
		if (dilValorFactura.trim()) parts.push(`Valor a pagar: $${dilValorFactura.trim()}`);
		if (dilProductos.trim()) parts.push(`Productos: ${dilProductos.trim()}`);
		if (dilCantidad.trim()) parts.push(`Cantidad: ${dilCantidad.trim()}`);
		if (dilPresupuesto.trim()) parts.push(`Presupuesto: $${dilPresupuesto.trim()}`);
		if (dilTramite.trim()) parts.push(`Trámite: ${dilTramite.trim()}`);
		if (dilInstrucciones.trim()) parts.push(`Instrucciones: ${dilInstrucciones.trim()}`);
		if (dilLugarTramite.trim()) parts.push(`Lugar: ${dilLugarTramite.trim()}`);
		if (dilOtraDescripcion.trim()) parts.push(`Detalle: ${dilOtraDescripcion.trim()}`);
		// Agregar observaciones libres del usuario si existen.
		if (observaciones.trim()) parts.push(observaciones.trim());
		return parts.join('\n');
	}

	function sincronizarRecargos() {
		// Sincronizar peso y transferencia con recargosSel
		const peso = recargosActivos.find((r) => r.tipo === 'peso');
		const pago = recargosActivos.find((r) => r.tipo === 'pago');
		if (peso) {
			if (String(pesoKg ?? '').trim()) {
				if (!recargosSel.includes(peso.codigo)) recargosSel = [...recargosSel, peso.codigo];
			} else {
				recargosSel = recargosSel.filter((c) => c !== peso.codigo);
			}
		}
		if (pago) {
			if (transferencia === 'si') {
				if (!recargosSel.includes(pago.codigo)) recargosSel = [...recargosSel, pago.codigo];
			} else {
				recargosSel = recargosSel.filter((c) => c !== pago.codigo);
			}
		}
	}

	async function confirmar(e: SubmitEvent) {
		e.preventDefault();
		if (!puedeConfirmar) return;
		sincronizarRecargos();
		if (!validar()) return;
		confirmando = true;
		error = null;
		const obs = empaquetarObservaciones();
		// valor_mandado: solo para pago/banco cuando hay valor de factura.
		const valorMandado = (tipoDiligencia === 'pago' || tipoDiligencia === 'banco') && dilValorFactura.trim()
			? Math.round(Number(dilValorFactura.trim()))
			: undefined;
		const r = await api.post<typeof creado>('/api/pedidos', {
			barrio_origen: origen,
			direccion_origen: dirOrigen,
			barrio_destino: destino,
			direccion_destino: dirDestino,
			observaciones: obs || undefined,
			tipo_servicio: tipoServicio,
			recargos: recargosSel,
			recargos_confirmados_no_aplica: recargosConfirmadosNoAplica,
			nombre_cliente: nombreCliente.trim() || undefined,
			telefono: telefono.trim(),
			base_necesaria: baseNecesaria.trim() ? Number(baseNecesaria.trim()) : undefined,
			valor_mandado: valorMandado
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
		limpiarCamposDiligencia();
		origen = null;
		destino = null;
		dirOrigen = '';
		dirDestino = '';
		observaciones = '';
		recargosSel = [];
		recargosConfirmadosNoAplica = false;
		nombreCliente = '';
		telefono = '';
		baseNecesaria = '';
		errores = {};
		precio = null;
		error = null;
	}

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

	// Refrescar horario inmediatamente y cada 30 s para detectar
	// excepciones nuevas que el admin haya creado (p. ej. ampliar el horario de hoy).
	$effect(() => {
		async function refrescarHorario() {
			try {
				const r = await apiFetch('/api/horario');
				const body = await r.json().catch(() => ({}));
				if (body?.data) horario = body.data;
			} catch {
				// Silenciar errores de red en polling
			}
		}
		// Refresco inmediato al montar (captura excepciones creadas
		// después del render inicial del servidor).
		refrescarHorario();
		const interval = setInterval(refrescarHorario, 30_000);
		return () => clearInterval(interval);
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
					<Icon icon={Check} class="size-8" />
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
					<Icon icon={TriangleAlert} class="mt-0.5 size-3.5 shrink-0" />
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
						<Icon icon={CircleCheck} class="size-3.5" />
						Atendemos hoy hasta las {horario.cierre}
					</p>
				{/if}
			</div>

			{#if horario && !horario.abierto}
				<!-- Fuera de horario: la app no recibe pedidos nuevos -->
				<div class="mx-auto mt-10 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center shadow-sm">
					<div class="mx-auto flex size-14 items-center justify-center rounded-full bg-amber-100 text-amber-600">
						<Icon icon={Clock} class="size-7" />
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
									<Icon icon={Truck} class="size-4 text-primary" />
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
									<Icon icon={ShoppingCart} class="size-4 text-primary" />
									Compra / diligencia
								</span>
								<span class="mt-1 block text-xs text-slate-500">Comprar, pagar facturas o hacer trámites.</span>
							</button>
						</div>
						{#if tipoServicio === 'compra_diligencia'}
							<!-- Tipo de diligencia: radio cards -->
							<div class="mt-5 rounded-xl border border-primary/20 bg-primary-light/30 p-4">
								<p class="text-xs font-bold tracking-wide text-primary-dark uppercase">¿Qué tipo de diligencia necesitas?</p>
								<div class="mt-3 grid gap-2 sm:grid-cols-2">
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
									{#if errores.tipoDiligencia}
										<p class="mt-2 text-xs text-red-600">{errores.tipoDiligencia}</p>
									{/if}

									<!-- Pregunta de recogida: aplica para todos los tipos de diligencia -->
								{#if tipoDiligencia}
									<fieldset class="mt-4">
										<legend class="text-sm font-semibold text-slate-800">¿Se debe recoger algo o a alguien antes?</legend>
										<div class="mt-2 flex gap-2">
											<button
												type="button"
												onclick={() => { necesitaRecoger = true; error = null; }}
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
								{/if}
							</div>

							<!-- Campos específicos por tipo de diligencia -->
							{#if tipoDiligencia}
								<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
									<h2 class="mb-1 flex items-center gap-2 text-sm font-bold tracking-wide text-slate-500 uppercase">
										<span class="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">A</span>
										Datos de la diligencia
									</h2>
									<p class="mb-4 ml-7 text-xs text-slate-400">
										{TIPOS_DILIGENCIA.find((t) => t.valor === tipoDiligencia)?.label ?? ''}
									</p>

									<!-- Pago de factura o servicio -->
									{#if tipoDiligencia === 'pago'}
										<div class="space-y-4">
											<div>
												<label for="dil-desc" class="mb-1.5 block text-sm font-semibold text-slate-700">Descripción <span class="text-amber-600">(obligatorio)</span></label>
												<input
													id="dil-desc"
													type="text"
													bind:value={dilDescripcion}
													maxlength="300"												placeholder="Ej: Pago de factura de luz, recibo de agua…"
												class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.dilDescripcion ? 'border-red-400' : ''}"
													/>
													{#if errores.dilDescripcion}<p class="mt-1 text-xs text-red-600">{errores.dilDescripcion}</p>{/if}						</div>
					<div class="grid gap-4 sm:grid-cols-2">
												<div>
													<label for="dil-valor-pagar" class="mb-1.5 block text-sm font-semibold text-slate-700">Valor de la factura <span class="text-amber-600">(obligatorio)</span></label>
													<div class="relative">
														<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
														<input
															id="dil-valor-pagar"
															type="number"
														min="0"
														step="1000"
														bind:value={dilValorFactura}
														placeholder="Ej: 85000"
														class="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.dilValorFactura ? 'border-red-400' : ''}"
														/>														{#if errores.dilValorFactura}<p class="mt-1 text-xs text-red-600">{errores.dilValorFactura}</p>{/if}
													</div>
												</div>
											</div>
										</div>

									<!-- Pago bancario o corresponsal -->
									{:else if tipoDiligencia === 'banco'}
										<div class="space-y-4">
											<div>
												<label for="dil-entidad" class="mb-1.5 block text-sm font-semibold text-slate-700">Entidad / banco <span class="text-amber-600">(obligatorio)</span></label>
												<input
													id="dil-entidad"
													type="text"
													bind:value={dilEntidad}
													maxlength="200"
													placeholder="Ej: Bancolombia, Daviplata, Efecty…"
													class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.dilEntidad ? 'border-red-400' : ''}"
												/>
													{#if errores.dilEntidad}<p class="mt-1 text-xs text-red-600">{errores.dilEntidad}</p>{/if}						</div>
					<div>
												<label for="dil-desc-banco" class="mb-1.5 block text-sm font-semibold text-slate-700">Descripción del pago <span class="text-amber-600">(obligatorio)</span></label>
												<input
													id="dil-desc-banco"
													type="text"
													bind:value={dilDescripcion}
													maxlength="300"														placeholder="Ej: Consignación, pago de cuota…"
														class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.dilDescripcion ? 'border-red-400' : ''}"
													/>
													{#if errores.dilDescripcion}<p class="mt-1 text-xs text-red-600">{errores.dilDescripcion}</p>{/if}						</div>
					<div class="grid gap-4 sm:grid-cols-2">
												<div>
													<label for="dil-valor-pagar" class="mb-1.5 block text-sm font-semibold text-slate-700">Valor a pagar <span class="text-amber-600">(obligatorio)</span></label>
													<div class="relative">
														<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
														<input
															id="dil-valor-pagar"
															type="number"
															min="0"
															step="1000"
															bind:value={dilValorFactura}
															placeholder="Ej: 150000"
															class="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.dilValorFactura ? 'border-red-400' : ''}"
														/>
														{#if errores.dilValorFactura}<p class="mt-1 text-xs text-red-600">{errores.dilValorFactura}</p>{/if}														</div>						</div>
											</div>
										</div>

									<!-- Compra de productos -->
									{:else if tipoDiligencia === 'compra'}
										<div class="space-y-4">
											<div>
												<label for="dil-productos" class="mb-1.5 block text-sm font-semibold text-slate-700">Productos / descripción <span class="text-amber-600">(obligatorio)</span></label>
												<textarea
													id="dil-productos"
													bind:value={dilProductos}
													rows="3"
													maxlength="500"
													placeholder="Ej: 2 paquetes de arroz, 1 leche, 1 medicamento X"
													class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.dilProductos ? 'border-red-400' : ''}"
												></textarea>
													{#if errores.dilProductos}<p class="mt-1 text-xs text-red-600">{errores.dilProductos}</p>{/if}						</div>
					<div>
												<label for="dil-cantidad" class="mb-1.5 block text-sm font-semibold text-slate-700">Cantidad</label>
												<input
													id="dil-cantidad"
													type="text"
													bind:value={dilCantidad}														maxlength="100"
														placeholder="Ej: 3 artículos, 1 paquete…"
													class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11"
													/>						</div>
					<div class="grid gap-4 sm:grid-cols-2">
												<div>
													<label for="dil-presupuesto" class="mb-1.5 block text-sm font-semibold text-slate-700">Presupuesto / valor estimado</label>
													<div class="relative">
														<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
														<input
															id="dil-presupuesto"
															type="number"
															min="0"
															step="1000"
															bind:value={dilPresupuesto}
															placeholder="Ej: 50000"
															class="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11"
														/>
													</div>						</div>
											</div>
										</div>

									<!-- Trámite o documento -->
									{:else if tipoDiligencia === 'tramite'}
										<div class="space-y-4">
											<div>
												<label for="dil-tramite" class="mb-1.5 block text-sm font-semibold text-slate-700">¿Qué trámite necesitas? <span class="text-amber-600">(obligatorio)</span></label>
												<input
													id="dil-tramite"
													type="text"
													bind:value={dilTramite}
													maxlength="300"
													placeholder="Ej: Radicar documento, recoger certificado…"
													class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.dilTramite ? 'border-red-400' : ''}"
												/>
													{#if errores.dilTramite}<p class="mt-1 text-xs text-red-600">{errores.dilTramite}</p>{/if}						</div>
					<div>
												<label for="dil-instrucciones" class="mb-1.5 block text-sm font-semibold text-slate-700">Descripción / instrucciones <span class="text-amber-600">(obligatorio)</span></label>
												<textarea
													id="dil-instrucciones"
													bind:value={dilInstrucciones}
													rows="3"
													maxlength="500"
													placeholder="Detalla qué debe hacer el domiciliario, qué documentos llevar, etc."
													class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.dilInstrucciones ? 'border-red-400' : ''}"
												></textarea>
													{#if errores.dilInstrucciones}<p class="mt-1 text-xs text-red-600">{errores.dilInstrucciones}</p>{/if}						</div>
					<div class="grid gap-4 sm:grid-cols-2">
												<div>
													<label for="dil-lugar" class="mb-1.5 block text-sm font-semibold text-slate-700">Lugar del trámite</label>
													<input
														id="dil-lugar"
														type="text"
														bind:value={dilLugarTramite}
														maxlength="200"
														placeholder="Ej: Alcaldía, notaría, etc."
														class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11"
													/>						</div>
											</div>
										</div>

									<!-- Otra diligencia -->
									{:else if tipoDiligencia === 'otro'}
										<div class="space-y-4">
											<div>
												<label for="dil-otra" class="mb-1.5 block text-sm font-semibold text-slate-700">Describe la diligencia <span class="text-amber-600">(obligatorio)</span></label>
												<textarea
													id="dil-otra"
													bind:value={dilOtraDescripcion}
													rows="3"
													maxlength="500"
													placeholder="Describe con detalle qué necesitas que haga el domiciliario."
													class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.dilOtraDescripcion ? 'border-red-400' : ''}"
												></textarea>
													{#if errores.dilOtraDescripcion}<p class="mt-1 text-xs text-red-600">{errores.dilOtraDescripcion}</p>{/if}						</div>
					<div>
												<label for="dil-instrucciones" class="mb-1.5 block text-sm font-semibold text-slate-700">Instrucciones adicionales</label>
												<textarea
													id="dil-instrucciones"
													bind:value={dilInstrucciones}
													rows="2"
													maxlength="500"
													placeholder="Detalles extra, horarios, referencias, etc."
													class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11"													></textarea>						</div>
										</div>
										{/if}
								</div>
							{/if}
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
					</div>					{#if tipoServicio === 'domicilio'}
					<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
						<h2 class="mb-1 flex items-center gap-2 text-sm font-bold tracking-wide text-slate-500 uppercase">
							<span class="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">3</span>
							Detalles del pedido
						</h2>
						<p class="mb-4 ml-7 text-xs text-slate-400">
							Indica el peso y si aplica transferencia.
						</p>
								<!-- Campo obligatorio: peso -->
								<div class="mb-4">
									<label for="domicilio-peso" class="mb-1.5 block text-sm font-semibold text-slate-700">Peso del paquete <span class="text-amber-600">(obligatorio)</span></label>
									<div class="relative">
										<input
											id="domicilio-peso"
											type="number"
											min="0"
											step="0.5"
											bind:value={pesoKg}																						placeholder="Ej: 2.5"
																						oninput={() => sincronizarRecargos()}
																						class="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.peso ? 'border-red-400' : ''}"
										/>
										<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">kg</span>
									</div>
									{#if errores.peso}<p class="mt-1 text-xs text-red-600">{errores.peso}</p>{/if}
								</div>

								<!-- Campo obligatorio: transferencia -->
								<div class="mb-4">
									<label class="mb-1.5 block text-sm font-semibold text-slate-700">Transferencia bancaria <span class="text-amber-600">(obligatorio)</span></label>
									<div class="flex gap-2">
										<button
											type="button"
											onclick={() => { transferencia = 'si'; error = null; sincronizarRecargos(); }}
											class="rounded-xl border-2 px-4 py-2 text-sm font-semibold transition {transferencia === 'si' ? 'border-primary bg-primary-light text-primary-dark' : 'border-slate-200 text-slate-600 hover:border-primary/50'}"
										>
											Sí, hay transferencia
										</button>
										<button
											type="button"
											onclick={() => { transferencia = 'no'; transferenciaMonto = ''; error = null; sincronizarRecargos(); }}
											class="rounded-xl border-2 px-4 py-2 text-sm font-semibold transition {transferencia === 'no' ? 'border-primary bg-primary-light text-primary-dark' : 'border-slate-200 text-slate-600 hover:border-primary/50'}"
										>
											No hay transferencia
										</button>
									</div>
									{#if errores.transferencia}<p class="mt-1 text-xs text-red-600">{errores.transferencia}</p>{/if}

									{#if transferencia === 'si'}
										<div class="mt-3 relative">
											<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
											<input
												type="number"
												min="0"
												step="1000"
												bind:value={transferenciaMonto}
												placeholder="Monto a transferir"
												class="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.transferenciaMonto ? 'border-red-400' : ''}"
											/>
											{#if errores.transferenciaMonto}<p class="mt-1 text-xs text-red-600">{errores.transferenciaMonto}</p>{/if}
										</div>
									{/if}
								</div>


					</div>
					{/if}

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
						<!-- Base necesaria (Fase 21): efectivo que el domiciliario debe adelantar -->
						<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
							<h2 class="mb-1 flex items-center gap-2 text-sm font-bold tracking-wide text-slate-500 uppercase">
								<span class="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">4</span>
								Base necesaria
							</h2>
							<p class="mb-4 ml-7 text-xs text-slate-400">
								{#if tipoServicio === 'compra_diligencia'}
									Efectivo que el domiciliario necesitará adelantar para cubrir la compra o diligencia en el local. Se sugiere automáticamente el total, puedes ajustarlo si es necesario.
								{:else}
									Efectivo que el domiciliario necesitará para el pedido (compras, pago, etc.). Si no aplica, déjalo en 0.
								{/if}
							</p>
							<div class="grid gap-4 sm:grid-cols-2">
								<div>
									<label for="base-necesaria" class="mb-1.5 block text-sm font-semibold text-slate-700">Monto a adelantar (COP)</label>
									<input
										id="base-necesaria"
										type="number"
										min="0"
										step="500"
										bind:value={baseNecesaria}
										placeholder="0"
										class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11"
									/>
								</div>
								<div class="flex items-end">
							{#if !baseNecesaria.trim()}
								{@const baseSugerida = calcularBaseSugerida({ valorMandado: valorMandadoNum, recargoTotal, tarifaServicio: precioDisponible ? (precio?.valor ?? 0) : 0 })}
								{#if baseSugerida > 0}
									<button
										type="button"
										onclick={() => { baseNecesaria = String(baseSugerida); }}
												class="rounded-xl border border-primary/30 bg-primary-light px-4 py-2.5 text-sm font-semibold text-primary-dark transition hover:bg-primary/20"
											>
												Usar total ({formatearPeso(baseSugerida)})
											</button>
										{/if}
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

						{#if precioDisponible || recargosAplicados.length > 0 || valorMandadoNum > 0}
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
									<span>{tipoServicio === 'compra_diligencia' ? 'Costo del servicio' : 'Total estimado'}</span>
									<span>{formatearPeso(totalEstimado)}</span>
								</p>
								{#if valorMandadoNum > 0}
									<div class="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
										<p class="text-xs font-semibold text-blue-700">Dinero a entregar / adelantar</p>
										<p class="mt-0.5 text-lg font-bold text-blue-900">{formatearPeso(valorMandadoNum)}</p>
										<p class="text-[11px] text-blue-600">Este valor NO es ingreso de StarGo: es dinero del cliente que el domiciliario entrega o consigna.</p>
									</div>
								{/if}
							</div>
						{/if}

						{#if precioDisponible || (tipoServicio === 'compra_diligencia' && !origenRequerido && !tieneRutaCompleta)}
							<div class="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
								<Icon icon={TriangleAlert} class="mt-0.5 size-3.5 shrink-0" />
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
							<p class="mt-2 text-center text-xs text-slate-400">								{tipoServicio === 'domicilio'
									? tieneRutaCompleta && !precioDisponible
										? 'No se puede confirmar sin una tarifa disponible.'
										: 'Completa los campos para confirmar el pedido.'
									: !destino
											? 'Selecciona el barrio de destino.'
												: 'Completa los campos para confirmar el pedido.'}
							</p>
						{/if}
					</div>
				</form>
			{/if}
		{/if}
	</main>
</div>
