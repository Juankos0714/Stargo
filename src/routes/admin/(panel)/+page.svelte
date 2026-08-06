<script lang="ts">
	import { page } from '$app/state';
	import { api } from '$lib/api';

	let stats = $state<{
		zonas: number | null;
		barrios: number | null;
		tarifas: number | null;
		pedidos: number | null;
		domiciliarios: number | null;
	}>({
		zonas: null,
		barrios: null,
		tarifas: null,
		pedidos: null,
		domiciliarios: null
	});
	let error = $state<string | null>(null);

	$effect(() => {
		(async () => {
			const [z, b, t, p, d] = await Promise.all([
				api.get<unknown[]>('/api/zonas?select=id'),
				api.get<unknown[]>('/api/barrios?select=id'),
				api.get<unknown[]>('/api/tarifas?select=id'),
				api.get<unknown[]>('/api/pedidos?estado=pendiente&select=id'),
				api.get<unknown[]>('/api/domiciliarios')
			]);
			if (z.error || b.error || t.error || p.error || d.error) {
				error = z.error ?? b.error ?? t.error ?? p.error ?? d.error;
			} else {
				stats = {
					zonas: z.data?.length ?? 0,
					barrios: b.data?.length ?? 0,
					tarifas: t.data?.length ?? 0,
					pedidos: p.data?.length ?? 0,
					domiciliarios: d.data?.length ?? 0
				};
			}
		})();
	});

	const acciones = [
		{
			href: '/admin/pedidos',
			label: 'Revisar pedidos',
			desc: 'Aceptar, despachar y actualizar el estado de los pedidos.',
			icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 12h6M9 16h6'
		},
		{
			href: '/admin/domiciliarios',
			label: 'Gestionar domiciliarios',
			desc: 'Registrar repartidores y activar o desactivar su acceso.',
			icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6'
		},
		{
			href: '/admin/zonas',
			label: 'Gestionar zonas',
			desc: 'Crear, editar y eliminar zonas tarifarias.',
			icon: 'M12 2 2 7l10 5 10-5-10-5zM2 12l10 5 10-5M2 17l10 5 10-5'
		},
		{
			href: '/admin/tarifas',
			label: 'Editar matriz de tarifas',
			desc: 'Precios origen → destino entre zonas.',
			icon: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18'
		},
		{
			href: '/admin/barrios',
			label: 'Asignar barrios',
			desc: 'Revisar y corregir la zona de cada barrio.',
			icon: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'
		},
		{
			href: '/calculadora',
			label: 'Probar calculadora',
			desc: 'Verifica el cálculo con datos reales.',
			icon: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z'
		}
	];
</script>

<header class="mb-8">
	<h1 class="text-2xl font-extrabold tracking-tight text-slate-900">
		Hola, {page.data.email?.split('@')[0]} 👋
	</h1>
	<p class="mt-1 text-sm text-slate-500">Así está configurada la tarifación hoy.</p>
</header>

{#if error}
	<div class="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
		Error al cargar estadísticas: {error}
	</div>
{/if}

<div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
	{#each [
		{ label: 'Pedidos pendientes', valor: stats.pedidos, hint: 'por atender', href: '/admin/pedidos' },
		{ label: 'Zonas', valor: stats.zonas, hint: 'zonas tarifarias', href: '/admin/zonas' },
		{ label: 'Barrios', valor: stats.barrios, hint: 'barrios en la ciudad', href: '/admin/barrios' },
		{ label: 'Tarifas', valor: stats.tarifas, hint: 'pares con precio definido', href: '/admin/tarifas' },
		{ label: 'Domiciliarios', valor: stats.domiciliarios, hint: 'repartidores registrados', href: '/admin/domiciliarios' }
	] as card (card.label)}
		<a
			href={card.href}
			class="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-primary hover:shadow-lg"
		>
			<p class="text-sm font-medium text-slate-500">{card.label}</p>
			<p class="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">
				{#if card.valor == null}
					<span class="inline-block size-7 animate-spin rounded-full border-2 border-primary border-t-transparent align-middle" ></span>
				{:else}
					{card.valor}
				{/if}
			</p>
			<p class="mt-1.5 text-xs text-slate-400 group-hover:text-primary-dark">{card.hint} →</p>
		</a>
	{/each}
</div>

<div class="mt-8">
	<h2 class="mb-4 text-sm font-bold tracking-wide text-slate-500 uppercase">Accesos rápidos</h2>
	<div class="grid gap-4 sm:grid-cols-2">
		{#each acciones as accion (accion.href)}
			<a
				href={accion.href}
				class="group flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-primary hover:shadow-md"
			>
				<div class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary-dark transition group-hover:bg-primary group-hover:text-white">
					<svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d={accion.icon} />
					</svg>
				</div>
				<div>
					<p class="font-semibold text-slate-900">{accion.label}</p>
					<p class="mt-0.5 text-sm text-slate-500">{accion.desc}</p>
				</div>
			</a>
		{/each}
	</div>
</div>

<p class="mt-8 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
	💡 Recuerda: la matriz es simétrica. Si un trayecto no tiene tarifa directa, la calculadora usa la del sentido inverso.
</p>
