<script lang="ts">
	import { api } from '$lib/api';

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
	<title>StarGo — Tarifas de domicilios en Armenia</title>
</svelte:head>

<div class="relative min-h-screen overflow-hidden bg-slate-950 text-white">
	<!-- Fondo decorativo -->
	<div class="pointer-events-none absolute inset-0">
		<div class="absolute -top-40 -right-40 size-[36rem] rounded-full bg-emerald-500/20 blur-3xl" ></div>
		<div class="absolute -bottom-40 -left-40 size-[36rem] rounded-full bg-teal-500/15 blur-3xl" ></div>
		<div
			class="absolute inset-0 opacity-[0.07]"
			style="background-image: radial-gradient(circle at 1px 1px, #fff 1px, transparent 0); background-size: 28px 28px;"
		></div>
	</div>

	<header class="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
		<div class="flex items-center gap-2.5">
			<div class="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg shadow-emerald-500/30">
				<svg class="size-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M5 11 4 4h4l3 7" />
					<path d="M5 11h14l1 3H6" />
					<circle cx="6" cy="17" r="1.5" />
					<circle cx="17" cy="17" r="1.5" />
				</svg>
			</div>
			<span class="text-lg font-bold tracking-tight">StarGo</span>
		</div>
		<nav class="flex items-center gap-3 text-sm">
			<a href="/nuevo-pedido" class="rounded-lg px-3 py-2 text-slate-300 transition hover:bg-white/10 hover:text-white">Hacer pedido</a>
			<a href="/consultar-estado" class="rounded-lg px-3 py-2 text-slate-300 transition hover:bg-white/10 hover:text-white">Consultar estado</a>
			<a href="/calculadora" class="rounded-lg px-3 py-2 text-slate-300 transition hover:bg-white/10 hover:text-white">Calculadora</a>
			{#if !cargando}
				{#if esAdmin}
					<a href="/admin" class="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950 shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400">Panel admin</a>
				{:else if esDomiciliario}
					<a href="/domiciliario" class="rounded-lg bg-indigo-500 px-4 py-2 font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:bg-indigo-400">Mis entregas</a>
				{:else}
					<a href="/login" class="rounded-lg border border-white/15 px-4 py-2 font-medium text-slate-200 transition hover:bg-white/10">Iniciar sesión</a>
				{/if}
			{/if}
		</nav>
	</header>

	<main class="relative z-10 mx-auto max-w-6xl px-6">
		<section class="pt-20 pb-16 text-center sm:pt-28">
			<p class="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 text-xs font-semibold tracking-wide text-emerald-300 uppercase">
				<span class="size-1.5 rounded-full bg-emerald-400" ></span>
				Armenia · Quindío
			</p>
			<h1 class="mx-auto max-w-3xl text-4xl font-extrabold tracking-tight text-balance sm:text-6xl">
				Domicilios en Armenia,
				<span class="bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-transparent">pedidos y tarifas al instante.</span>
			</h1>
			<p class="mx-auto mt-5 max-w-xl text-lg text-slate-400">
				Haz tu pedido con tarifa calculada automáticamente, sigue su estado en vivo y consulta el precio entre barrios de la ciudad.
			</p>
			<div class="mt-9 flex flex-wrap items-center justify-center gap-4">
				<a
					href="/nuevo-pedido"
					class="group inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-3.5 font-semibold text-slate-950 shadow-xl shadow-emerald-500/30 transition hover:bg-emerald-400 hover:shadow-emerald-400/40"
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
			<div class="group rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur transition hover:border-emerald-400/40 hover:bg-white/10">
				<div class="mb-4 flex size-11 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300">
					<svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="12" cy="12" r="10" />
						<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20" />
					</svg>
				</div>
				<h3 class="font-semibold text-white">Barrios</h3>
				<p class="mt-1.5 text-sm text-slate-400">Cada barrio está asociado a una zona tarifaria de la ciudad.</p>
			</div>
			<div class="group rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur transition hover:border-emerald-400/40 hover:bg-white/10">
				<div class="mb-4 flex size-11 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300">
					<svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<rect x="3" y="3" width="18" height="18" rx="2" />
						<path d="M3 9h18M3 15h18M9 3v18" />
					</svg>
				</div>
				<h3 class="font-semibold text-white">Matriz de tarifas</h3>
				<p class="mt-1.5 text-sm text-slate-400">Precios origen → destino por zona, con resolución simétrica automática.</p>
			</div>
			<div class="group rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur transition hover:border-emerald-400/40 hover:bg-white/10">
				<div class="mb-4 flex size-11 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300">
					<svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8M2 7h20l-2-4H4l-2 4zM12 17v4" />
					</svg>
				</div>
				<h3 class="font-semibold text-white">Solo admin</h3>
				<p class="mt-1.5 text-sm text-slate-400">El panel de administración está protegido con Supabase Auth y verificación de admin.</p>
			</div>
		</section>
	</main>

	<footer class="relative z-10 border-t border-white/10 py-6 text-center text-xs text-slate-500">
		StarGo · Calculadora de domicilios — {new Date().getFullYear()}
	</footer>
</div>
