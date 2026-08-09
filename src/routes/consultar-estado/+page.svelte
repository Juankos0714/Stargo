<script lang="ts">
	import { api } from '$lib/api';
	import Logo from '$lib/components/Logo.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { debounce, suscribirCambios, type RealtimeEstado } from '$lib/realtime';
	import IndicadorRealtime from '$lib/components/IndicadorRealtime.svelte';
	import BadgeEstado from '$lib/components/BadgeEstado.svelte';
	import HistorialTimeline from '$lib/components/HistorialTimeline.svelte';
	import {
		formatearPeso,
		type PedidoConsultado
	} from '$lib/types';
	import { validarMotivoCancelacion } from '$lib/logic/validacion';
	import { page } from '$app/state';

	let numero = $state('');
	let buscando = $state(false);
	let error = $state<string | null>(null);
	let resultado = $state<PedidoConsultado | null>(null);
	let consultado = $state(false);
	let estadoRealtime = $state<RealtimeEstado>('conectando');
	let canalActivo = $state<(() => void) | null>(null);
	// Ejemplo para probar el flujo sin tener un pedido a la mano. Los códigos
	// reales son hex (0-9A-F): este ejemplo respeta ese formato (no existe en
	// la BD, por eso la consulta muestra el estado de «no encontrado»).
	const CODIGO_EJEMPLO = 'A7F2C1';

	// El código del pedido son 6 caracteres alfanuméricos (MD5 truncado).
	// Se avisa al instante si el formato no coincide, antes de llamar al API.
	const formatoValido = $derived(/^[A-Z0-9]{6}$/.test(numero.trim().toUpperCase()));

	async function pegarCodigo() {
		try {
			const texto = await navigator.clipboard.readText();
			if (!texto.trim()) return;
			numero = texto.trim().toUpperCase();
			consultar(numero);
		} catch {
			// Sin permiso de portapapeles (HTTP o bloqueado): queda el input normal.
			error = 'No se pudo leer el portapapeles: pega el código manualmente.';
		}
	}

	function usarEjemplo() {
		numero = CODIGO_EJEMPLO;
		consultar(CODIGO_EJEMPLO);
	}

	// Cancelación del pedido (Fase 7): solo mientras esté pendiente.
	const MOTIVOS = [
		'Ya no necesito el servicio',
		'Tiempo de espera demasiado largo',
		'Cambié de planes',
		'Dirección incorrecta',
		'Otro'
	];
	let cancelando = $state(false); // modo cancelación abierto
	let procesandoCancelacion = $state(false); // llamada al API en curso
	let motivo = $state('');
	let detalle = $state('');
	let cancelandoError = $state<string | null>(null);

	async function cancelarPedido() {
		if (!resultado || procesandoCancelacion) return;
		const motivoFinal = motivo === 'Otro'
			? `Otro${detalle.trim() ? ` · ${detalle.trim()}` : ''}`
			: motivo.trim();
		const errMotivo = validarMotivoCancelacion(motivoFinal);
		if (errMotivo) {
			cancelandoError = errMotivo;
			return;
		}
		cancelandoError = null;
		procesandoCancelacion = true;
		const r = await api.post('/api/pedidos/cancelar', {
			numero: resultado.pedido.numero,
			motivo: motivoFinal || null
		});
		procesandoCancelacion = false;
		if (r.error) {
			cancelandoError = r.error;
			return;
		}
		cancelando = false;
		motivo = '';
		detalle = '';
		consultar(resultado.pedido.numero);
	}

	const consultarDebounced = debounce((codigo: string) => consultar(codigo, true), 300);

	/**
	 * Se suscribe a los eventos públicos del pedido (pedido_eventos): al
	 * recibir un cambio de estado, se re-consulta para refrescar el panel
	 * en vivo sin recargar. Realtime se reconecta solo.
	 */
	function suscribirEventos(codigo: string) {
		canalActivo?.();
		canalActivo = null;
		if (!codigo) return;
		canalActivo = suscribirCambios({
			tabla: 'pedido_eventos',
			filtro: { numero: codigo },
			onCambio: () => consultarDebounced(codigo),
			onEstado: (estado) => (estadoRealtime = estado)
		});
	}

	async function consultar(n?: string, silencioso = false) {
		const codigo = (n ?? numero).trim().toUpperCase();
		if (!codigo) return;
		// Validación local: el código es de 6 caracteres alfanuméricos. Sin ella
		// el API respondería «pedido no encontrado» para cualquier formato.
		if (!/^[A-Z0-9]{6}$/.test(codigo)) {
			error = 'El código tiene 6 caracteres (letras y números). Revisa el código de tu pedido.';
			consultado = true;
			return;
		}
		numero = codigo;
		if (!silencioso) {
			buscando = true;
			error = null;
			resultado = null;
			consultado = false;
		}
		const r = await api.get<PedidoConsultado>(`/api/pedidos/consultar?numero=${encodeURIComponent(codigo)}`);
		if (!silencioso) buscando = false;
		if (r.error) {
			if (!silencioso) {
				error = r.error;
				consultado = true;
			}
			return;
		}
		resultado = r.data;
		consultado = true;
		error = null;
		suscribirEventos(codigo);
	}

	$effect(() => {
		const inicial = String(page.url.searchParams.get('numero') ?? '');
		if (inicial && !consultado) {
			numero = inicial.trim().toUpperCase();
			consultar(inicial);
		}
	});

	$effect(() => {
		// Cancelar el canal al desmontar la página.
		return () => {
			canalActivo?.();
		};
	});
