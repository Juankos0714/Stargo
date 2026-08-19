<script lang="ts">
	import { api } from '$lib/api';
	import { hidratarSesionRealtime } from '$lib/supabase-browser';
	import { debounce, suscribirCambios, type RealtimeEstado } from '$lib/realtime';
	import IndicadorRealtime from '$lib/components/IndicadorRealtime.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { ClipboardList, History, CircleCheck, TriangleAlert, Gauge, RotateCw, Save, Lightbulb } from 'lucide';
	import { formatearDuracion } from '$lib/logic/metricas';
	import type { MetricasDashboard, AlertaRegistrada, CambioTarifa } from '$lib/server/metricas';

	let metricas = $state<MetricasDashboard | null>(null);
	let cargando = $state(true);
	let error = $state<string | null>(null);
	let estadoRealtime = $state<RealtimeEstado>('conectando');
	let ultimaActualizacion = $state<string | null>(null);
	let refrescando = $state(false);

	// ---------- Carga ----------
	let cargarId = 0;
	async function cargar(manual = false) {
		const id = ++cargarId;
		if (manual) refrescando = true;
		const r = await api.get<MetricasDashboard>('/api/metricas');
		if (id !== cargarId) return;
		cargando = false;
		refrescando = false;
		if (r.error) {
			error = r.error;
			return;
		}
		error = null;
		metricas = r.data;
		ultimaActualizacion = new Date().toLocaleTimeString('es-CO');
	}

	const cargarDebounced = debounce(() => cargar(), 250);

	$effect(() => {
		cargar();
		// Poll cada 30 s: los errores y alertas no emiten eventos Realtime.
		const timer = setInterval(() => cargar(), 30_000);
		// Refresca en vivo ante cambios de pedidos (Realtime).
		let activo = true;
		let limpiar: (() => void) | undefined;
		hidratarSesionRealtime().then(() => {
			if (!activo) return;
			limpiar = suscribirCambios({
				tabla: 'pedidos',
				onCambio: () => cargarDebounced(),
				onEstado: (estado) => {
					estadoRealtime = estado;
					if (estado === 'conectado') cargarDebounced();
				}
			});
		});
		return () => {
			clearInterval(timer);
			activo = false;
			limpiar?.();
		};
	});

	// ---------- Derivados de la vista ----------
	const tarjetas = $derived.by(() => {
		if (!metricas) return [];
		return [
			{
				label: 'Pedidos activos',
				valor: String(metricas.pedidos_activos),
				icon: ClipboardList,
				hint: 'pendientes + en curso',
				color: 'bg-primary-light text-primary'
			},
			{
				label: 'Tiempo prom. asignación',
				valor: formatearDuracion(metricas.tiempo_asignacion_prom_min),
				icon: History,
				hint: 'últimas 24 h',
				color: 'bg-sky-50 text-sky-600'
			},
			{
				label: 'Tiempo prom. entrega',
				valor: formatearDuracion(metricas.tiempo_entrega_prom_min),
				icon: CircleCheck,
				hint: 'últimas 24 h',
				color: 'bg-green-50 text-green-600'
			},
			{
				label: 'Errores por minuto',
				valor: metricas.errores_por_minuto.toFixed(2),
				icon: TriangleAlert,
				hint: `${metricas.errores_ultima_hora} en la última hora`,
				color: 'bg-red-50 text-red-500'
			}
		];
	});

	const NIVELES: Record<AlertaRegistrada['nivel'], { label: string; clase: string }> = {
		info: { label: 'Info', clase: 'bg-sky-50 text-sky-700 border-sky-200' },
		warning: { label: 'Advertencia', clase: 'bg-amber-50 text-amber-700 border-amber-200' },
		critical: { label: 'Crítica', clase: 'bg-red-50 text-red-700 border-red-200' }
	};

	const OPERACIONES: Record<CambioTarifa['operacion'], string> = {
		INSERT: 'Creó',
		UPDATE: 'Editó',
		DELETE: 'Eliminó'
	};

	function fechaHora(iso: string): string {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getDate()}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
	}
</script>

<svelte:head>
	<title>Métricas — StarGo Admin</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-slate-900">
			Métricas
			<Icon icon={Gauge} class="size-6 text-primary" />
		</h1>
		<p class="mt-1 text-sm text-slate-500">
			Estado de la operación en tiempo real: pedidos activos, tiempos promedio, errores y alertas.
		</p>
	</div>
	<div class="flex items-center gap-2">
		<IndicadorRealtime estado={estadoRealtime} />
		<button
			type="button"
			onclick={() => cargar(true)}
			disabled={refrescando}
			class="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
		>
			<Icon icon={RotateCw} class="size-3.5 {refrescando ? 'animate-spin' : ''}" />
			Actualizar
		</button>
	</div>
