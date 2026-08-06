<script lang="ts">
	import { api } from '$lib/api';
	import { hidratarSesionRealtime } from '$lib/supabase-browser';
	import { debounce, suscribirCambios, type RealtimeEstado } from '$lib/realtime';
	import IndicadorRealtime from '$lib/components/IndicadorRealtime.svelte';
	import type { Domiciliario } from '$lib/types';

	let lista = $state<Domiciliario[]>([]);
	let cargando = $state(true);
	let error = $state<string | null>(null);
	let mensaje = $state<{ tipo: 'ok' | 'err'; texto: string } | null>(null);
	let busqueda = $state('');
	let estadoRealtime = $state<RealtimeEstado>('conectando');

	// Formulario de registro
	let nombre = $state('');
	let email = $state('');
	let telefono = $state('');
	let registrando = $state(false);

	const visibles = $derived(
		lista.filter(
			(d) =>
				!busqueda.trim() ||
				d.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()) ||
				(d.email ?? '').toLowerCase().includes(busqueda.trim().toLowerCase())
		)
	);

	function formatearFecha(iso: string): string {
		return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
	}

	async function cargar() {
		cargando = true;
		const r = await api.get<Domiciliario[]>('/api/domiciliarios');
		cargando = false;
		if (r.error) {
			error = r.error;
			return;
		}
		lista = r.data ?? [];
	}

	const cargarDebounced = debounce(() => cargar(), 250);

	async function registrar(e: SubmitEvent) {
		e.preventDefault();
		if (!nombre.trim() || !email.trim()) {
			mensaje = { tipo: 'err', texto: 'Nombre y email son obligatorios.' };
			return;
		}
		registrando = true;
		mensaje = null;
		const r = await api.post<Domiciliario>('/api/domiciliarios', {
			op: 'registrar',
			nombre: nombre.trim(),
			email: email.trim(),
			telefono: telefono.trim()
		});
		registrando = false;
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		mensaje = {
			tipo: 'ok',
			texto: `${r.data?.nombre} registrado como domiciliario. Su cuenta de Supabase debe existir con el email ${r.data?.email}.`
		};
		nombre = '';
		email = '';
		telefono = '';
		await cargar();
	}

	async function alternarActivo(d: Domiciliario) {
		error = null;
		mensaje = null;
		const r = await api.put(`/api/domiciliarios?id=${d.id}`, { activo: !d.activo });
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		mensaje = {
			tipo: 'ok',
			texto: `${d.nombre} ${d.activo ? 'desactivado' : 'activado'}.`
		};
		await cargar();
	}

	async function eliminar(d: Domiciliario) {
		if (!window.confirm(`¿Eliminar a ${d.nombre}? No podrá acceder a su panel.`)) return;
		mensaje = null;
		const r = await api.del(`/api/domiciliarios?id=${d.id}`);
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		mensaje = { tipo: 'ok', texto: `${d.nombre} eliminado.` };
		await cargar();
	}

	$effect(() => {
		let activo = true;
		let limpiar: (() => void) | undefined;
		hidratarSesionRealtime().then(() => {
			if (!activo) return;
			limpiar = suscribirCambios({
				tabla: 'domiciliarios',
				onCambio: () => cargarDebounced(),
				onEstado: (estado) => {
					estadoRealtime = estado;
					if (estado === 'conectado') cargarDebounced();
				}
			});
		});
		cargar();
		return () => {
			activo = false;
			limpiar?.();
		};
	});
</script>

<svelte:head>
	<title>Domiciliarios — StarGo Admin</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-2xl font-extrabold tracking-tight text-slate-900">Domiciliarios</h1>
		<p class="mt-1 text-sm text-slate-500">
			Registra a tus repartidores y gestiona su acceso. Cada uno inicia sesión con su cuenta de Supabase.
		</p>
	</div>
	<IndicadorRealtime estado={estadoRealtime} />
</header>

{#if mensaje}
	<div
		class="mb-5 rounded-xl border px-4 py-3 text-sm {mensaje.tipo === 'ok'
			? 'border-emerald-200 bg-emerald-50 text-emerald-700'
			: 'border-red-200 bg-red-50 text-red-700'}"
	>
		{mensaje.texto}
	</div>
{/if}

