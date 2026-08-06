<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import Logo from '$lib/components/Logo.svelte';

	let { children } = $props();

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
			<span class="text-[10px] tracking-wide text-slate-500 uppercase">Panel domiciliario</span>
		</a>

		<nav class="mt-2 flex-1 space-y-1 px-3">
			<a
				href="/domiciliario"
				class="flex items-center gap-3 rounded-lg bg-primary/15 px-3 py-2.5 text-sm font-medium text-[#8BB4FF]"
			>
				<svg class="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M5 11 4 4h4l3 7" />
					<path d="M5 11h14l1 3H6" />
					<circle cx="6" cy="17" r="1.5" />
					<circle cx="17" cy="17" r="1.5" />
				</svg>
				Mis entregas
			</a>
		</nav>

		<div class="border-t border-white/10 p-4">
			<div class="mb-3 flex items-center gap-3">
				<div class="flex size-9 items-center justify-center rounded-full bg-primary/20 text-sm font-bold text-[#8BB4FF]">
					{page.data.email?.charAt(0).toUpperCase()}
				</div>
				<div class="min-w-0">
					<div class="truncate text-xs font-semibold text-white">{page.data.email}</div>
					<div class="text-[10px] text-[#8BB4FF]">Repartidor</div>
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
				<a href="/" class="flex items-center">
					<Logo type="mark" surface="light" height={28} />
				</a>
				<button
					type="button"
					onclick={salir}
					class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
				>
					Salir
				</button>
			</div>
		</header>

		<main class="flex-1 p-5 sm:p-8">
			{@render children()}
		</main>
	</div>
</div>
