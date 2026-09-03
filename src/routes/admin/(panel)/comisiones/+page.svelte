<script lang="ts">
	import { api } from '$lib/api';
	import { hidratarSesionRealtime } from '$lib/supabase-browser';
	import { debounce, suscribirCambios, type RealtimeEstado } from '$lib/realtime';
	import IndicadorRealtime from '$lib/components/IndicadorRealtime.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { Clock, ArrowLeftRight, RotateCw, Coins, Plus, Save, X, Lightbulb, Layers } from 'lucide';
	import {
		formatearPeso,
		formatearMontoCampo,
		normalizarMontoCampo,
		rangoDeNiveles,
		validarTopeNivel,
		type ComisionConfig,
		type ComisionNivel,
		type NivelConRango
	} from '$lib/types';
	import Tabla from '$lib/components/tabla/Tabla.svelte';
	import TablaEncabezado from '$lib/components/tabla/TablaEncabezado.svelte';
	import TablaVacia from '$lib/components/tabla/TablaVacia.svelte';
	import TablaError from '$lib/components/tabla/TablaError.svelte';
	import TablaCargando from '$lib/components/tabla/TablaCargando.svelte';
	import Boton from '$lib/components/tabla/Boton.svelte';
	import CampoMovil from '$lib/components/tabla/CampoMovil.svelte';
	import SoloEscritorio from '$lib/components/tabla/SoloEscritorio.svelte';
	import SoloMovil from '$lib/components/tabla/SoloMovil.svelte';

	let niveles = $state<NivelConRango[]>([]);
	let cargando = $state(true);
	let error = $state<string | null>(null);
	let mensaje = $state<{ tipo: 'ok' | 'err'; texto: string } | null>(null);
	let estadoRealtime = $state<RealtimeEstado>('conectando');

	let valorInput = $state<Record<string, string>>({});
	let hastaInput = $state<Record<string, string>>({});
	let guardando = $state<Record<string, boolean>>({});
	let agregando = $state(false);
	let config = $state<ComisionConfig | null>(null);
	let pasoInput = $state('');
	let nivelesInput = $state('');
	let reconfigurando = $state(false);

	async function cargar() {
		cargando = true;
		const r = await api.get<ComisionNivel[]>('/api/comisiones');
		cargando = false;
		if (r.error) {
			error = r.error;
			return;
		}
		niveles = rangoDeNiveles(r.data ?? []);
		// Config de la escalera (paso y cantidad) via meta.
		const cfg = r.meta?.config as ComisionConfig | undefined;
		if (cfg) {
			config = cfg;
			if (pasoInput === '') pasoInput = String(cfg.paso);
			if (nivelesInput === '') nivelesInput = String(cfg.niveles);
		}
		// Rehidrata los inputs cuando llegan datos frescos.
		for (const n of niveles) {
			if (valorInput[n.id] === undefined) valorInput[n.id] = String(n.valor);
			if (hastaInput[n.id] === undefined) hastaInput[n.id] = String(n.hasta);
		}
		valorInput = { ...valorInput };
		hastaInput = { ...hastaInput };
	}

	const cargarDebounced = debounce(() => cargar(), 250);

	async function guardar(n: NivelConRango) {
		const valor = Number(normalizarMontoCampo(valorInput[n.id] ?? ''));
		const hasta = Number(normalizarMontoCampo(hastaInput[n.id] ?? ''));
		if (!Number.isFinite(valor) || valor < 0) {
			mensaje = { tipo: 'err', texto: `Comisión inválida para el nivel ${n.nivel}.` };
			return;
		}
		if (!Number.isFinite(hasta) || hasta <= 0) {
			mensaje = { tipo: 'err', texto: `El tope del nivel ${n.nivel} debe ser mayor que cero.` };
			return;
		}
		// El nuevo tope debe dejar la escalera sin solapamientos ni huecos:
		// estrictamente entre el tope del nivel anterior y el del siguiente.
		// Se valida contra los valores ya guardados (niveles), no contra los
		// inputs pendientes de otros niveles: cada guardado mueve un valor a
		// una ranura válida, así la invariante se mantiene con ediciones sin
		// guardar de varios niveles.
		const errorRango = validarTopeNivel(niveles, n.nivel, Math.round(hasta));
		if (errorRango) {
			mensaje = { tipo: 'err', texto: errorRango };
			return;
		}
		guardando[n.id] = true;
		guardando = { ...guardando };
		mensaje = null;
		const r = await api.put(`/api/comisiones?id=${n.id}`, {
			valor: Math.round(valor),
			hasta: Math.round(hasta)
		});
		guardando[n.id] = false;
		guardando = { ...guardando };
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		mensaje = { tipo: 'ok', texto: `Nivel ${n.nivel} actualizado a ${formatearPeso(Math.round(valor))}.` };
		await cargar();
	}

	async function agregar() {
		agregando = true;
		mensaje = null;
		const r = await api.post('/api/comisiones', {});
		agregando = false;
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		mensaje = {
			 tipo: 'ok',
			 texto: `Nivel agregado: continúa la escalera de ${formatearPeso(config?.paso ?? 10000)} con el valor vigente.`
		 };
		await cargar();
	}

	async function eliminar(n: NivelConRango) {
		if (
			!window.confirm(
				`¿Eliminar el nivel ${n.nivel} (pedidos hasta ${formatearPeso(n.hasta)})? Los pedidos de ese rango pasarán al siguiente nivel con su valor.`
			)
		) {
			return;
		}
		mensaje = null;
		const r = await api.del(`/api/comisiones?id=${n.id}`);
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		mensaje = { tipo: 'ok', texto: `Nivel ${n.nivel} eliminado.` };
		await cargar();
	}

	/** Reacomoda TODA la escalera: nuevo paso entre niveles y nueva cantidad. */
	async function reacomodar() {
		const paso = Number(pasoInput);
		const cantidad = Number(nivelesInput);
		if (!Number.isFinite(paso) || paso <= 0) {
			mensaje = { tipo: 'err', texto: 'El paso entre niveles debe ser mayor que cero.' };
			return;
		}
		if (!Number.isFinite(cantidad) || cantidad < 1) {
			mensaje = { tipo: 'err', texto: 'Debe haber al menos un nivel.' };
			return;
		}
		if (
			!window.confirm(
				`¿Reacomodar la escalera a ${Math.round(cantidad)} niveles de ${formatearPeso(
					Math.round(paso)
				)} cada uno?\n\nLos rangos de todos los niveles cambiarán y la nueva escalera aplicará desde mañana: las comisiones de hoy y de los días anteriores se mantienen con la escalera vigente de cada día.`
			)
		) {
			return;
		}
		reconfigurando = true;
		mensaje = null;
		const r = await api.put('/api/comisiones/config', {
			paso: Math.round(paso),
			niveles: Math.round(cantidad)
		});
		reconfigurando = false;
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		mensaje = {
			 tipo: 'ok',
			 texto: `Escalera reacomodada: ${Math.round(cantidad)} niveles de ${formatearPeso(
				 Math.round(paso)
			 )} cada uno.`
		 };
		await cargar();
	}

	$effect(() => {
		let activo = true;
		let limpiar: (() => void)[] = [];
		hidratarSesionRealtime().then(() => {
			if (!activo) return;
			limpiar = (['comision_niveles', 'comision_config'] as const).map((tabla) =>
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
	<title>Comisiones — StarGo Admin</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-2xl font-extrabold tracking-tight text-slate-900">Comisiones por nivel</h1>
		<p class="mt-1 text-sm text-slate-500">
			La comisión que paga cada domiciliario es por día, según el total acumulado de sus entregas. Lo que
			ajustes aquí aplica desde <strong class="font-semibold text-slate-700">mañana</strong>: las comisiones de
			hoy y de los días anteriores se mantienen con la escalera que estaba vigente ese día.
		</p>
	</div>
	<IndicadorRealtime estado={estadoRealtime} />
</header>

<!-- Aviso: los cambios aplican desde mañana (Fase 18) -->
<div class="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
	<Icon icon={Clock} class="mt-0.5 size-4 shrink-0" />
	<span>
		Cada día queda congelado con la escalera vigente ese día. Si cambias un nivel <strong>hoy</strong>, la
		comisión de hoy y la de los días anteriores no se alteran: la nueva escalera empieza a aplicar <strong>desde
		mañana</strong>.
	</span>
</div>

<!-- Configuración de la escalera: paso entre niveles y cantidad -->
<section class="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
	<div class="flex flex-wrap items-center gap-x-6 gap-y-3">
		<p class="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
			<Icon icon={ArrowLeftRight} class="size-4 text-primary" />
			Escalera de niveles
		</p>
		<label class="flex items-center gap-2 text-xs font-medium text-slate-600">
			<span>Cada nivel abarca</span>
			<span class="text-slate-400">$</span>
			<input
				type="text"
				inputmode="numeric"
				value={formatearMontoCampo(pasoInput)}
				oninput={(e) => (pasoInput = normalizarMontoCampo(e.currentTarget.value))}
				aria-label="Paso entre niveles"
				class="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold text-slate-900 transition focus:border-primary focus:outline-none"
			/>
		</label>
		<label class="flex items-center gap-2 text-xs font-medium text-slate-600">
			<span>Cantidad de niveles</span>
			<input
				type="number"
				min="1"
				max="200"
				step="1"
				bind:value={nivelesInput}
				aria-label="Cantidad de niveles"
				class="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold text-slate-900 transition focus:border-primary focus:outline-none"
			/>
		</label>
		<button
			type="button"
			onclick={reacomodar}
			disabled={reconfigurando}
			class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:opacity-60"
		>
			<Icon icon={RotateCw} class="size-3.5" />
			{reconfigurando ? 'Reacomodando…' : 'Reacomodar escalera'}
		</button>
	</div>
	<p class="mt-2 text-[11px] text-slate-400">
		Cambia el rango de <span class="font-semibold text-slate-500">todos</span> los niveles de una vez: el tope de
		cada nivel pasa a ser nivel × paso. Se conservan los valores de comisión que ya configuraste (por posición).
		La nueva escalera aplica desde mañana: hoy y los días anteriores conservan la escalera de cada día.
	</p>
</section>

{#if mensaje}
	<div
		class="mb-5 rounded-xl border px-4 py-3 text-sm {mensaje.tipo === 'ok'
			? 'border-primary/30 bg-primary-light text-primary-dark'
			: 'border-red-200 bg-red-50 text-red-700'}"
	>
		{mensaje.texto}
	</div>
{/if}

<Tabla>
	<div class="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
		<p class="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
			<Icon icon={Coins} class="size-4 text-primary" />
			{niveles.length} niveles · cada uno abarca {formatearPeso(config?.paso ?? null)}
		</p>
		<button
			type="button"
			onclick={agregar}
			disabled={agregando}
			class="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:opacity-60"
		>
			<Icon icon={Plus} class="size-3.5" />
			{agregando ? 'Agregando…' : 'Agregar nivel'}
		</button>
	</div>

	{#if cargando && niveles.length === 0}
		<TablaCargando columnas={4} filas={5} />
	{:else if error}
		<TablaError
			titulo="No se pudieron cargar las comisiones"
			mensaje={error}
			onreintentar={cargar}
		/>
	{:else if niveles.length === 0}
		<TablaVacia
			icono={Layers}
			titulo="Aún no hay niveles. Agrega el primero con «Agregar nivel»."
		/>
	{:else}
		<SoloEscritorio>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<TablaEncabezado
						columnas={[
							{ etiqueta: 'Nivel' },
							{ etiqueta: 'Rango del pedido' },
							{ etiqueta: 'Comisión (COP)' },
							{ etiqueta: 'Acción', alineacion: 'derecha' }
						]}
					/>
					<tbody>
						{#each niveles as n, i (n.id)}
							<tr class="border-b border-slate-100 align-middle transition hover:bg-slate-50/60">
								<td class="px-4 py-3">
									<span class="inline-flex size-8 items-center justify-center rounded-full bg-primary-light text-sm font-bold text-primary">
										{n.nivel}
									</span>
								</td>
								<td class="px-4 py-3">
									{#if i === 0}
										<p class="font-medium text-slate-900">Hasta {formatearPeso(n.hasta)}</p>
										<p class="text-xs text-slate-400">los pedidos más económicos</p>
									{:else}
										<p class="font-medium text-slate-900">
											De {formatearPeso(n.desde)} a {formatearPeso(n.hasta)}
										</p>
										<p class="text-xs text-slate-400">pedidos de {formatearPeso(n.desde)} en adelante</p>
									{/if}
								</td>
								<td class="px-4 py-3">
									<div class="flex items-center gap-1.5">
										<span class="text-slate-400">$</span>
										<input
											type="text"
											inputmode="numeric"
											value={formatearMontoCampo(valorInput[n.id])}
											oninput={(e) => { valorInput[n.id] = normalizarMontoCampo(e.currentTarget.value); valorInput = { ...valorInput }; }}
											disabled={guardando[n.id]}
											aria-label={`Comisión del nivel ${n.nivel}`}
											class="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold text-slate-900 transition focus:border-primary focus:outline-none disabled:opacity-60"
										/>
									</div>
									<div class="mt-1 flex items-center gap-1.5">
										<span class="text-[10px] text-slate-400">tope $</span>
										<input
											type="text"
											inputmode="numeric"
											value={formatearMontoCampo(hastaInput[n.id])}
											oninput={(e) => { hastaInput[n.id] = normalizarMontoCampo(e.currentTarget.value); hastaInput = { ...hastaInput }; }}
											disabled={guardando[n.id]}
											aria-label={`Tope del nivel ${n.nivel}`}
											class="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 transition focus:border-primary focus:outline-none disabled:opacity-60"
										/>
									</div>
								</td>
								<td class="px-4 py-3 text-right">
									<div class="flex flex-wrap justify-end gap-1.5">
										<Boton variant="primario" onclick={() => guardar(n)} disabled={guardando[n.id]}>
											<Icon icon={Save} class="size-3" />
											{guardando[n.id] ? 'Guardando…' : 'Guardar'}
										</Boton>
										<Boton variant="peligro" onclick={() => eliminar(n)} disabled={guardando[n.id]}>
											<Icon icon={X} class="size-3" />
											Eliminar
										</Boton>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</SoloEscritorio>

		<SoloMovil>
			<ul class="space-y-3 p-3 sm:p-4">
				{#each niveles as n, i (n.id)}
					<li class="rounded-xl border border-slate-200 bg-white p-4">
						<div class="flex items-center gap-3">
							<span class="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-light text-sm font-bold text-primary">
								{n.nivel}
							</span>
							<div class="min-w-0">
								{#if i === 0}
									<p class="font-medium text-slate-900">Hasta {formatearPeso(n.hasta)}</p>
									<p class="text-xs text-slate-400">los pedidos más económicos</p>
								{:else}
									<p class="font-medium text-slate-900">
										De {formatearPeso(n.desde)} a {formatearPeso(n.hasta)}
									</p>
									<p class="text-xs text-slate-400">pedidos de {formatearPeso(n.desde)} en adelante</p>
								{/if}
							</div>
						</div>

						<div class="mt-3 space-y-3">
							<CampoMovil etiqueta="Comisión">
								<div class="flex items-center gap-1.5">
									<span class="text-slate-400">$</span>
									<input
										type="text"
										inputmode="numeric"
										value={formatearMontoCampo(valorInput[n.id])}
										oninput={(e) => { valorInput[n.id] = normalizarMontoCampo(e.currentTarget.value); valorInput = { ...valorInput }; }}
										disabled={guardando[n.id]}
										aria-label={`Comisión del nivel ${n.nivel}`}
										class="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 transition focus:border-primary focus:outline-none disabled:opacity-60"
									/>
								</div>
							</CampoMovil>
							<CampoMovil etiqueta="Tope del rango">
								<div class="flex items-center gap-1.5">
									<span class="text-slate-400">$</span>
									<input
										type="text"
										inputmode="numeric"
										value={formatearMontoCampo(hastaInput[n.id])}
										oninput={(e) => { hastaInput[n.id] = normalizarMontoCampo(e.currentTarget.value); hastaInput = { ...hastaInput }; }}
										disabled={guardando[n.id]}
										aria-label={`Tope del nivel ${n.nivel}`}
										class="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 transition focus:border-primary focus:outline-none disabled:opacity-60"
									/>
								</div>
							</CampoMovil>
						</div>

						<div class="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
							<Boton variant="primario" onclick={() => guardar(n)} disabled={guardando[n.id]}>
								<Icon icon={Save} class="size-3" />
								{guardando[n.id] ? 'Guardando…' : 'Guardar'}
							</Boton>
							<Boton variant="peligro" onclick={() => eliminar(n)} disabled={guardando[n.id]}>
								<Icon icon={X} class="size-3" />
								Eliminar
							</Boton>
						</div>
					</li>
				{/each}
			</ul>
		</SoloMovil>
	{/if}
</Tabla>

<p class="mt-5 flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
	<Icon icon={Lightbulb} class="mt-0.5 size-4 shrink-0 text-amber-500" />
	<span>
		La comisión de cada día se calcula con la escalera que estaba vigente ese día y queda <strong>congelada</strong>:
		un cambio hecho hoy no altera la comisión de hoy ni la de los días anteriores, y la nueva escalera aplica desde
		mañana. Con «Reacomodar escalera» cambias el rango que abarca cada nivel; el domiciliario ve esta tabla en su
		panel para saber cuánto pagará.
	</span>
</p>