</header>

{#if error}
	<div class="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
		No se pudieron cargar las métricas: {error}
	</div>
{/if}

{#if cargando && !metricas}
	<div class="flex items-center justify-center gap-3 py-24 text-slate-500">
		<span class="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
		Cargando métricas…
	</div>
{:else if metricas}
	<!-- Tarjetas -->
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		{#each tarjetas as tarjeta (tarjeta.label)}
			<div class="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
				<div class="flex items-center justify-between">
					<p class="text-xs font-semibold tracking-wide text-slate-500 uppercase">{tarjeta.label}</p>
					<span class="flex size-8 items-center justify-center rounded-lg {tarjeta.color}">
						<Icon icon={tarjeta.icon} class="size-4" />
					</span>
				</div>
				<p class="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">{tarjeta.valor}</p>
				<p class="mt-1 text-xs text-slate-400">{tarjeta.hint}</p>
			</div>
		{/each}
	</div>

	{#if ultimaActualizacion}
		<p class="mt-3 text-xs text-slate-400">Actualizado a las {ultimaActualizacion} · se refresca cada 30 s y con Realtime.</p>
	{/if}

	<div class="mt-6 grid gap-6 lg:grid-cols-2">
		<!-- Alertas recientes -->
		<section class="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
			<div class="flex items-center justify-between border-b border-slate-100 px-5 py-4">
				<h2 class="text-sm font-bold tracking-wide text-slate-500 uppercase">Alertas recientes</h2>
				<Icon icon={TriangleAlert} class="size-4 text-amber-500" />
			</div>
			{#if metricas.alertas_recientes.length === 0}
				<p class="p-8 text-center text-sm text-slate-400">Sin alertas registradas.</p>
			{:else}
				<ul class="divide-y divide-slate-100">
					{#each metricas.alertas_recientes as alerta (alerta.id)}
						<li class="flex items-start gap-3 px-5 py-3">
							<span class="mt-0.5 inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold {NIVELES[alerta.nivel].clase}">
								{NIVELES[alerta.nivel].label}
							</span>
							<div class="min-w-0 flex-1">
								<p class="text-sm font-semibold text-slate-800">{alerta.evento}</p>
								{#if alerta.detalle}
									<p class="mt-0.5 line-clamp-2 text-xs text-slate-500">{alerta.detalle}</p>
								{/if}
							</div>
							<span class="shrink-0 text-[10px] text-slate-400">{fechaHora(alerta.created_at)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- Auditoría de tarifas -->
		<section class="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
			<div class="flex items-center justify-between border-b border-slate-100 px-5 py-4">
				<h2 class="text-sm font-bold tracking-wide text-slate-500 uppercase">Cambios recientes de tarifas</h2>
				<Icon icon={Save} class="size-4 text-primary-dark" />
			</div>
			{#if metricas.historial_tarifas.length === 0}
				<p class="p-8 text-center text-sm text-slate-400">Sin cambios de tarifas registrados.</p>
			{:else}
				<ul class="divide-y divide-slate-100">
					{#each metricas.historial_tarifas as cambio (cambio.id)}
						<li class="flex items-start gap-3 px-5 py-3">
							<span class="mt-0.5 inline-flex shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
								{OPERACIONES[cambio.operacion]}
							</span>
							<div class="min-w-0 flex-1">
								<p class="text-sm font-semibold text-slate-800">
									{cambio.zona_origen_id ?? '?'} → {cambio.zona_destino_id ?? '?'}
								</p>
								<p class="mt-0.5 text-xs text-slate-500">
									{#if cambio.operacion === 'DELETE'}
										<span class="font-semibold text-red-500 line-through">{cambio.valor_antes}</span>
									{:else}
										{#if cambio.valor_antes !== null}
											<span class="line-through">{cambio.valor_antes}</span> →
										{/if}
										<span class="font-semibold text-emerald-600">{cambio.valor_despues}</span>
									{/if}
								</p>
							</div>
							<span class="shrink-0 text-[10px] text-slate-400">{fechaHora(cambio.created_at)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>

	<p class="mt-6 flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
		<Icon icon={Lightbulb} class="mt-0.5 size-4 shrink-0 text-amber-500" />
		<span>
			El historial de tarifas es la auditoría de la sección 14: si un cálculo salió mal, aquí ves quién y
			cuándo cambió la matriz. Para verificar las alertas, llama a <code class="rounded bg-slate-100 px-1">/api/cron/alertas?prueba=1</code>
			o a <code class="rounded bg-slate-100 px-1">POST /api/alertas/probar</code> (provoca un error 500 a propósito).
		</span>
	</p>
{/if}
