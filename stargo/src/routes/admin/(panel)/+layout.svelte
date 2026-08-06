<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { supabaseBrowser } from '$lib/supabase-browser';

	let { children } = $props();

	const nav = [
		{
			href: '/admin',
			label: 'Resumen',
			icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9zM9 22V12h6v10'
		},
		{
			href: '/admin/pedidos',
			label: 'Pedidos',
			icon: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 12h6M9 16h6'
		},
		{
			href: '/admin/domiciliarios',
			label: 'Domiciliarios',
			icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6'
		},
		{
			href: '/admin/zonas',
			label: 'Zonas',
			icon: 'M12 2 2 7l10 5 10-5-10-5zM2 12l10 5 10-5M2 17l10 5 10-5'
		},
		{
			href: '/admin/tarifas',
			label: 'Tarifas',
			icon: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18'
		},
		{
			href: '/admin/barrios',
			label: 'Barrios',
			icon: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'
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
	<aside class="hidden w-60 shrink-0 flex-col bg-slate-950 text-slate-300 md:flex">
		<a href="/" class="flex items-center gap-2.5 px-6 py-5">
			<div class="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500">
				<svg class="size-4.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M5 11 4 4h4l3 7" />
					<path d="M5 11h14l1 3H6" />
					<circle cx="6" cy="17" r="1.5" />
					<circle cx="17" cy="17" r="1.5" />
				</svg>
			</div>
			<div>
				<div class="text-sm font-bold text-white">StarGo</div>
				<div class="text-[10px] tracking-wide text-slate-500 uppercase">Panel admin</div>
			</div>
		</a>

		<nav class="mt-2 flex-1 space-y-1 px-3">
			{#each nav as item (item.href)}
				<a
					href={item.href}
					class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition {ruta === item.href
						? 'bg-emerald-500/15 text-emerald-300'
						: 'text-slate-400 hover:bg-white/5 hover:text-white'}"
				>
					<svg class="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d={item.icon} />
					</svg>
					{item.label}
				</a>
			{/each}
		</nav>

		<div class="border-t border-white/10 p-4">
			<div class="mb-3 flex items-center gap-3">
				<div class="flex size-9 items-center justify-center rounded-full bg-emerald-500/20 text-sm font-bold text-emerald-300">
					{page.data.email?.charAt(0).toUpperCase()}
				</div>
				<div class="min-w-0">
					<div class="truncate text-xs font-semibold text-white">{page.data.email}</div>
					<div class="text-[10px] text-emerald-400">Administrador</div>
				</div>
			</div>
			<button
				type="button"
				onclick={salir}
				class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white"
			>
				<svg class="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
				</svg>
				Cerrar sesión
			</button>
		</div>
	</aside>

	<!-- Contenido -->
	<div class="flex min-w-0 flex-1 flex-col">
		<!-- Topbar (mobile) -->
		<header class="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur md:hidden">
			<div class="flex items-center justify-between px-4 py-3">
				<a href="/" class="flex items-center gap-2">
					<div class="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500">
						<svg class="size-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M5 11 4 4h4l3 7" />
							<path d="M5 11h14l1 3H6" />
							<circle cx="6" cy="17" r="1.5" />
							<circle cx="17" cy="17" r="1.5" />
						</svg>
					</div>
					<span class="text-sm font-bold text-slate-900">StarGo Admin</span>
				</a>
				<button
					type="button"
					onclick={salir}
					class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
				>
					Salir
				</button>
			</div>
			<nav class="flex gap-1 overflow-x-auto px-3 pb-2">
				{#each nav as item (item.href)}
					<a
						href={item.href}
						class="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition {ruta === item.href
							? 'bg-emerald-500 text-white'
							: 'text-slate-500 hover:bg-slate-100'}"
					>
						{item.label}
					</a>
				{/each}
			</nav>
		</header>

		<main class="flex-1 p-5 sm:p-8">
			{@render children()}
		</main>
	</div>
</div>
