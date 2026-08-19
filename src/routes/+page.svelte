<script lang="ts">
	// Los datos (horario de hoy + roles del usuario) se resuelven en el
	// servidor (+page.server.ts): el banner y la navegación ya vienen en el
	// HTML inicial, sin peticiones /api en la ruta crítica del cliente.
	// En Capacitor (ssr: false), se cargan via API en el cliente.
	import Logo from '$lib/components/Logo.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { Clock, CircleCheck, ArrowRight, Zap, Truck, Locate, ShoppingCart, Ticket, MapPin } from 'lucide';
	import { apiFetch } from '$lib/api';
	import { esCapacitor } from '$lib/push-capacitor';
	import type { HorarioHoy } from '$lib/types';

	let { data } = $props();

	// En Capacitor, data viene vacío del load (ssr: false + no +page.ts).
	// Cargamos los datos manualmente via API.
	let horario = $state<HorarioHoy | null>(data?.horario ?? null);
	let esAdmin = $state(data?.esAdmin ?? false);
	let esDomiciliario = $state(data?.esDomiciliario ?? false);

	if (esCapacitor() && !data?.horario) {
		Promise.all([
			apiFetch('/api/horario').then((r) => r.json().catch(() => ({ data: null }))),
			apiFetch('/api/sesion', { headers: { Accept: 'application/json' } }).then((r) =>
				r.json().catch(() => ({ data: null }))
			)
		]).then(([rHorario, rSesion]) => {
			horario = rHorario?.data ?? null;
			const sesion = rSesion?.data;
			esAdmin = sesion?.roles?.esAdmin ?? false;
			esDomiciliario = sesion?.roles?.esDomiciliario ?? false;
		});
	}
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

	<header class="relative z-10 mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-6 py-6">
		<a href="/">
			<Logo type="full" surface="dark" height={36} priority />
		</a>
		<nav class="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-sm">
			<a href="/calculadora" class="hidden rounded-lg px-3 py-2 text-slate-300 transition hover:bg-white/10 hover:text-white sm:inline-flex">Calculadora</a>
			{#if esAdmin}
				<a href="/admin" class="rounded-lg bg-primary px-4 py-2 font-semibold text-white shadow-lg transition hover:bg-primary-dark">Panel admin</a>
			{:else if esDomiciliario}
				<a href="/domiciliario" class="rounded-lg bg-primary px-4 py-2 font-semibold text-white shadow-lg transition hover:bg-primary-dark">Mis entregas</a>
			{:else}
				<a href="/login" class="rounded-lg border border-white/15 px-4 py-2 font-medium text-slate-200 transition hover:bg-white/10">Iniciar sesión</a>
			{/if}
		</nav>
	</header>

	<main class="relative z-10 mx-auto max-w-6xl px-6">
		{#if horario && !horario.abierto}
			<div class="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-center text-sm text-amber-200">
				<Icon icon={Clock} class="size-4 shrink-0" />
				<span>
					Estamos fuera de horario de atención (hoy {horario.apertura} – {horario.cierre}): no se reciben pedidos
					nuevos. Puedes seguir consultando el estado de tu pedido.
				</span>
			</div>
		{:else if horario?.abierto}
			<div class="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-center text-sm text-green-200">
				<Icon icon={CircleCheck} class="size-4 shrink-0" />
				<span>Recibimos pedidos hoy hasta las {horario.cierre}.</span>
			</div>
		{/if}

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
					<Icon icon={ArrowRight} class="size-4 transition-transform group-hover:translate-x-0.5" />
				</a>
				<a href="/consultar-estado" class="rounded-xl border border-white/15 px-6 py-3.5 font-medium text-slate-200 transition hover:bg-white/10">
					Consultar estado
				</a>
				<a href="/calculadora" class="rounded-xl px-4 py-3.5 text-sm text-slate-400 transition hover:text-white">¿Solo tarifa? Calculadora →</a>
			</div>
		</section>

		<section class="grid gap-5 pb-20 sm:grid-cols-3">
			<div class="group rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur transition hover:border-primary/50 hover:bg-white/10">
				<div class="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary/20 text-[#8BB4FF]">
					<Icon icon={Zap} class="size-5" />
				</div>
				<h2 class="font-semibold text-white">Tarifa al instante</h2>
				<p class="mt-1.5 text-sm text-slate-400">El precio de tu domicilio se calcula automáticamente al elegir origen y destino.</p>
			</div>
			<div class="group rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur transition hover:border-primary/50 hover:bg-white/10">
				<div class="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary/20 text-[#8BB4FF]">
					<Icon icon={Truck} class="size-5" />
				</div>
				<h2 class="font-semibold text-white">Pedidos en minutos</h2>
				<p class="mt-1.5 text-sm text-slate-400">Confirma tu pedido y recibe al instante el código de seguimiento.</p>
			</div>
			<div class="group rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur transition hover:border-primary/50 hover:bg-white/10">
				<div class="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary/20 text-[#8BB4FF]">
					<Icon icon={Locate} class="size-5" />
				</div>
				<h2 class="font-semibold text-white">Seguimiento en vivo</h2>
				<p class="mt-1.5 text-sm text-slate-400">Consulta el estado de tu entrega cuando quieras, desde cualquier dispositivo.</p>
			</div>
		</section>

		<section class="pb-24">
			<h2 class="text-center text-sm font-bold tracking-widest text-slate-400 uppercase">¿Cómo funciona?</h2>
			<div class="mt-8 grid gap-5 sm:grid-cols-3">
				<div class="rounded-2xl border border-white/10 bg-white/5 p-6 text-center backdrop-blur">
					<div class="mx-auto flex size-11 items-center justify-center rounded-full bg-primary/20 text-[#8BB4FF]">
						<Icon icon={ShoppingCart} class="size-5" />
					</div>
					<p class="mt-4 text-sm font-bold text-white">1 · Elige origen y destino</p>
					<p class="mt-1 text-xs text-slate-400">Cuéntanos dónde recoger y a dónde llevar tu pedido.</p>
				</div>
				<div class="rounded-2xl border border-white/10 bg-white/5 p-6 text-center backdrop-blur">
					<div class="mx-auto flex size-11 items-center justify-center rounded-full bg-primary/20 text-[#8BB4FF]">
						<Icon icon={Ticket} class="size-5" />
					</div>
					<p class="mt-4 text-sm font-bold text-white">2 · Recibe tu código</p>
					<p class="mt-1 text-xs text-slate-400">Al confirmar obtienes un código único para seguir tu pedido.</p>
				</div>
				<div class="rounded-2xl border border-white/10 bg-white/5 p-6 text-center backdrop-blur">
					<div class="mx-auto flex size-11 items-center justify-center rounded-full bg-primary/20 text-[#8BB4FF]">
						<Icon icon={MapPin} class="size-5" />
					</div>
					<p class="mt-4 text-sm font-bold text-white">3 · Sigue tu entrega</p>
					<p class="mt-1 text-xs text-slate-400">Mira en vivo cada paso hasta que llegue a tu puerta.</p>
				</div>
			</div>
		</section>
	</main>

	<footer class="relative z-10 flex flex-col items-center gap-3 border-t border-white/10 py-8 text-center text-xs text-slate-500">
		<Logo type="full" surface="dark" height={28} />
		<p>StarGo · Domicilios en Armenia — {new Date().getFullYear()}</p>
	</footer>
</div>