<div class="grid gap-6 lg:grid-cols-3">
	<!-- Formulario de registro -->
	<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-1">
		<h2 class="text-sm font-bold tracking-wide text-slate-500 uppercase">Registrar domiciliario</h2>
		<p class="mt-1 text-xs text-slate-400">
			El email debe ser la cuenta de Supabase que usará para entrar a su panel.
		</p>
		<form class="mt-5 space-y-4" onsubmit={registrar}>
			<div>
				<label for="dom-nombre" class="mb-1.5 block text-sm font-semibold text-slate-700">Nombre completo</label>
				<input
					id="dom-nombre"
					type="text"
					required
					bind:value={nombre}
					placeholder="Ej: Carlos Ramírez"
					class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 focus:outline-none"
				/>
			</div>
			<div>
				<label for="dom-email" class="mb-1.5 block text-sm font-semibold text-slate-700">Email de Supabase</label>
				<input
					id="dom-email"
					type="email"
					required
					bind:value={email}
					placeholder="repartidor@correo.com"
					class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 focus:outline-none"
				/>
			</div>
			<div>
				<label for="dom-tel" class="mb-1.5 block text-sm font-semibold text-slate-700">Teléfono <span class="font-normal text-slate-400">(opcional)</span></label>
				<input
					id="dom-tel"
					type="tel"
					bind:value={telefono}
					placeholder="300 123 4567"
					class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 focus:outline-none"
				/>
			</div>
			<button
				type="submit"
				disabled={registrando}
				class="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-600 disabled:opacity-60"
			>
				{#if registrando}
					<span class="size-4 animate-spin rounded-full border-2 border-white/50 border-t-white"></span>
					Registrando…
				{:else}
					Registrar domiciliario
				{/if}
			</button>
		</form>
	</div>

	<!-- Listado -->
	<div class="rounded-2xl border border-slate-200 bg-white shadow-sm lg:col-span-2">
		<div class="flex items-center gap-3 border-b border-slate-100 p-4">
			<input
				type="search"
				bind:value={busqueda}
				placeholder="Buscar por nombre o email…"
				class="w-full max-w-xs rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:outline-none"
			/>
			<span class="ml-auto text-xs text-slate-400">{visibles.length} de {lista.length}</span>
		</div>

		{#if cargando && lista.length === 0}
			<div class="flex items-center justify-center gap-3 py-16 text-slate-500">
				<span class="size-5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent"></span>
				Cargando…
			</div>
		{:else if error}
			<div class="p-6 text-sm text-red-600">No se pudieron cargar los domiciliarios: {error}</div>
		{:else if visibles.length === 0}
			<p class="p-10 text-center text-sm text-slate-400">
				{lista.length === 0 ? 'Aún no hay domiciliarios registrados.' : 'Sin resultados para la búsqueda.'}
			</p>
		{:else}
			<ul class="divide-y divide-slate-100">
				{#each visibles as d (d.id)}
					<li class="flex items-center gap-4 p-4 transition hover:bg-slate-50/60">
						<div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">
							{d.nombre.charAt(0).toUpperCase()}
						</div>
						<div class="min-w-0 flex-1">
							<p class="font-semibold text-slate-900">{d.nombre}</p>
							<p class="truncate text-xs text-slate-500">
								{d.email ?? '—'}{d.telefono ? ` · ${d.telefono}` : ''} · desde {formatearFecha(d.created_at ?? '')}
							</p>
						</div>
						<span
							class="inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold {d.activo
								? 'border-emerald-200 bg-emerald-50 text-emerald-700'
								: 'border-slate-200 bg-slate-100 text-slate-500'}"
						>
							{d.activo ? 'Activo' : 'Inactivo'}
						</span>
						<button
							type="button"
							onclick={() => alternarActivo(d)}
							class="shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition {d.activo
								? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
								: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}"
						>
							{d.activo ? 'Desactivar' : 'Activar'}
						</button>
						<button
							type="button"
							onclick={() => eliminar(d)}
							class="shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100"
						>
							Eliminar
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
