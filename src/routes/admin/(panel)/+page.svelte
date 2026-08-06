<script lang="ts">
	import { page } from '$app/state';
	import { api } from '$lib/api';
	import { hidratarSesionRealtime } from '$lib/supabase-browser';
	import { debounce, suscribirCambios, type RealtimeEstado } from '$lib/realtime';
	import IndicadorRealtime from '$lib/components/IndicadorRealtime.svelte';
	import BadgeEstado from '$lib/components/BadgeEstado.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import {
		formatearPeso,
		type HistorialEstado,
		type Pedido,
		type Reporte
	} from '$lib/types';

	interface PedidoFila extends Pedido {
		barrio_origen_nombre: string | null;
		barrio_destino_nombre: string | null;
		domiciliario_nombre: string | null;
		historial: HistorialEstado[];
	}

	function aISO(d: Date): string {
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	}

	let hoyStats = $state<Reporte['resumen'] | null>(null);
	let recientes = $state<PedidoFila[]>([]);
	let config = $state<{ zonas: number | null; barrios: number | null; tarifas: number | null }>({
		zonas: null,
		barrios: null,
		tarifas: null
	});
	let cargando = $state(true);
	let error = $state<string | null>(null);
	let estadoRealtime = $state<RealtimeEstado>('conectando');

	function formatearFecha(iso: string): string {
		return new Date(iso).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// Descarta respuestas obsoletas si llegan varias cargas encadenadas (Realtime).
	let cargarId = 0;
	async function cargar() {
		const id = ++cargarId;
		cargando = true;
		error = null;
		const hoyISO = aISO(new Date());
		const [r, p, z, b, t] = await Promise.all([
			api.get<Reporte>(`/api/reportes?desde=${hoyISO}&hasta=${hoyISO}`),
			api.get<PedidoFila[]>('/api/pedidos'),
			api.get<unknown[]>('/api/zonas?select=id'),
			api.get<unknown[]>('/api/barrios?select=id'),
			api.get<unknown[]>('/api/tarifas?select=id')
		]);
		if (id !== cargarId) return;
		cargando = false;
		if (r.error) {
			error = r.error;
			return;
		}
		hoyStats = r.data?.resumen ?? null;
		if (!p.error) recientes = (p.data ?? []).slice(0, 6);
		config = {
			zonas: z.error ? null : (z.data?.length ?? 0),
			barrios: b.error ? null : (b.data?.length ?? 0),
			tarifas: t.error ? null : (t.data?.length ?? 0)
		};
	}

	const cargarDebounced = debounce(() => cargar(), 250);

	$effect(() => {
		let activo = true;
		let limpiar: (() => void)[] = [];
		hidratarSesionRealtime().then(() => {
			if (!activo) return;
			limpiar = ['pedidos', 'domiciliarios'].map((tabla) =>
				suscribirCambios({
					tabla: tabla as 'pedidos' | 'domiciliarios',
					onCambio: () => cargarDebounced(),
					onEstado: (estado) => {
						estadoRealtime = estado;
						if (estado === 'conectado') cargarDebounced();
					}
				})
			);
		});
		cargar();
		return () => {
			activo = false;
			limpiar.forEach((fn) => fn?.());
		};
	});

	const tarjetas = $derived([
		{
			label: 'Pedidos pendientes',
			valor: hoyStats?.por_estado.pendiente ?? null,
			hint: 'por atender',
			icon: 'clock-rotate-left',
			color: 'bg-amber-50 text-amber-600',
			href: '/admin/pedidos'
		},
		{
			label: 'En proceso',
			valor: hoyStats?.en_proceso ?? null,
			hint: 'asignados y en ruta',
			icon: 'truck-fast',
			color: 'bg-sky-50 text-sky-600',
			href: '/admin/pedidos'
		},
		{
			label: 'Entregados hoy',
			valor: hoyStats?.entregados ?? null,
			hint: 'completados el día de hoy',
			icon: 'circle-check',
			color: 'bg-green-50 text-green-600',
			href: '/admin/pedidos'
		},
		{
			label: 'Cancelados hoy',
			valor: hoyStats?.cancelados ?? null,
			hint: 'anulados el día de hoy',
			icon: 'ban',
			color: 'bg-red-50 text-red-500',
			href: '/admin/pedidos'
		},
		{
			label: 'Ingresos hoy',
			valor: hoyStats ? formatearPeso(hoyStats.ingresos) : null,
			hint: 'suma de entregados',
			icon: 'coins',
			color: 'bg-emerald-50 text-emerald-600',
			href: '/admin/reportes'
		},
		{
			label: 'Domiciliarios disponibles',
			valor: hoyStats?.domiciliarios_disponibles ?? null,
			hint: hoyStats
				? `${hoyStats.domiciliarios_ocupados} de ${hoyStats.domiciliarios_activos} activos ocupados`
				: 'repartidores activos',
			icon: 'users',
			color: 'bg-primary-light text-primary',
			href: '/admin/domiciliarios'
		}
	]);

	const configCards = $derived([
		{ label: 'Zonas', valor: config.zonas, icon: 'layer-group', href: '/admin/zonas' },
		{ label: 'Barrios', valor: config.barrios, icon: 'location-dot', href: '/admin/barrios' },
		{ label: 'Tarifas', valor: config.tarifas, icon: 'table-cells', href: '/admin/tarifas' }
	]);

	const acciones = [
		{
			href: '/admin/pedidos',
			label: 'Revisar pedidos',
			desc: 'Aceptar, despachar y actualizar el estado de los pedidos.',
			icon: 'clipboard-list'
		},
		{
			href: '/admin/domiciliarios',
			label: 'Gestionar domiciliarios',
			desc: 'Registrar repartidores y activar o desactivar su acceso.',
			icon: 'users'
		},
		{
			href: '/admin/reportes',
			label: 'Ver reportes',
			desc: 'Pedidos por día, ingresos, cancelaciones y exportación a CSV.',
			icon: 'chart-column'
		},
		{
			href: '/admin/zonas',
			label: 'Gestionar zonas',
			desc: 'Crear, editar y eliminar zonas tarifarias.',
			icon: 'layer-group'
		},
		{
			href: '/admin/tarifas',
			label: 'Editar matriz de tarifas',
			desc: 'Precios origen → destino entre zonas.',
			icon: 'table-cells'
		},
		{
			href: '/admin/barrios',
			label: 'Asignar barrios',
			desc: 'Revisar y corregir la zona de cada barrio.',
			icon: 'location-dot'
		},
		{
			href: '/calculadora',
			label: 'Probar calculadora',
			desc: 'Verifica el cálculo de tarifas con datos reales.',
			icon: 'pen-to-square'
		}
	];
</script>

<svelte:head>
	<title>Resumen — StarGo Admin</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-slate-900">
			Hola, {page.data.email?.split('@')[0]}
			<Icon name="face-smile-beam" class="size-6 text-primary" />
		</h1>
		<p class="mt-1 text-sm text-slate-500">Así va la operación hoy.</p>
	</div>
	<IndicadorRealtime estado={estadoRealtime} />
</header>

{#if error}
	<div class="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
		Error al cargar el resumen: {error}
	</div>
{/if}	<!-- Estadísticas de operación -->
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
		{#each tarjetas as tarjeta (tarjeta.label)}
		<a
			href={tarjeta.href}
			class="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary hover:shadow-lg"
		>
			<div class="flex items-center justify-between">
				<p class="text-xs font-semibold tracking-wide text-slate-500 uppercase">{tarjeta.label}</p>
				<span class="flex size-8 items-center justify-center rounded-lg {tarjeta.color}">
					<Icon name={tarjeta.icon} class="size-4" />
				</span>
			</div>
			<p class="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">
				{#if tarjeta.valor == null}
					<span class="inline-block size-6 animate-spin rounded-full border-2 border-primary border-t-transparent align-middle"></span>
				{:else}
					{tarjeta.valor}
				{/if}
			</p>
			<p class="mt-1 text-xs text-slate-400 group-hover:text-primary-dark">{tarjeta.hint} →</p>
		</a>
	{/each}
</div>

<div class="mt-6 grid gap-6 lg:grid-cols-5">
	<!-- Actividad reciente -->
	<section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:col-span-3">
		<div class="flex items-center justify-between border-b border-slate-100 px-5 py-4">
			<h2 class="text-sm font-bold tracking-wide text-slate-500 uppercase">Actividad reciente</h2>
			<a href="/admin/pedidos" class="text-xs font-semibold text-primary-dark hover:underline">
				Ver todos →
			</a>
		</div>
		{#if recientes.length === 0}
			<p class="p-10 text-center text-sm text-slate-400">
				{cargando ? 'Cargando pedidos…' : 'Aún no hay pedidos registrados.'}
			</p>
		{:else}
			<ul class="divide-y divide-slate-100">
				{#each recientes as p (p.id)}
					<li class="flex items-center gap-4 px-5 py-3.5 transition hover:bg-slate-50/60">
						<div class="min-w-0 flex-1">
							<p class="flex items-center gap-2">
								<span class="font-mono text-sm font-bold text-slate-900">{p.numero}</span>
								<BadgeEstado estado={p.estado} size="xs" />
							</p>
							<p class="mt-0.5 truncate text-xs text-slate-500">
								{p.barrio_origen_nombre ?? p.zona_origen_id ?? '—'} → {p.barrio_destino_nombre ?? p.zona_destino_id ?? '—'}
								{p.domiciliario_nombre ? ` · ${p.domiciliario_nombre}` : ''}
							</p>
						</div>
						<div class="shrink-0 text-right">
							<p class="text-sm font-bold whitespace-nowrap text-slate-900">{formatearPeso(p.tarifa_base)}</p>
							<p class="text-[10px] text-slate-400">{formatearFecha(p.created_at)}</p>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Configuración -->
	<section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
		<h2 class="mb-4 text-sm font-bold tracking-wide text-slate-500 uppercase">Configuración</h2>
		<div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
			{#each configCards as card (card.label)}
				<a
					href={card.href}
					class="group rounded-xl border border-slate-200 bg-slate-50 p-4 transition hover:border-primary hover:bg-white hover:shadow-sm"
				>
					<div class="flex items-center gap-2 text-xs font-semibold text-slate-500">
						<Icon name={card.icon} class="size-3.5 text-primary" />
						{card.label}
					</div>
					<p class="mt-2 text-2xl font-extrabold text-slate-900">
						{#if card.valor == null}
							<span class="inline-block size-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
						{:else}
							{card.valor}
						{/if}
					</p>
				</a>
			{/each}
		</div>

		<div class="mt-6">
			<h2 class="mb-3 text-sm font-bold tracking-wide text-slate-500 uppercase">Accesos rápidos</h2>
			<ul class="space-y-1.5">
				{#each acciones as accion (accion.href)}
					<li>
						<a
							href={accion.href}
							class="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 transition hover:border-primary hover:shadow-sm"
						>
							<span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary-dark transition group-hover:bg-primary group-hover:text-white">
								<Icon name={accion.icon} class="size-4" />
							</span>
							<div class="min-w-0">
								<p class="text-sm font-semibold text-slate-900">{accion.label}</p>
								<p class="truncate text-xs text-slate-500">{accion.desc}</p>
							</div>
						</a>
					</li>
				{/each}
			</ul>
		</div>
	</section>
</div>

<p class="mt-6 flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
	<Icon name="lightbulb" class="mt-0.5 size-4 shrink-0 text-amber-500" />
	<span>
		Los «Ingresos» suman solo pedidos entregados; los cancelados se muestran aparte. El resumen se actualiza en tiempo real.
	</span>
</p>