</script>

<svelte:head>
	<title>Consultar estado — StarGo</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-b from-slate-50 via-primary-light/40 to-slate-50">
	<header class="border-b border-slate-200/70 bg-white/80 backdrop-blur">
		<div class="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
			<a href="/" class="flex items-center">
				<Logo type="full" surface="light" height={32} priority />
			</a>
			<a href="/nuevo-pedido" class="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-primary-light hover:text-primary">Hacer un pedido →</a>
		</div>
	</header>

	<main class="mx-auto max-w-2xl px-6 py-12">
		<div class="flex items-start justify-center gap-3 text-center">
			<div>
				<h1 class="text-3xl font-extrabold tracking-tight text-slate-900">Consultar estado</h1>
				<p class="mt-2 text-slate-500">Ingresa el código que recibiste al confirmar tu pedido.</p>
			</div>
			{#if canalActivo}
				<div class="mt-1.5">
					<IndicadorRealtime estado={estadoRealtime} />
				</div>
			{/if}
		</div>

		<form
			onsubmit={(e) => {
				e.preventDefault();
				consultar();
			}}
			class="mx-auto mt-8 max-w-md"
		>
			<div class="flex gap-2">
				<div class="relative min-w-0 flex-1">
					<input
						type="text"
						bind:value={numero}
						placeholder="Código del pedido (ej: K7F2XM)"
						autocomplete="off"
						aria-label="Código del pedido"
						class="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pr-11 font-mono text-lg uppercase tracking-widest text-slate-900 shadow-sm transition placeholder:font-sans placeholder:text-sm placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
					/>
					<button
						type="button"
						onclick={pegarCodigo}
						title="Pegar código desde el portapapeles"
						aria-label="Pegar código desde el portapapeles"
						class="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-primary"
					>
						<Icon name="clipboard-list" class="size-4.5" />
					</button>
				</div>
				<button
					type="submit"
					disabled={buscando || !numero.trim() || (numero.trim().length > 0 && !formatoValido)}
					class="shrink-0 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
				>
					{buscando ? 'Buscando…' : 'Buscar'}
				</button>
			</div>
			{#if numero.trim().length > 0 && !formatoValido && !buscando}
				<p class="mt-2 text-xs text-amber-600">El código tiene 6 caracteres (letras y números), ej: {CODIGO_EJEMPLO}.</p>
			{/if}
			{#if numero.trim().length > 0 && formatoValido}
				<p class="mt-2 text-xs text-slate-400">Busca el código {numero.trim().toUpperCase()} en tus pedidos…</p>
			{/if}
		</form>

		<div class="mx-auto mt-3 flex max-w-md items-center justify-center gap-2 text-xs">
			<span class="text-slate-400">¿Solo probando?</span>
			<button
				type="button"
				onclick={usarEjemplo}
				disabled={buscando}
				class="font-semibold text-primary underline-offset-2 transition hover:text-primary-dark hover:underline"
			>
				Consulta el pedido de ejemplo {CODIGO_EJEMPLO}
			</button>
		</div>

		<div class="mt-8">
			{#if buscando}
				<div class="flex items-center justify-center gap-3 py-16 text-slate-500">
					<span class="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
					Consultando…
				</div>
			{:else if error && consultado}
				<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-700">{error}</div>
			{:else if resultado}
				<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-900/5 sm:p-8">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div>
							<p class="text-xs font-semibold tracking-wide text-slate-400 uppercase">Pedido</p>
							<p class="font-mono text-2xl font-black tracking-widest text-slate-900">{resultado.pedido.numero}</p>
						</div>
						<BadgeEstado estado={resultado.pedido.estado} size="lg" testid="estado-pedido" />
					</div>

					<div class="mt-6 grid gap-4 sm:grid-cols-2">
						<div class="rounded-xl bg-slate-50 p-4">
							<p class="text-xs font-semibold text-slate-400 uppercase">Origen</p>
							<p class="mt-1 font-medium text-slate-900">{resultado.pedido.barrio_origen_nombre ?? '—'}</p>
							<p class="text-sm text-slate-500">{resultado.pedido.direccion_origen}</p>
						</div>
						<div class="rounded-xl bg-slate-50 p-4">
							<p class="text-xs font-semibold text-slate-400 uppercase">Destino</p>
							<p class="mt-1 font-medium text-slate-900">{resultado.pedido.barrio_destino_nombre ?? '—'}</p>
							<p class="text-sm text-slate-500">{resultado.pedido.direccion_destino}</p>
						</div>
					</div>

					{#if resultado.pedido.observaciones}
						<p class="mt-4 text-sm text-slate-600">
							<span class="font-semibold text-slate-700">Observaciones:</span> {resultado.pedido.observaciones}
						</p>
					{/if}

					<div class="mt-6 rounded-xl border border-primary/30 bg-primary-light/60 px-4 py-3">
						{#if (resultado.pedido.recargos?.length ?? 0) > 0}
							<div class="space-y-1 text-sm">
								<p class="flex justify-between">
									<span class="text-slate-600">Tarifa base</span>
									<span class="font-semibold text-slate-900">{formatearPeso(resultado.pedido.tarifa_base)}</span>
								</p>
								{#each resultado.pedido.recargos ?? [] as r (r.codigo)}
									<p class="flex justify-between">
										<span class="text-slate-600">{r.nombre}</span>
										<span class="font-semibold text-slate-800">{formatearPeso(r.valor)}</span>
									</p>
								{/each}
								<p class="flex justify-between border-t border-primary/20 pt-1">
									<span class="font-semibold text-slate-600">Total</span>
									<span class="text-xl font-extrabold text-primary-dark">
										{formatearPeso(resultado.pedido.total ?? resultado.pedido.tarifa_base)}
									</span>
								</p>
							</div>
						{:else}
							<div class="flex items-center justify-between">
								<span class="text-sm font-semibold text-slate-600">Tarifa</span>
								<span class="text-xl font-extrabold text-primary-dark">{formatearPeso(resultado.pedido.tarifa_base)}</span>
							</div>
						{/if}
					</div>

					{#if resultado.pedido.estado === 'cancelado' && resultado.pedido.motivo_cancelacion}
						<p class="mt-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
							<Icon name="ban" class="mt-0.5 size-4 shrink-0" />
							<span><span class="font-semibold">Motivo de cancelación:</span> {resultado.pedido.motivo_cancelacion}</span>
						</p>
					{/if}

					{#if resultado.pedido.estado === 'pendiente'}
						{#if !cancelando}
							<button
								type="button"
								onclick={() => (cancelando = true)}
								class="mt-4 w-full rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-100"
							>
								Cancelar pedido
							</button>
						{:else}
							<div class="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
								<p class="text-sm font-semibold text-red-700">¿Cancelar este pedido?</p>
								<p class="mt-0.5 text-xs text-red-600">
									Solo puedes cancelarlo mientras siga pendiente, antes de que se asigne un domiciliario.
								</p>
							<select
								bind:value={motivo}
								disabled={procesandoCancelacion}
								class="mt-3 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-red-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
							>
								<option value="">Selecciona un motivo…</option>
								{#each MOTIVOS as m (m)}
									<option value={m}>{m}</option>
								{/each}
							</select>
							<textarea
								bind:value={detalle}
								rows="2"
								maxlength="300"
								placeholder="Detalle (opcional)"
								disabled={procesandoCancelacion}
								class="mt-2 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-red-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
							></textarea>
							{#if cancelandoError}
								<p class="mt-2 text-xs font-medium text-red-700">{cancelandoError}</p>
							{/if}
							<div class="mt-3 flex gap-2">
								<button
									type="button"
									onclick={cancelarPedido}
									disabled={!motivo.trim() || procesandoCancelacion}
									class="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-red-700 disabled:opacity-60"
								>
									{#if procesandoCancelacion}
										<span class="size-3.5 animate-spin rounded-full border-2 border-white/50 border-t-white"></span>
										Cancelando…
									{:else}
										Confirmar cancelación
									{/if}
								</button>
								<button
									type="button"
									onclick={() => {
										cancelando = false;
										cancelandoError = null;
									}}
									disabled={procesandoCancelacion}
									class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
								>
									Volver
								</button>
							</div>
							</div>
						{/if}
					{/if}

					<h2 class="mt-7 text-sm font-bold tracking-wide text-slate-500 uppercase">Historial del pedido</h2>
					<HistorialTimeline historial={resultado.historial} />
				</div>
			{:else}
				<div class="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
					<div class="mx-auto flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
						<Icon name="magnifying-glass" class="size-5" />
					</div>
					<h2 class="mt-4 text-sm font-bold text-slate-700">¿Dónde encuentro el código?</h2>
					<ol class="mx-auto mt-3 max-w-sm space-y-1.5 text-left text-sm text-slate-500">
						<li><span class="font-bold text-primary-dark">1.</span> Haz tu pedido desde la app o <a href="/nuevo-pedido" class="font-semibold text-primary underline-offset-2 hover:underline">aquí</a>.</li>
						<li><span class="font-bold text-primary-dark">2.</span> Al confirmarlo se muestra un <strong class="font-mono">código de 6 letras y números</strong>.</li>
						<li><span class="font-bold text-primary-dark">3.</span> Escríbelo o pégalo arriba para seguir el estado en tiempo real.</li>
					</ol>
				</div>
			{/if}
		</div>
	</main>
</div>
