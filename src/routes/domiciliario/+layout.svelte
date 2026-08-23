<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api, apiFetch } from '$lib/api';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import { esCapacitor } from '$lib/push-capacitor';
	import Logo from '$lib/components/Logo.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { Truck, LogOut } from 'lucide';
	import CentroNotificaciones from '$lib/components/CentroNotificaciones.svelte';

	let { children } = $props();

	// En Capacitor, la auth del layout server no corre. Verificar vía API.
	let nombre = $state(page.data?.nombre ?? '');
	let username = $state<string | null>(page.data?.username ?? null);
	if (esCapacitor() && !nombre) {
		apiFetch('/api/sesion', { headers: { Accept: 'application/json' } })
			.then((r) => r.json().catch(() => ({ data: null })))
			.then((body) => {
				if (!body?.data?.email) {
					goto('/login');
				} else {
					nombre = body.data.user_metadata?.nombre ?? body.data.email ?? '';
				}
			})
			.catch(() => goto('/login'));
	}

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
				<Icon icon={Truck} class="size-4.5" />
				Mis entregas
			</a>
		</nav>

		<div class="border-t border-white/10 p-4">
			<div class="mb-3 flex items-center justify-between gap-2">
				<div class="flex min-w-0 items-center gap-3">
					<div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/20 text-sm font-bold text-[#8BB4FF]">
						{nombre?.charAt(0).toUpperCase()}
					</div>
					<div class="min-w-0">
						<div class="truncate text-xs font-semibold text-white">{nombre}</div>
						<div class="truncate text-[10px] text-[#8BB4FF]">
							Domiciliario{username ? ` · ${username}` : ''}
						</div>
					</div>
				</div>
				<CentroNotificaciones urlBase="/domiciliario" tono="oscuro" soloSonarEn="desktop" />
			</div>
			<button
				type="button"
				onclick={salir}
				class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white"
			>
				<Icon icon={LogOut} class="size-4.5" />
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
				<div class="flex items-center gap-1.5">
					<CentroNotificaciones urlBase="/domiciliario" tono="claro" soloSonarEn="mobile" />
					<button
						type="button"
						onclick={salir}
						class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
					>
						Salir
					</button>
				</div>
			</div>
		</header>

		<main class="flex-1 p-5 sm:p-8">
			{@render children()}
		</main>
	</div>
</div>
