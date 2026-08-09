<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import Logo from '$lib/components/Logo.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import CentroNotificaciones from '$lib/components/CentroNotificaciones.svelte';

	let { children } = $props();

	// Menú móvil (Tarea 2): en vez del scroll horizontal se abre un drawer.
	let menuAbierto = $state(false);

	const nav = [
		{
			href: '/admin',
			label: 'Resumen',
			icon: 'house'
		},
		{
			href: '/admin/pedidos',
			label: 'Pedidos',
			icon: 'clipboard-list'
		},
		{
			href: '/admin/reportes',
			label: 'Reportes',
			icon: 'chart-column'
		},
		{
			href: '/admin/metricas',
			label: 'Métricas',
			icon: 'gauge-high'
		},
		{
			href: '/admin/domiciliarios',
			label: 'Domiciliarios',
			icon: 'users'
		},
		{
			href: '/admin/comisiones',
			label: 'Comisiones',
			icon: 'coins'
		},
		{
			href: '/admin/horario',
			label: 'Horarios',
			icon: 'clock'
		},
		{
			href: '/admin/zonas',
			label: 'Zonas',
			icon: 'layer-group'
		},
		{
			href: '/admin/tarifas',
			label: 'Tarifas',
			icon: 'table-cells'
		},
		{
			href: '/admin/recargos',
			label: 'Recargos',
			icon: 'receipt'
		},
		{
			href: '/admin/barrios',
			label: 'Barrios',
			icon: 'location-dot'
		}
	];

	const ruta = $derived(page.url.pathname);

	async function salir() {
		await api.post('/api/salir');
		// Limpia también la sesión del cliente Supabase del navegador
		// (localStorage), para que Realtime no siga con tokens obsoletos.
		try {
			await supabaseBrowser.auth.signOut();
		} catch {
			// el token pudo haber expirado; igual se navega a la landing
		}
		goto('/');
	}
</script>

<div class="flex min-h-screen bg-slate-100">
	<!-- Sidebar (desktop) -->
	<aside class="hidden w-60 shrink-0 flex-col bg-navy text-slate-300 md:flex">
		<a href="/" class="flex flex-col gap-1 px-6 py-5">
			<Logo type="full" surface="dark" height={32} priority />
			<span class="text-[10px] tracking-wide text-slate-500 uppercase">Panel administración</span>
		</a>

		<nav class="mt-2 flex-1 space-y-1 px-3">
			{#each nav as item (item.href)}
				<a
					href={item.href}
					class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition {ruta === item.href
					? 'bg-primary/20 text-[#8BB4FF]'
					: 'text-slate-400 hover:bg-white/5 hover:text-white'}"
				>
					<Icon name={item.icon} class="size-4.5" />
					{item.label}
				</a>
			{/each}
		</nav>

		<div class="border-t border-white/10 p-4">
			<div class="mb-3 flex items-center justify-between gap-2">
				<div class="flex min-w-0 items-center gap-3">
					<div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/20 text-sm font-bold text-[#8BB4FF]">
						{page.data.email?.charAt(0).toUpperCase()}
					</div>
					<div class="min-w-0">
						<div class="truncate text-xs font-semibold text-white">{page.data.email}</div>
						<div class="text-[10px] text-[#8BB4FF]">Administrador</div>
					</div>
				</div>
				<CentroNotificaciones urlBase="/admin/pedidos" tono="oscuro" soloSonarEn="desktop" />
			</div>
			<button
				type="button"
				onclick={salir}
				class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white"
			>
				<Icon name="right-from-bracket" class="size-4.5" />
				Cerrar sesión
			</button>
		</div>
	</aside>

	<!-- Contenido -->
	<div class="flex min-w-0 flex-1 flex-col">
		<!-- Topbar (mobile) -->
		<header class="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur md:hidden">
			<div class="flex items-center justify-between gap-2 px-4 py-3">
				<button
					type="button"
					aria-label="Abrir menú"
					onclick={() => (menuAbierto = true)}
					class="flex size-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50"
				>
					<Icon name="bars" class="size-4.5" />
				</button>
				<a href="/" class="flex items-center">
					<Logo type="mark" surface="light" height={28} />
				</a>
				<div class="flex items-center gap-1.5">
					<CentroNotificaciones urlBase="/admin/pedidos" tono="claro" soloSonarEn="mobile" />
					<button
						type="button"
						onclick={salir}
						class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
					>
						Salir
					</button>
				</div>
			</div>
			<!-- Solo los accesos clave en la barra: el resto vive en el menú (☰). -->
			<div class="flex gap-1.5 px-4 pb-3">
				<a
					href="/admin"
					class="flex-1 rounded-lg px-3 py-2 text-center text-xs font-bold transition {ruta === '/admin'
						? 'bg-primary text-white shadow-sm'
						: 'bg-slate-100 text-slate-600 hover:bg-slate-200'}"
				>
					Resumen
				</a>
				<a
					href="/admin/pedidos"
					class="flex-1 rounded-lg px-3 py-2 text-center text-xs font-bold transition {ruta.startsWith('/admin/pedidos')
						? 'bg-primary text-white shadow-sm'
						: 'bg-slate-100 text-slate-600 hover:bg-slate-200'}"
				>
					Pedidos
				</a>
			</div>
		</header>

		<main class="flex-1 p-5 sm:p-8">
			{@render children()}
		</main>
	</div>
</div>

<!-- Drawer del menú móvil (Tarea 2) -->
{#if menuAbierto}
	<div
		class="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm"
		role="presentation"
		onclick={() => (menuAbierto = false)}
	></div>
	<div class="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-navy text-slate-300 shadow-2xl" role="dialog" aria-modal="true">
		<div class="flex items-center justify-between px-5 py-4">
			<div class="flex flex-col gap-1">
				<Logo type="full" surface="dark" height={28} priority />
				<span class="text-[10px] tracking-wide text-slate-500 uppercase">Panel administración</span>
			</div>
			<button
				type="button"
				aria-label="Cerrar menú"
				onclick={() => (menuAbierto = false)}
				class="flex size-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white"
			>
				<Icon name="xmark" class="size-4.5" />
			</button>
		</div>

		<nav class="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
			{#each nav as item (item.href)}
				<a
					href={item.href}
					onclick={() => (menuAbierto = false)}
					class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition {ruta === item.href
						? 'bg-primary/20 text-[#8BB4FF]'
						: 'text-slate-400 hover:bg-white/5 hover:text-white'}"
				>
					<Icon name={item.icon} class="size-4.5" />
					{item.label}
				</a>
			{/each}
		</nav>

		<div class="border-t border-white/10 p-4">
			<button
				type="button"
				onclick={salir}
				class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white"
			>
				<Icon name="right-from-bracket" class="size-4.5" />
				Cerrar sesión
			</button>
		</div>
	</div>
{/if}
