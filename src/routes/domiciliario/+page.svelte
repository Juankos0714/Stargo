<script lang="ts">
	import { page } from '$app/state';
	import { esCapacitor } from '$lib/capacitor-auth';
	import { api } from '$lib/api';
	import Icon from '$lib/components/Icon.svelte';
	import { Ban, Sun, Coins, CircleCheck, TriangleAlert, Clock, Truck, Phone, MapPin } from 'lucide';
	import BadgeEstado from '$lib/components/BadgeEstado.svelte';
	import BotonWhatsApp from '$lib/components/BotonWhatsApp.svelte';
	import TablaNiveles from '$lib/components/TablaNiveles.svelte';
	import { hidratarSesionRealtime } from '$lib/supabase-browser';
	import { debounce, suscribirCambios, type RealtimeEstado } from '$lib/realtime';
	import IndicadorRealtime from '$lib/components/IndicadorRealtime.svelte';
	import {
		ESTADOS_ACTIVOS_DOMICILIARIO,
		ESTADOS_FINALES,
		accionDomiciliario,
		etiquetaEstado,
		formatearPeso,
		mensajeWhatsAppDomiciliario,
		rangoDeNiveles,
		type CuentaDomiciliario,
		type HistorialEstado,
		type Pedido,
		type Turno
	} from '$lib/types';

	interface PedidoFila extends Pedido {
		barrio_origen_nombre: string | null;
		barrio_destino_nombre: string | null;
		historial: HistorialEstado[];
	}

	let pedidos = $state<PedidoFila[]>([]);
	let cuenta = $state<CuentaDomiciliario | null>(null);
	let cargando = $state(true);
	let error = $state<string | null>(null);
	let mensaje = $state<{ tipo: 'ok' | 'err'; texto: string } | null>(null);
	let pestana = $state<'activos' | 'completadas'>('activos');
	let guardando = $state<Record<string, boolean>>({});
	let notas = $state<Record<string, string>>({});
	let estadoRealtime = $state<RealtimeEstado>('conectando');

	// ── Turno (Fase 21) ──
	let turno = $state<Turno | null>(null);
	let cargandoTurno = $state(true);
	let baseDeclarada = $state('');
	let iniciandoTurno = $state(false);
	let cerrandoTurno = $state(false);

	const activos = $derived(
		pedidos
			.filter((p) => ESTADOS_ACTIVOS_DOMICILIARIO.includes(p.estado))
			.sort((a, b) => a.created_at.localeCompare(b.created_at))
	);
	const completados = $derived(pedidos.filter((p) => ESTADOS_FINALES.includes(p.estado)));

	/** Total que recauda el domiciliario: tarifa base + recargos (Fase 7). */
	function totalPedido(p: PedidoFila): number {
		return p.total ?? p.tarifa_base + (p.recargo_total ?? 0);
	}

	/** Niveles con su rango calculado, para la tabla de comisiones. */
	const nivelesConRango = $derived(rangoDeNiveles(cuenta?.niveles ?? []));

	/** Resumen del día de hoy: total acumulado, nivel alcanzado y comisión del día. */
	const hoy = $derived(cuenta?.hoy ?? null);

	/** Faltan $X para el siguiente nivel (solo si hay nivel y hay niveles superiores). */
	const faltanParaSiguienteNivel = $derived.by(() => {
		if (!hoy?.nivel || !cuenta?.niveles?.length) return null;
		const ordenados = [...cuenta.niveles].sort((a, b) => a.nivel - b.nivel);
		const idx = ordenados.findIndex((n) => n.nivel === hoy.nivel);
		if (idx < 0 || idx >= ordenados.length - 1) return null; // ya está en el máximo
		const siguienteHasta = ordenados[idx + 1].hasta;
		const falta = Math.max(0, siguienteHasta - hoy.total);
		return falta > 0 ? falta : null;
	});

	/** Fecha legible del resumen de hoy. */
	const hoyEtiqueta = $derived(
		hoy?.fecha ? new Date(hoy.fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : ''
	);

	function formatearFecha(iso: string): string {
		return new Date(iso).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function urlNavegacion(p: PedidoFila): string {
		const destino = `${p.direccion_destino}, ${p.barrio_destino_nombre ?? ''}, Armenia, Quindío`.trim();
		return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destino)}`;
	}

	async function cargar() {
		cargando = true;
		error = null;
		const r = await api.get<PedidoFila[]>('/api/pedidos');
		cargando = false;
		if (r.error) {
			error = r.error;
			return;
		}
		pedidos = r.data ?? [];
	}

	// ── Turno: cargar, iniciar, cerrar ──
	async function cargarTurno() {
		cargandoTurno = true;
		const r = await api.get<Turno>('/api/turnos');
		cargandoTurno = false;
		turno = r.data ?? null;
	}

	async function iniciarTurno() {
		const bn = Number(baseDeclarada);
		if (!Number.isFinite(bn) || bn < 0) {
			mensaje = { tipo: 'err', texto: 'Ingresa un monto válido para tu base.' };
			return;
		}
		iniciandoTurno = true;
		mensaje = null;
		const r = await api.post<Turno>('/api/turnos', { base_declarada: Math.round(bn) });
		iniciandoTurno = false;
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		turno = r.data;
		baseDeclarada = '';
		mensaje = { tipo: 'ok', texto: 'Turno iniciado. ¡Buena ruta!' };
	}

	async function cerrarTurno() {
		if (!window.confirm('¿Cerrar tu turno? Debes tener todos los pedidos entregados o cancelados.')) return;
		cerrandoTurno = true;
		mensaje = null;
		const r = await api.put<Turno>('/api/turnos', {});
		cerrandoTurno = false;
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		turno = null;
		mensaje = { tipo: 'ok', texto: 'Turno cerrado.' };
	}

	async function cargarCuenta() {
		const r = await api.get<CuentaDomiciliario>('/api/domiciliarios/mi-cuenta');
		if (r.error) return;
		cuenta = r.data;
	}

	const cargarDebounced = debounce(() => cargar(), 250);

	async function avanzar(p: PedidoFila) {
		const accion = accionDomiciliario(p.estado);
		if (!accion) return;
		const esFinal = accion.estado === 'entregado';
		if (esFinal && !window.confirm(`¿Confirmas que el pedido ${p.numero} fue entregado?`)) return;

		guardando[p.id] = true;
		guardando = { ...guardando };
		mensaje = null;
		const r = await api.post(`/api/pedidos/${p.id}/estado`, {
			estado: accion.estado,
			notas: notas[p.id]?.trim() || undefined
		});
		guardando[p.id] = false;
		guardando = { ...guardando };
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		notas[p.id] = '';
		notas = { ...notas };
		mensaje = { tipo: 'ok', texto: `Pedido ${p.numero}: ${accion.etiqueta.toLowerCase()}.` };
		await cargar();
		await cargarCuenta();
	}

	$effect(() => {
		let activo = true;
		let limpiar: (() => void) | undefined;
		hidratarSesionRealtime().then(() => {
			if (!activo) return;
			// El domiciliario solo recibe cambios de sus propios pedidos
			// (RLS + filtro por domiciliario_id en el canal).
			const domId = page.data.domiciliarioId;
			if (domId) {
				limpiar = suscribirCambios({
						tabla: 'pedidos',
						filtro: { domiciliario_id: domId },
						onCambio: () => cargarDebounced(),
						onEstado: (estado) => {
							estadoRealtime = estado;
							if (estado === 'conectado') cargarDebounced();
						}
					});
			} else if (esCapacitor()) {
				// En Capacitor no hay SSR data (page.data vacío).
				// Marcar como conectado y pollear sin filtro.
				estadoRealtime = 'conectado';
				limpiar = suscribirCambios({
						tabla: 'pedidos',
						onCambio: () => cargarDebounced(),
						onEstado: (estado) => {
							estadoRealtime = estado;
							if (estado === 'conectado') cargarDebounced();
						}
					});
			}
		});
		cargar();
		cargarCuenta();
		cargarTurno();
		// Red de seguridad: refresco periódico por si un evento se pierde
		// (p. ej. cancelación con domiciliario_id nulo o cambios de red).
		const reloj = setInterval(() => {
			cargar();
			cargarCuenta();
		}, 60000);
		return () => {
			activo = false;
			clearInterval(reloj);
			limpiar?.();
		};
	});
</script>

<svelte:head>
	<title>Mis entregas — StarGo</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-2xl font-extrabold tracking-tight text-slate-900">Mis entregas</h1>
		<p class="mt-1 text-sm text-slate-500">
			Recibes las asignaciones al instante. Avanza el pedido con cada paso y abre la navegación al destino.
		</p>
	</div>
	<IndicadorRealtime estado={estadoRealtime} />
</header>

{#if cuenta?.bloqueado}
	<div
		class="mb-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
		role="alert"
	>
		<Icon icon={Ban} class="mt-0.5 size-5 shrink-0" />
		<div>
			<p class="font-bold">Estás bloqueado por falta de pago</p>
			<p class="mt-0.5 text-xs text-red-600">
				No recibirás pedidos nuevos hasta que el administrador registre un abono y desbloquee tu cuenta.
				Puedes terminar los pedidos que ya tienes en curso.
			</p>
		</div>
	</div>
{/if}

{#if mensaje}
	<div
		class="mb-5 rounded-xl border px-4 py-3 text-sm {mensaje.tipo === 'ok'
			? 'border-primary/30 bg-primary-light text-primary-dark'
			: 'border-red-200 bg-red-50 text-red-700'}"
	>
		{mensaje.texto}
	</div>
{/if}

<!-- ═══ Turno (Fase 21) ═══ -->
{#if cargandoTurno}
	<!-- skeleton -->
{:else if !turno}
	<!-- Sin turno abierto: formulario para iniciar -->
	<section class="mb-6 rounded-2xl border-2 border-dashed border-primary/30 bg-primary-light/20 p-6">
		<div class="flex items-center gap-3">
			<div class="flex size-10 items-center justify-center rounded-full bg-primary text-white">
				<Icon icon={Clock} class="size-5" />
			</div>
			<div>
				<h2 class="text-lg font-bold text-slate-900">Iniciar turno</h2>
				<p class="text-sm text-slate-500">Declara cuánto efectivo tienes disponible ahora para entregar pedidos.</p>
			</div>
		</div>
		<form
			onsubmit={(e) => { e.preventDefault(); iniciarTurno(); }}
			class="mt-4 flex flex-wrap items-end gap-3"
		>
			<div>
				<label for="base-declarada" class="mb-1 block text-xs font-semibold text-slate-600">Efectivo disponible (COP)</label>
				<input
					id="base-declarada"
					type="number"
					min="0"
					step="500"
					bind:value={baseDeclarada}
					placeholder="Ej: 50000"
					required
					class="w-48 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:outline-none"
			/>
			</div>
			<button
				type="submit"
				disabled={iniciandoTurno || !baseDeclarada}
				class="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:opacity-60"
			>
				{iniciandoTurno ? 'Abriendo…' : 'Abrir turno'}
			</button>
		</form>
	</section>
{:else}
	<!-- Turno activo: info + botón cerrar -->
	<section class="mb-6 rounded-2xl border border-primary/25 bg-primary-light/40 p-4 shadow-sm">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex items-center gap-3">
				<div class="flex size-9 items-center justify-center rounded-full bg-primary text-white">
					<Icon icon={Coins} class="size-4" />
				</div>
				<div>
					<p class="text-xs font-semibold tracking-wide text-primary-dark uppercase">Turno abierto</p>
					<p class="text-xs text-slate-500">Abierto {formatearFecha(turno.iniciado_en)}</p>
				</div>
			</div>
			<div class="flex items-center gap-4">
				<div class="text-right">
					<p class="text-xs text-slate-500">Base declarada</p>
					<p class="text-lg font-extrabold text-slate-900">{formatearPeso(turno.base_declarada)}</p>
				</div>
				<div class="text-right">
					<p class="text-xs text-slate-500">Disponible</p>
					<p class="text-lg font-extrabold {turno.base_disponible_actual > 0 ? 'text-green-700' : 'text-red-600'}">{formatearPeso(turno.base_disponible_actual)}</p>
				</div>
				<button
					type="button"
					onclick={cerrarTurno}
					disabled={cerrandoTurno}
					class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-100 disabled:opacity-60"
				>
					{cerrandoTurno ? 'Cerrando…' : 'Cerrar turno'}
				</button>
			</div>
		</div>
	</section>
{/if}

<!-- Mi cuenta: comisión diaria, niveles y deuda -->
<section class="mb-6">
	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
		<div class="rounded-2xl border border-primary/25 bg-primary-light/40 p-4 shadow-sm">
			<p class="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-primary-dark uppercase">
				<Icon icon={Sun} class="size-3.5" />
				Hoy {hoyEtiqueta}
			</p>
			<p class="mt-1 text-2xl font-extrabold text-slate-900">
				{hoy ? formatearPeso(hoy.total) : formatearPeso(null)}
			</p>
			<p class="mt-0.5 text-xs text-slate-500">
				{#if hoy && hoy.nivel}
					total del día · nivel {hoy.nivel} → <span class="font-bold text-primary-dark">comisión {formatearPeso(hoy.comision)}</span>
					{#if faltanParaSiguienteNivel !== null}
						<br />
						<span class="text-primary/70">faltan {formatearPeso(faltanParaSiguienteNivel)} para el siguiente nivel</span>
					{/if}
				{:else}
					acumulado de tus entregas de hoy (sin entregas aún)
				{/if}
			</p>
		</div>
		<div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
			<p class="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
				<Icon icon={Coins} class="size-3.5 text-primary" />
				Generado en comisiones
			</p>
			<p class="mt-1 text-2xl font-extrabold text-slate-900">{formatearPeso(cuenta?.deuda ?? null)}</p>
			<p class="mt-0.5 text-xs text-slate-400">saldo pendiente de comisiones</p>
		</div>
		<div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
			<p class="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
				<Icon icon={CircleCheck} class="size-3.5 text-primary" />
				Abonos registrados
			</p>
			<p class="mt-1 text-2xl font-extrabold text-slate-900">{formatearPeso(cuenta?.credito_favor ?? 0)}</p>
			<p class="mt-0.5 text-xs text-slate-400">crédito a favor (abono excedente)</p>
		</div>
		<div
			class="rounded-2xl border p-4 shadow-sm {cuenta && cuenta.deuda > 0
				? 'border-red-200 bg-red-50'
				: 'border-green-200 bg-green-50'}"
		>
			<p class="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase {cuenta && cuenta.deuda > 0
				? 'text-red-600'
				: 'text-green-700'}">
				<Icon icon={TriangleAlert} class="size-3.5" />
				Deuda pendiente
			</p>
			<p class="mt-1 text-2xl font-extrabold {cuenta && cuenta.deuda > 0 ? 'text-red-700' : 'text-green-700'}">
				{formatearPeso(cuenta?.deuda ?? null)}
			</p>
			<p class="mt-0.5 text-xs {cuenta && cuenta.deuda > 0 ? 'text-red-500' : 'text-green-600'}">
				{cuenta && cuenta.deuda > 0 ? 'al día este monto para no ser bloqueado' : 'estás al día'}
			</p>
		</div>
	</div>

	{#if hoy?.escalera_anterior}
		<div class="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
			<Icon icon={Clock} class="mt-0.5 size-4 shrink-0" />
			<span>
				La escalera de comisiones cambió <strong>hoy</strong>: la comisión de este día se calcula con la
				escalera anterior y la nueva aplica <strong>desde mañana</strong>. Tus días anteriores tampoco se
				modifican.
			</span>
		</div>
	{/if}

	<TablaNiveles
		niveles={nivelesConRango}
		nivelDestacado={hoy?.nivel ?? null}
		etiquetaDestacado="hoy"
		titulo="Comisión por nivel según el total del día"
		notaPie="La comisión de cada día se calcula según el total acumulado de tus entregas: se cobra el valor de cada nivel que cruza el total del día."
	/>
</section>

{#if (cuenta?.pagos?.length ?? 0) > 0}
	<details class="mb-6 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
		<summary
			class="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-primary-dark hover:underline"
		>
			Últimos abonos ({cuenta?.pagos.length})
			<!-- Σ de TODOS los abonos (la API solo lista los últimos 10). -->
			<span
				class="ml-auto whitespace-nowrap rounded-full bg-primary-light px-2 py-0.5 text-[10px] font-bold text-primary"
			>
				deuda {formatearPeso(cuenta?.deuda ?? 0)}
			</span>
			<!-- Estado de la deuda: verde al día, rojo en deuda (mismos colores que la tarjeta de deuda). -->
			<span
				class="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold {cuenta && cuenta.deuda > 0
					? 'bg-red-100 text-red-700'
					: 'bg-green-100 text-green-700'}"
			>
				{cuenta && cuenta.deuda > 0 ? 'en deuda' : 'al día'}
			</span>
		</summary>
		<ul class="mt-2 space-y-1.5 border-l-2 border-slate-200 pl-3">
			{#each cuenta?.pagos ?? [] as pago (pago.id)}
				<li class="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
					<span class="font-bold text-green-700">{formatearPeso(pago.valor)}</span>
					{pago.nota ? `· ${pago.nota}` : ''}
					<span class="ml-auto text-slate-400">{formatearFecha(pago.created_at)}</span>
				</li>
			{/each}
		</ul>
	</details>
{/if}

<div class="mb-5 flex gap-1.5">
	<button
		type="button"
		onclick={() => (pestana = 'activos')}
		class="rounded-lg px-3.5 py-2 text-sm font-semibold transition {pestana === 'activos'
			? 'bg-primary text-white shadow-sm'
			: 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}"
	>
		En curso
		<span class="ml-1.5 rounded-full px-1.5 text-xs {pestana === 'activos' ? 'bg-white/20' : 'bg-slate-100'}">
			{activos.length}
		</span>
	</button>
	<button
		type="button"
		onclick={() => (pestana = 'completadas')}
		class="rounded-lg px-3.5 py-2 text-sm font-semibold transition {pestana === 'completadas'
			? 'bg-primary text-white shadow-sm'
			: 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}"
	>
		Completadas
		<span class="ml-1.5 rounded-full px-1.5 text-xs {pestana === 'completadas' ? 'bg-white/20' : 'bg-slate-100'}">
			{completados.length}
		</span>
	</button>
</div>

{#if cargando && pedidos.length === 0}
	<div class="flex items-center justify-center gap-3 py-20 text-slate-500">
		<span class="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
		Cargando tus pedidos…
	</div>
{:else if error}
	<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">No se pudieron cargar los pedidos: {error}</div>
{:else if pestana === 'activos' && activos.length === 0}
	<div class="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 p-14 text-center">
		<div class="mx-auto flex size-14 items-center justify-center rounded-full bg-primary-light text-[#8BB4FF]">
			<Icon icon={Truck} class="size-7" />
		</div>
		<p class="mt-4 font-semibold text-slate-700">No tienes entregas en curso</p>
		<p class="mt-1 text-sm text-slate-400">Cuando el administrador te asigne un pedido, aparecerá aquí automáticamente.</p>
	</div>
{:else if pestana === 'activos'}
	<div class="space-y-5">
		{#each activos as p (p.id)}
			{@const accion = accionDomiciliario(p.estado)}
			{@const total = totalPedido(p)}
			{@const recs = p.recargos ?? []}
			<div class="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
				<div class="flex flex-wrap items-center gap-3 border-b border-slate-100 p-5">
					<div>
						<p class="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">Pedido</p>
						<p class="font-mono text-xl font-black tracking-widest text-slate-900">{p.numero}</p>
					</div>
					<BadgeEstado estado={p.estado} size="md" class="ml-auto" />
				</div>

				<div class="grid gap-4 p-5 sm:grid-cols-2">
					<div class="rounded-xl bg-slate-50 p-4">
						<p class="text-xs font-semibold text-slate-400 uppercase">Recoger en</p>
						<p class="mt-1 font-medium text-slate-900">{p.barrio_origen_nombre ?? '—'}</p>
						<p class="text-sm text-slate-600">{p.direccion_origen}</p>
					</div>
					<div class="rounded-xl bg-slate-50 p-4">
						<p class="text-xs font-semibold text-slate-400 uppercase">Entregar en</p>
						<p class="mt-1 font-medium text-slate-900">{p.barrio_destino_nombre ?? '—'}</p>
						<p class="text-sm text-slate-600">{p.direccion_destino}</p>
					</div>
				</div>

				<!-- Valor a cobrar: el total completo (tarifa + recargos), no solo el trayecto -->
				<div class="mx-5 mb-2 rounded-xl border border-primary/20 bg-primary-light/40 px-4 py-3">
					<p class="flex items-baseline justify-between gap-3">
						<span class="text-xs font-semibold text-slate-500 uppercase">Valor a cobrar</span>
						<span class="text-xl font-extrabold text-primary-dark">{formatearPeso(total)}</span>
					</p>
					{#if recs.length > 0}
						<div class="mt-1.5 space-y-0.5 text-xs text-slate-600">
							<p class="flex justify-between">
								<span>Tarifa base</span>
								<span>{formatearPeso(p.tarifa_base)}</span>
							</p>
							{#each recs as r (r.codigo)}
								<p class="flex justify-between">
									<span>{r.nombre}</span>
									<span class="font-semibold">{formatearPeso(r.valor)}</span>
								</p>
							{/each}
						</div>
					{:else}
						<p class="mt-0.5 text-xs text-slate-500">Tarifa del trayecto (sin recargos)</p>
					{/if}
				</div>

				{#if p.observaciones}
					<p class="px-5 pb-2 text-sm text-slate-600">
						<span class="font-semibold text-slate-700">Observaciones:</span> {p.observaciones}
					</p>
				{/if}

				<div class="flex flex-wrap items-center gap-2 px-5 py-4">
					{#if accion}
						<input
							type="text"
							bind:value={notas[p.id]}
							placeholder="Nota (opcional)…"
							class="w-full min-w-40 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 transition placeholder:text-slate-400 focus:border-[#8BB4FF] focus:outline-none"
						/>
						<button
							type="button"
							onclick={() => avanzar(p)}
							disabled={guardando[p.id]}
							class="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:opacity-60"
						>
							{guardando[p.id] ? 'Guardando…' : accion.etiqueta}
						</button>
					{/if}
					{#if p.telefono}
						<!-- Teléfono del cliente visible (Tarea 2): solo en los pedidos asignados a este domiciliario. -->
						<span class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
							<Icon icon={Phone} class="size-3.5 text-primary" />
							{p.nombre_cliente ? `${p.nombre_cliente} · ` : ''}{p.telefono}
						</span>
						<BotonWhatsApp
							telefono={p.telefono}
							mensaje={mensajeWhatsAppDomiciliario(p.numero, p.nombre_cliente)}
							label="Escribir al cliente"
						/>
					{/if}
					<a
						href={urlNavegacion(p)}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition hover:border-[#8BB4FF] hover:text-primary-dark"
					>
						<Icon icon={MapPin} class="size-3.5" />
						Abrir navegación
					</a>
					<details class="ml-auto">
						<summary class="cursor-pointer text-xs font-medium text-primary-dark hover:underline">
							Historial ({p.historial.length})
						</summary>
						<ul class="mt-2 space-y-1.5 border-l-2 border-slate-200 pl-3">
							{#each p.historial as hito (hito.id)}
								<li class="text-xs text-slate-500">
									<span class="font-semibold text-slate-700">{etiquetaEstado(hito.estado)}</span>
									{hito.notas ? ` · ${hito.notas}` : ''}
									<span class="text-slate-400"> · {formatearFecha(hito.created_at)}</span>
								</li>
							{/each}
						</ul>
					</details>
				</div>
			</div>
		{/each}
	</div>
{:else if completados.length === 0}
	<div class="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 p-14 text-center text-sm text-slate-400">
		Todavía no has completado ninguna entrega.
	</div>
{:else}
	<div class="space-y-3">
		{#each completados as p (p.id)}
			{@const total = totalPedido(p)}
			<div class="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
				<p class="font-mono text-base font-black tracking-widest text-slate-900">{p.numero}</p>
				<p class="text-sm text-slate-500">
					{p.barrio_origen_nombre ?? '—'} → {p.barrio_destino_nombre ?? '—'}
				</p>
				<BadgeEstado estado={p.estado} />
				<div class="ml-auto text-right">
					<p class="font-bold text-slate-900">{formatearPeso(total)}</p>
				</div>
				<span class="text-xs text-slate-400">{formatearFecha(p.created_at)}</span>
			</div>
		{/each}
	</div>
{/if}
