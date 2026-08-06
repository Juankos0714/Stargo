<script lang="ts">
	import { api } from '$lib/api';
	import Logo from '$lib/components/Logo.svelte';

	let cargando = $state(true);
	let esAdmin = $state(false);
	let esDomiciliario = $state(false);

	$effect(() => {
		let activo = true;
		api.get<{ email: string; esAdmin: boolean; esDomiciliario: boolean }>('/api/sesion').then((r) => {
			if (activo) {
				esAdmin = r.data?.esAdmin === true && r.error === null;
				esDomiciliario = r.data?.esDomiciliario === true && r.error === null;
				cargando = false;
			}
		});
		return () => {
			activo = false;
		};
	});
</script>

<svelte:head>
	<title>StarGo — Domicilios en Armenia</title>
</svelte:head>

<div class="relative min-h-screen overflow-hidden bg-navy text-white">
	<!-- Fondo decorativo -->
	<div class="pointer-events-none absolute inset-0">
		<div
			class="absolute inset-0 opacity-[0.06]"
			style="background-image: radial-gradient(circle at 1px 1px, #fff 1px, transparent 0); background-size: 28px 28px;"
		></div>
	</div>

	<header class="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
		<a href="/">
			<Logo type="full" surface="dark" height={36} priority />
		</a>
		<nav class="flex items-center gap-3 text-sm">
			<a href="/nuevo-pedido" class="rounded-lg px-3 py-2 text-slate-300 transition hover:bg-white/10 hover:text-white">Hacer pedido</a>
			<a href="/consultar-estado" class="rounded-lg px-3 py-2 text-slate-300 transition hover:bg-white/10 hover:text-white">Consultar estado</a>
			<a href="/calculadora" class="rounded-lg px-3 py-2 text-slate-300 transition hover:bg-white/10 hover:text-white">Calculadora</a>
			{#if !cargando}
				{#if esAdmin}
					<a href="/admin" class="rounded-lg bg-primary px-4 py-2 font-semibold text-white shadow-lg transition hover:bg-primary-dark">Panel admin</a>
				{:else if esDomiciliario}
					<a href="/domiciliario" class="rounded-lg bg-primary px-4 py-2 font-semibold text-white shadow-lg transition hover:bg-primary-dark">Mis entregas</a>
				{:else}
					<a href="/login" class="rounded-lg border border-white/15 px-4 py-2 font-medium text-slate-200 transition hover:bg-white/10">Iniciar sesión</a>
				{/if}
			{/if}
		</nav>
	</header>

	<main class="relative z-10 mx-auto max-w-6xl px-6">
		<section class="pt-20 pb-16 text-center sm:pt-28">
			<p class="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-semibold tracking-wide text-[#8BB4FF] uppercase">
				<span class="size-1.5 rounded-full bg-primary" ></span>
				Armenia · Quindío
			</p>
			<h1 class="mx-auto max-w-3xl text-4xl font-extrabold tracking-tight text-balance sm:text-6xl">
				Domicilios en Armenia,
				<span class="bg-gradient-to-r from-[#7EB0FF] to-[#4FC3F7] bg-clip-text text-transparent">pedidos y tarifas al instante.</span>
			</h1>
			<p class="mx-auto mt-5 max-w-xl text-lg text-slate-400">
				Haz tu pedido con tarifa calculada automáticamente, sigue su estado en vivo y consulta el precio entre barrios de la ciudad.
			</p>
			<div class="mt-9 flex flex-wrap items-center justify-center gap-4">
				<a
					href="/nuevo-pedido"
					class="group inline-flex items-center gap-2 rounded-[10px] bg-primary px-6 py-3.5 font-semibold text-white shadow-lg transition hover:bg-primary-dark"
				>
					Hacer un pedido
					<svg class="size-4 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
						<path d="M5 12h14M13 6l6 6-6 6" />
					</svg>
				</a>
				<a href="/consultar-estado" class="rounded-xl border border-white/15 px-6 py-3.5 font-medium text-slate-200 transition hover:bg-white/10">
					Consultar estado
				</a>
				<a href="/calculadora" class="rounded-xl px-4 py-3.5 text-sm text-slate-400 transition hover:text-white">¿Solo tarifa? Calculadora →</a>
			</div>
		</section>

		<section class="grid gap-5 pb-24 sm:grid-cols-3">
			<div class="group rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur transition hover:border-primary/50 hover:bg-white/10">
				<div class="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary/20 text-[#8BB4FF]">
					<svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="12" cy="12" r="10" />
						<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20" />
					</svg>
				</div>
				<h3 class="font-semibold text-white">Barrios</h3>
				<p class="mt-1.5 text-sm text-slate-400">Cada barrio está asociado a una zona tarifaria de la ciudad.</p>
			</div>
			<div class="group rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur transition hover:border-primary/50 hover:bg-white/10">
				<div class="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary/20 text-[#8BB4FF]">
					<svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<rect x="3" y="3" width="18" height="18" rx="2" />
						<path d="M3 9h18M3 15h18M9 3v18" />
					</svg>
				</div>
				<h3 class="font-semibold text-white">Matriz de tarifas</h3>
				<p class="mt-1.5 text-sm text-slate-400">Precios origen → destino por zona, con resolución simétrica automática.</p>
			</div>
			<div class="group rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur transition hover:border-primary/50 hover:bg-white/10">
				<div class="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary/20 text-[#8BB4FF]">
					<svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8M2 7h20l-2-4H4l-2 4zM12 17v4" />
					</svg>
				</div>
				<h3 class="font-semibold text-white">Solo admin</h3>
				<p class="mt-1.5 text-sm text-slate-400">El panel de administración está protegido con Supabase Auth y verificación de admin.</p>
			</div>
		</section>
	</main>

	<footer class="relative z-10 flex flex-col items-center gap-3 border-t border-white/10 py-8 text-center text-xs text-slate-500">
		<Logo type="full" surface="dark" height={28} />
		<p>StarGo · Domicilios en Armenia — {new Date().getFullYear()}</p>
	</footer>
</div>
