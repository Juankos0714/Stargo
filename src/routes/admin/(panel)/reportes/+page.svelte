<script lang="ts">
	import { api } from '$lib/api';
	import { hidratarSesionRealtime } from '$lib/supabase-browser';
	import { debounce, suscribirCambios, type RealtimeEstado } from '$lib/realtime';
	import IndicadorRealtime from '$lib/components/IndicadorRealtime.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { ClipboardList, CircleCheck, Ban, Coins, Receipt, TrendingUp, Ticket, CalendarDays, Download, Users } from 'lucide';
	import {
		ESTADOS_PEDIDO,
		etiquetaEstado,
		formatearPeso,
		type EstadoPedido,
		type Reporte
	} from '$lib/types';

	// ---------- Estado del rango de fechas ----------
	function aISO(d: Date): string {
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	}
	function hoy(): string {
		return aISO(new Date());
	}
	function inicioMes(): string {
		const d = new Date();
		return aISO(new Date(d.getFullYear(), d.getMonth(), 1));
	}

	let desde = $state(inicioMes());
	let hasta = $state(hoy());
	let reporte = $state<Reporte | null>(null);
	let cargando = $state(true);
	let error = $state<string | null>(null);
	let metrica = $state<'total' | 'entregados' | 'cancelados'>('total');
	let estadoRealtime = $state<RealtimeEstado>('conectando');

	const query = $derived.by(() => {
		const q = new URLSearchParams();
		if (desde) q.set('desde', desde);
		if (hasta) q.set('hasta', hasta);
		return q.toString();
	});

	const presets: { valor: 'hoy' | 'ayer' | 'semana' | 'mes' | 'mesPasado' | 'todo'; label: string }[] = [
		{ valor: 'hoy', label: 'Hoy' },
		{ valor: 'ayer', label: 'Ayer' },
		{ valor: 'semana', label: 'Esta semana' },
		{ valor: 'mes', label: 'Este mes' },
		{ valor: 'mesPasado', label: 'Mes pasado' },
		{ valor: 'todo', label: 'Todo' }
	];

	function aplicarPreset(p: (typeof presets)[number]['valor']) {
		const ahora = new Date();
		if (p === 'hoy') {
			desde = hoy();
			hasta = hoy();
		} else if (p === 'ayer') {
			const a = new Date(ahora);
			a.setDate(a.getDate() - 1);
			const s = aISO(a);
			desde = s;
			hasta = s;
		} else if (p === 'semana') {
			const d = new Date(ahora);
			const dia = d.getDay() === 0 ? 6 : d.getDay() - 1; // lunes
			d.setDate(d.getDate() - dia);
			desde = aISO(d);
			hasta = hoy();
		} else if (p === 'mes') {
			desde = inicioMes();
			hasta = hoy();
		} else if (p === 'mesPasado') {
			const inicio = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
			const fin = new Date(ahora.getFullYear(), ahora.getMonth(), 0);
			desde = aISO(inicio);
			hasta = aISO(fin);
		} else {
			desde = '';
			hasta = '';
		}
	}

	function fechaCorta(iso: string): string {
		if (!iso) return 'Inicio';
		const [y, m, d] = iso.split('-').map(Number);
		return new Date(y, m - 1, d).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
	}

	// ---------- Carga ----------
	// Si cambia el rango antes de que responda la petición, se descarta la respuesta vieja.
	let cargarId = 0;
	async function cargar() {
		const id = ++cargarId;
		error = null;
		const r = await api.get<Reporte>(`/api/reportes?${query}`);
		if (id !== cargarId) return;
		cargando = false;
		if (r.error) {
			error = r.error;
			return;
		}
		reporte = r.data;
	}

	const cargarDebounced = debounce(() => cargar(), 250);

	$effect(() => {
		// Se dispara al cambiar desde/hasta (los presets y los inputs).
		cargando = true;
		cargar();
		return () => {
			cargando = false;
		};
	});

	$effect(() => {
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
			activo = false;
			limpiar?.();
		};
	});

	// ---------- Derivados de la vista ----------
	const resumen = $derived(reporte?.resumen ?? null);

	const tarjetas = $derived.by(() => {
		if (!resumen) return [];
		return [
			{ label: 'Total pedidos', valor: resumen.total, icon: ClipboardList, hint: 'en el rango', color: 'bg-primary-light text-primary' },
			{ label: 'Entregados', valor: resumen.entregados, icon: CircleCheck, hint: 'completados', color: 'bg-green-50 text-green-600' },
			{ label: 'Cancelados', valor: resumen.cancelados, icon: Ban, hint: 'anulados', color: 'bg-red-50 text-red-500' },
			{
				label: 'Ganancia bruta',
				valor: formatearPeso(resumen.ingresos),
				icon: Coins,
				hint: 'total de los entregados',
				color: 'bg-emerald-50 text-emerald-600'
			},
			{
				label: 'Comisiones a pagar',
				valor: formatearPeso(resumen.comisiones_pagadas),
				icon: Receipt,
				hint: 'comisión diaria de domiciliarios',
				color: 'bg-amber-50 text-amber-600'
			},
			{
				label: 'Ganancia neta',
				valor: formatearPeso(resumen.ingresos_netos),
				icon: TrendingUp,
				hint: 'bruta − comisiones',
				color: 'bg-violet-50 text-violet-600'
			},
			{
				label: 'Ticket promedio',
				valor: formatearPeso(resumen.ticket_promedio),
				icon: Ticket,
				hint: 'por entrega',
				color: 'bg-sky-50 text-sky-600'
			}
		];
	});

	const estadosConDatos = $derived(
		(Object.keys(ESTADOS_PEDIDO) as EstadoPedido[]).map((estado) => ({
			estado,
			label: etiquetaEstado(estado),
			conteo: resumen?.por_estado[estado] ?? 0,
			color: ESTADOS_PEDIDO[estado].color.split(' ')[0] ?? 'bg-slate-200'
		}))
	);
	const maxEstado = $derived(Math.max(1, ...estadosConDatos.map((e) => e.conteo)));

	const seriesVisibles = $derived(reporte?.series ?? []);
	const maxSerie = $derived(Math.max(1, ...seriesVisibles.map((s) => s[metrica])));
	const diasConDatos = $derived(seriesVisibles.filter((s) => s.total > 0).length);
	const mostrarEtiquetas = $derived(seriesVisibles.length > 0 && seriesVisibles.length <= 31);

	/** Índices a los que mostrar la fecha bajo la gráfica (máx. ~6 etiquetas). */
	const etiquetasSerie = $derived.by(() => {
		if (!mostrarEtiquetas) return new Set<number>();
		const total = seriesVisibles.length;
		if (total <= 8) return new Set(seriesVisibles.map((_, i) => i));
		const paso = Math.ceil(total / 6);
		return new Set(seriesVisibles.map((_, i) => (i % paso === 0 ? i : -1)).filter((i) => i >= 0));
	});
