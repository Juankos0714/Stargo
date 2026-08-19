<script lang="ts">
	import { api } from '$lib/api';
	import { hidratarSesionRealtime } from '$lib/supabase-browser';
	import { debounce, suscribirCambios, type RealtimeEstado } from '$lib/realtime';
	import IndicadorRealtime from '$lib/components/IndicadorRealtime.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { CircleCheck, Ban, Plus } from 'lucide';
	import {
		DIAS_SEMANA,
		etiquetaDia,
		validarHoras,
		type HorarioDia,
		type HorarioExcepcion,
		type HorarioHoy
	} from '$lib/types';

	let semanal = $state<HorarioDia[]>([]);
	let excepciones = $state<HorarioExcepcion[]>([]);
	let hoy = $state<HorarioHoy | null>(null);
	let cargando = $state(true);
	let error = $state<string | null>(null);
	let mensaje = $state<{ tipo: 'ok' | 'err'; texto: string } | null>(null);
	let estadoRealtime = $state<RealtimeEstado>('conectando');

	// Formulario de excepción
	let exFecha = $state('');
	let exApertura = $state('08:00');
	let exCierre = $state('14:00');
	let exActivo = $state(true);
	let exMotivo = $state('');
	let guardando = $state(false);
	let guardandoDia = $state<Record<number, boolean>>({});

	const hoyEtiqueta = $derived(hoy ? `${hoy.fecha} · ${etiquetaDia(hoy.dia_semana)}` : '');
	const rangoHoy = $derived(hoy ? `${hoy.apertura} – ${hoy.cierre}` : '');

	function inputDia(dia: number) {
		return semanal.find((d) => d.dia_semana === dia);
	}

	async function cargar() {
		cargando = true;
		const [rCompleto, rHoy] = await Promise.all([
			api.get<{ semanal: HorarioDia[]; excepciones: HorarioExcepcion[] }>('/api/horario?completo=1'),
			api.get<HorarioHoy>('/api/horario')
		]);
		cargando = false;
		if (rCompleto.error) {
			error = rCompleto.error;
			return;
		}
		semanal = (rCompleto.data?.semanal ?? []).sort((a, b) => a.dia_semana - b.dia_semana);
		excepciones = rCompleto.data?.excepciones ?? [];
		hoy = rHoy.data ?? null;
	}

	const cargarDebounced = debounce(() => cargar(), 250);

	async function guardarDia(dia: number) {
		const fila = inputDia(dia);
		if (!fila) return;
		const errorHoras = validarHoras(fila.apertura, fila.cierre);
		if (errorHoras) {
			mensaje = { tipo: 'err', texto: `${etiquetaDia(dia)}: ${errorHoras}` };
			return;
		}
		guardandoDia[dia] = true;
		guardandoDia = { ...guardandoDia };
		mensaje = null;
		const r = await api.put('/api/horario', {
			tipo: 'semanal',
			dia_semana: dia,
			apertura: fila.apertura,
			cierre: fila.cierre,
			activo: fila.activo
		});
		guardandoDia[dia] = false;
		guardandoDia = { ...guardandoDia };
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		mensaje = {
			tipo: 'ok',
			texto: `${etiquetaDia(dia)} guardado${fila.activo ? ` (${fila.apertura} – ${fila.cierre})` : ' (cerrado)'}.`
		};
		await cargar();
	}

	async function agregarExcepcion(e: SubmitEvent) {
		e.preventDefault();
		const errorHoras = validarHoras(exApertura, exCierre);
		if (errorHoras) {
			mensaje = { tipo: 'err', texto: errorHoras };
			return;
		}
		if (!exFecha) {
			mensaje = { tipo: 'err', texto: 'Selecciona la fecha.' };
			return;
		}
		guardando = true;
		mensaje = null;
		const r = await api.put('/api/horario', {
			tipo: 'excepcion',
			fecha: exFecha,
			apertura: exApertura,
			cierre: exCierre,
			activo: exActivo,
			motivo: exMotivo.trim() || undefined
		});
		guardando = false;
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		mensaje = {
			tipo: 'ok',
			texto: exActivo
				? `Excepción guardada para ${exFecha} (${exApertura} – ${exCierre}).`
				: `Día cerrado programado para ${exFecha}.`
		};
		exFecha = '';
		exMotivo = '';
		exApertura = '08:00';
		exCierre = '14:00';
		exActivo = true;
		await cargar();
	}

	async function eliminarExcepcion(ex: HorarioExcepcion) {
		if (!window.confirm(`¿Eliminar la excepción del ${ex.fecha}?`)) return;
		mensaje = null;
		const r = await api.del(`/api/horario?tipo=excepcion&fecha=${ex.fecha}`);
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		mensaje = { tipo: 'ok', texto: `Excepción del ${ex.fecha} eliminada.` };
		await cargar();
	}

	$effect(() => {
		let activo = true;
		let limpiar: (() => void)[] = [];
		hidratarSesionRealtime().then(() => {
			if (!activo) return;
			limpiar = (['horario_operacion', 'horario_excepcion'] as const).map((tabla) =>
				suscribirCambios({
					tabla,
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
</script>

<svelte:head>
	<title>Horarios — StarGo Admin</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-2xl font-extrabold tracking-tight text-slate-900">Horarios de operación</h1>
		<p class="mt-1 text-sm text-slate-500">
			Define cuándo la app recibe pedidos. Fuera de horario la creación de pedidos queda bloqueada; los que ya
			están en curso siguen funcionando.
		</p>
	</div>
	<IndicadorRealtime estado={estadoRealtime} />
</header>

{#if mensaje}
	<div
		class="mb-5 rounded-xl border px-4 py-3 text-sm {mensaje.tipo === 'ok'
			? 'border-primary/30 bg-primary-light text-primary-dark'
			: 'border-red-200 bg-red-50 text-red-700'}"
	>
		{mensaje.texto}
	</div>
{/if}

<!-- Estado de hoy -->
<section
	class="mb-6 rounded-2xl border p-5 shadow-sm {hoy?.abierto
		? 'border-green-200 bg-green-50'
		: 'border-red-200 bg-red-50'}"
>
	<div class="flex flex-wrap items-center gap-4">
		<span
			class="flex size-12 shrink-0 items-center justify-center rounded-full {hoy?.abierto
				? 'bg-green-100 text-green-700'
				: 'bg-red-100 text-red-700'}"
		>
			<Icon icon={hoy?.abierto ? CircleCheck : Ban} class="size-6" />
		</span>
		<div class="min-w-0 flex-1">
			<p class="text-sm font-bold {hoy?.abierto ? 'text-green-800' : 'text-red-800'}">
				{hoy?.abierto ? 'La app está recibiendo pedidos' : 'La app está cerrada para pedidos nuevos'}
			</p>
			<p class="mt-0.5 text-xs {hoy?.abierto ? 'text-green-600' : 'text-red-600'}">
				{hoyEtiqueta} · horario {rangoHoy}
				{#if hoy?.fuente === 'excepcion'}
					· excepción{#if hoy?.motivo}: {hoy.motivo}{/if}
				{/if}
				· ahora son las {hoy?.hora_actual ?? '—'}
			</p>
		</div>
	</div>
</section>

<div class="grid gap-6 lg:grid-cols-2">
	<!-- Horario semanal -->
	<section class="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
		<h2 class="text-sm font-bold tracking-wide text-slate-500 uppercase">Horario semanal</h2>
		<p class="mt-1 text-xs text-slate-400">
			Las excepciones de fecha puntual tienen prioridad sobre este horario.
		</p>
		{#if cargando && semanal.length === 0}
			<div class="flex items-center justify-center gap-3 py-12 text-slate-500">
				<span class="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
				Cargando…
			</div>
		{:else}
			<ul class="mt-4 space-y-2">
				{#each DIAS_SEMANA as d (d.dia)}
					{@const fila = inputDia(d.dia)}
					<li
						class="flex flex-wrap items-center gap-3 rounded-xl border p-3 {fila?.activo
							? 'border-slate-200 bg-slate-50/60'
							: 'border-red-200 bg-red-50/50'}"
					>
						<div class="min-w-28">
							<p class="text-sm font-semibold text-slate-800">{d.label}</p>
							<p class="text-[10px] {fila?.activo ? 'text-slate-400' : 'font-semibold text-red-500'}">
								{fila?.activo ? 'abierto' : 'cerrado'}
							</p>
						</div>
						{#if fila}
							<label class="flex items-center gap-1.5 text-xs text-slate-500">
								<span class="sr-only">Apertura {d.label}</span>
								<input
									type="time"
									class="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-primary focus:outline-none disabled:opacity-50"
									bind:value={fila.apertura}
									disabled={!fila.activo}
								/>
							</label>
							<span class="text-xs text-slate-400">a</span>
							<label class="flex items-center gap-1.5 text-xs text-slate-500">
								<span class="sr-only">Cierre {d.label}</span>
								<input
									type="time"
									class="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-primary focus:outline-none disabled:opacity-50"
									bind:value={fila.cierre}
									disabled={!fila.activo}
								/>
							</label>
							<label class="ml-auto flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
								<input
									type="checkbox"
									class="size-4 accent-[#1768FF]"
									bind:checked={fila.activo}
								/>
								Abierto
							</label>
							<button
								type="button"
								onclick={() => guardarDia(d.dia)}
								disabled={guardandoDia[d.dia]}
								class="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:opacity-60"
							>
								{guardandoDia[d.dia] ? 'Guardando…' : 'Guardar'}
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Excepciones -->
	<section class="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
		<h2 class="text-sm font-bold tracking-wide text-slate-500 uppercase">Fechas especiales</h2>
		<p class="mt-1 text-xs text-slate-400">
			Horarios puntuales (feriados, cierres) que anulan el día de la semana correspondiente.
		</p>

		<form class="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4" onsubmit={agregarExcepcion}>
			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<label for="exc-fecha" class="mb-1 block text-xs font-semibold text-slate-600">Fecha</label>
					<input
						id="exc-fecha"
						type="date"
						bind:value={exFecha}
						class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary focus:outline-none"
					/>
				</div>
				<div>
					<label for="exc-motivo" class="mb-1 block text-xs font-semibold text-slate-600">
						Motivo <span class="font-normal text-slate-400">(opcional)</span>
					</label>
					<input
						id="exc-motivo"
						type="text"
						maxlength="300"
						bind:value={exMotivo}
						placeholder="Ej: 24 de diciembre"
						class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-primary focus:outline-none"
					/>
				</div>
				<div>
					<label for="exc-apertura" class="mb-1 block text-xs font-semibold text-slate-600">Apertura</label>
					<input
						id="exc-apertura"
						type="time"
						bind:value={exApertura}
						class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary focus:outline-none"
					/>
				</div>
				<div>
					<label for="exc-cierre" class="mb-1 block text-xs font-semibold text-slate-600">Cierre</label>
					<input
						id="exc-cierre"
						type="time"
						bind:value={exCierre}
						class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-primary focus:outline-none"
					/>
				</div>
			</div>
			<label class="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
				<input type="checkbox" class="size-4 accent-[#1768FF]" bind:checked={exActivo} />
				Día abierto con este horario
				<span class="text-slate-400">(desmarcado = día cerrado)</span>
			</label>
			<button
				type="submit"
				disabled={guardando}
				class="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:opacity-60"
			>
				<Icon icon={Plus} class="size-4" />
				{guardando ? 'Guardando…' : 'Agregar excepción'}
			</button>
		</form>

		{#if excepciones.length === 0}
			<p class="mt-4 text-sm text-slate-400">No hay fechas especiales programadas.</p>
		{:else}
			<ul class="mt-4 space-y-2">
				{#each excepciones as ex (ex.fecha)}
					<li
						class="flex flex-wrap items-center gap-3 rounded-xl border p-3 {ex.activo
							? 'border-slate-200 bg-slate-50/60'
							: 'border-red-200 bg-red-50/50'}"
					>
						<div class="min-w-0 flex-1">
							<p class="text-sm font-semibold text-slate-800">
								{ex.fecha}
								{#if !ex.activo}
									<span class="ml-2 inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
										cerrado
									</span>
								{/if}
							</p>
							<p class="text-xs text-slate-500">
								{ex.activo ? `${ex.apertura} – ${ex.cierre}` : 'sin atención'}{ex.motivo ? ` · ${ex.motivo}` : ''}
							</p>
						</div>
						<button
							type="button"
							onclick={() => eliminarExcepcion(ex)}
							class="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100"
						>
							Eliminar
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<p class="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-500">
	Nota: la comisión del domiciliario se calcula por <strong>día</strong> según el total acumulado de sus entregas
	(el nivel alcanzado se cobra por cada nivel que cruza; configúrala en
	<a href="/admin/comisiones" class="font-semibold text-primary-dark underline">Comisiones</a>).
</p>