</script>

<svelte:head>
	<title>Reportes — StarGo Admin</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-2xl font-extrabold tracking-tight text-slate-900">Reportes</h1>
		<p class="mt-1 text-sm text-slate-500">
			Pedidos por día, ingresos, desempeño por domiciliario y cancelaciones — con exportación a CSV.
		</p>
	</div>
	<IndicadorRealtime estado={estadoRealtime} />
</header>

{#if error}
	<div class="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
		No se pudo generar el reporte: {error}
	</div>
{/if}

<!-- Filtros -->
<section class="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
	<div class="flex flex-wrap items-end gap-4">
		<div class="flex flex-wrap items-center gap-1.5">
			{#each presets as preset (preset.valor)}
				<button
					type="button"
					onclick={() => aplicarPreset(preset.valor)}
					class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-800"
				>
					{preset.label}
				</button>
			{/each}
		</div>

		<div class="flex flex-wrap items-center gap-3">
			<label class="flex items-center gap-2 text-sm font-medium text-slate-600">
				<Icon icon={CalendarDays} class="size-4 text-slate-400" />
				<input
					type="date"
					bind:value={desde}
					max={hasta || undefined}
					class="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700 transition focus:border-primary focus:bg-white focus:outline-none"
				/>
			</label>
			<span class="text-xs text-slate-400">hasta</span>
			<label class="flex items-center gap-2 text-sm font-medium text-slate-600">
				<input
					type="date"
					bind:value={hasta}
					min={desde || undefined}
					class="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700 transition focus:border-primary focus:bg-white focus:outline-none"
				/>
			</label>
			<a
				href={`/api/reportes/csv?${query}`}
				class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-dark"
			>
				<Icon icon={Download} class="size-4" />
				Exportar CSV
			</a>
		</div>
	</div>
	<p class="mt-3 text-xs text-slate-400">
		{desde ? `Del ${fechaCorta(desde)} al ${hasta ? fechaCorta(hasta) : 'hoy'}` : 'Todo el historial'}
		· {cargando ? 'calculando…' : `${resumen?.total ?? 0} pedidos en el rango`}
	</p>
</section>

{#if cargando && !reporte}
	<div class="flex items-center justify-center gap-3 py-24 text-slate-500">
		<span class="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
		Generando reporte…
	</div>
{:else if resumen}
	<!-- Tarjetas de resumen -->
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		{#each tarjetas as tarjeta (tarjeta.label)}
			<div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
				<div class="flex items-center justify-between">
					<p class="text-xs font-semibold tracking-wide text-slate-500 uppercase">{tarjeta.label}</p>
					<span class="flex size-8 items-center justify-center rounded-lg {tarjeta.color}">
						<Icon icon={tarjeta.icon} class="size-4" />
					</span>
				</div>
				<p class="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">{tarjeta.valor}</p>
				<p class="mt-1 text-xs text-slate-400">{tarjeta.hint}</p>
			</div>
		{/each}
	</div>

	<div class="mt-6 grid gap-6 lg:grid-cols-5">
		<!-- Gráfica por día -->
		<section class="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-3">
			<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
				<h2 class="text-sm font-bold tracking-wide text-slate-500 uppercase">Pedidos por día</h2>
				<div class="flex gap-1 rounded-lg bg-slate-100 p-0.5">
					{#each [
						{ valor: 'total', label: 'Total' },
						{ valor: 'entregados', label: 'Entregados' },
						{ valor: 'cancelados', label: 'Cancelados' }
					] as op (op.valor)}
						<button
							type="button"
							onclick={() => (metrica = op.valor as typeof metrica)}
							class="rounded-md px-2.5 py-1 text-xs font-semibold transition {metrica === op.valor
								? 'bg-white text-slate-900 shadow-sm'
								: 'text-slate-500 hover:text-slate-700'}"
						>
							{op.label}
						</button>
					{/each}
				</div>
			</div>

			{#if seriesVisibles.length === 0}
				<p class="py-12 text-center text-sm text-slate-400">Sin actividad en este rango.</p>
			{:else}
				<div class="flex h-44 items-end gap-[3px]">
					{#each seriesVisibles as s (s.fecha)}
						<div
							class="group relative flex flex-1 flex-col items-center justify-end"
							title={`${s.fecha} · ${s.total} pedidos · ${s.entregados} entregados · ${formatearPeso(s.ingresos)}`}
						>
							<span
								class="pointer-events-none absolute -top-7 z-10 hidden rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white group-hover:block"
							>
								{s[metrica]}
							</span>
							<div
								class="w-full rounded-t-sm transition {metrica === 'entregados'
									? 'bg-green-400 group-hover:bg-green-500'
									: metrica === 'cancelados'
										? 'bg-red-400 group-hover:bg-red-500'
										: 'bg-primary/70 group-hover:bg-primary'}"
								style="height: {Math.max(s[metrica] > 0 ? 4 : 0, Math.round((s[metrica] / maxSerie) * 176))}px"
							></div>
						</div>
					{/each}
				</div>
				<div class="mt-2 flex justify-between text-[10px] text-slate-400">
					{#if mostrarEtiquetas}
						{#each seriesVisibles as s (s.fecha)}
							<span class="flex-1 text-center {etiquetasSerie.has(seriesVisibles.indexOf(s)) ? '' : 'opacity-0'}">
								{s.fecha.slice(5)}
							</span>
						{/each}
					{:else}
						<span>Días con pedidos: {diasConDatos} de {seriesVisibles.length}</span>
						<span>{fechaCorta(seriesVisibles[0].fecha)} → {fechaCorta(seriesVisibles[seriesVisibles.length - 1].fecha)}</span>
					{/if}
				</div>
			{/if}
		</section>

		<!-- Estado y domiciliarios disponibles -->
		<section class="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
			<h2 class="mb-4 text-sm font-bold tracking-wide text-slate-500 uppercase">Distribución por estado</h2>
			<ul class="space-y-3">
				{#each estadosConDatos as fila (fila.estado)}
					<li>
						<div class="flex items-center justify-between text-xs">
							<span class="flex items-center gap-2 font-medium text-slate-700">
								<span class="size-2 rounded-full {fila.color}"></span>
								{fila.label}
							</span>
							<span class="font-semibold text-slate-900">
								{fila.conteo}
								<span class="ml-1 font-normal text-slate-400">
									{resumen.total > 0 ? `${Math.round((fila.conteo / resumen.total) * 100)}%` : ''}
								</span>
							</span>
						</div>
						<div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
							<div class="h-full rounded-full bg-primary/60 transition-all" style="width: {Math.round((fila.conteo / maxEstado) * 100)}%"></div>
						</div>
					</li>
				{/each}
			</ul>

			<div class="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
				<div class="flex items-center justify-between">
					<p class="flex items-center gap-2 text-xs font-bold tracking-wide text-slate-500 uppercase">
						<Icon icon={Users} class="size-3.5" />
						Domiciliarios disponibles
					</p>
					<span class="text-xl font-extrabold text-slate-900">{resumen.domiciliarios_disponibles}</span>
				</div>
				<p class="mt-1 text-xs text-slate-500">
					{resumen.domiciliarios_ocupados} de {resumen.domiciliarios_activos} activos están con un pedido en curso.
				</p>
			</div>
		</section>
	</div>

	<!-- Por domiciliario -->
	<section class="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
		<div class="border-b border-slate-100 px-5 py-4">
			<h2 class="text-sm font-bold tracking-wide text-slate-500 uppercase">Pedidos por domiciliario</h2>
		</div>
		{#if (reporte?.por_domiciliario ?? []).length === 0}
			<p class="p-8 text-center text-sm text-slate-400">No hay pedidos en este rango.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase">
							<th class="px-5 py-3">Domiciliario</th>
							<th class="px-5 py-3 text-right">Pedidos</th>
							<th class="px-5 py-3 text-right">Entregados</th>
							<th class="px-5 py-3 text-right">Cancelados</th>
							<th class="px-5 py-3 text-right">Ingresos</th>
						</tr>
					</thead>
					<tbody>
						{#each reporte?.por_domiciliario ?? [] as fila (fila.id ?? 'sin-asignar')}
							<tr class="border-b border-slate-100 transition hover:bg-slate-50/60">
								<td class="px-5 py-3">
									<span class="inline-flex items-center gap-2 font-medium text-slate-800">
										<span class="flex size-7 items-center justify-center rounded-full bg-primary-light text-[11px] font-bold text-primary">
											{fila.nombre.charAt(0).toUpperCase()}
										</span>
										{fila.nombre}
										{#if !fila.id}
											<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">sin asignar</span>
										{/if}
									</span>
								</td>
								<td class="px-5 py-3 text-right font-bold text-slate-900">{fila.total}</td>
								<td class="px-5 py-3 text-right text-green-600">{fila.entregados}</td>
								<td class="px-5 py-3 text-right text-red-500">{fila.cancelados}</td>
								<td class="px-5 py-3 text-right font-semibold whitespace-nowrap text-slate-900">{formatearPeso(fila.ingresos)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
{:else}
	<p class="py-16 text-center text-sm text-slate-400">No hay datos para mostrar.</p>
{/if}
