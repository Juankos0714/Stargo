<script lang="ts">
	import { api } from '$lib/api';
	import { hidratarSesionRealtime } from '$lib/supabase-browser';
	import { debounce, suscribirCambios, type RealtimeEstado } from '$lib/realtime';
	import IndicadorRealtime from '$lib/components/IndicadorRealtime.svelte';
	import BadgeEstado from '$lib/components/BadgeEstado.svelte';
	import {
		ESTADOS_PEDIDO,
		etiquetaEstado,
		formatearPeso,
		type Domiciliario,
		type EstadoPedido,
		type HistorialEstado,
		type Pedido
	} from '$lib/types';

	interface PedidoFila extends Pedido {
		barrio_origen_nombre: string | null;
		barrio_destino_nombre: string | null;
		domiciliario_nombre: string | null;
		historial: HistorialEstado[];
	}

	let pedidos = $state<PedidoFila[]>([]);
	let domiciliarios = $state<Domiciliario[]>([]);
	let cargando = $state(true);
	let error = $state<string | null>(null);
	let mensaje = $state<{ tipo: 'ok' | 'err'; texto: string } | null>(null);
	let filtro = $state<EstadoPedido | 'todos'>('pendiente');
	let guardando = $state<Record<string, boolean>>({});
	let asignacion = $state<Record<string, string>>({});
	let estadoRealtime = $state<RealtimeEstado>('conectando');

	// Cancelación con motivo (Fase 7)
	const MOTIVOS = [
		'El cliente ya no necesita el servicio',
		'Tiempo de espera demasiado largo',
		'Dirección incorrecta o inaccesible',
		'El domiciliario no puede realizar el servicio',
		'Problema con el pago',
		'Otro'
	];
	let cancelando = $state<PedidoFila | null>(null);
	let motivo = $state('');
	let detalle = $state('');
	let cancelandoPedido = $state(false);

	const tabs: { valor: EstadoPedido | 'todos'; label: string }[] = [
		{ valor: 'pendiente', label: 'Pendientes' },
		{ valor: 'asignado', label: 'Asignados' },
		{ valor: 'aceptado', label: 'Aceptados' },
		{ valor: 'recogido', label: 'Recogidos' },
		{ valor: 'en_camino', label: 'En camino' },
		{ valor: 'entregado', label: 'Entregados' },
		{ valor: 'cancelado', label: 'Cancelados' },
		{ valor: 'todos', label: 'Todos' }
	];

	const activos = $derived(
		domiciliarios.filter((d) => d.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
	);

	function formatearFecha(iso: string): string {
		return new Date(iso).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	async function cargar() {
		cargando = true;
		error = null;
		// Se traen todos (hasta 300) y se filtra en el cliente para que los
		// contadores de las pestañas reflejen el total real por estado.
		const [r, rD] = await Promise.all([
			api.get<PedidoFila[]>('/api/pedidos'),
			api.get<Domiciliario[]>('/api/domiciliarios')
		]);
		cargando = false;
		if (r.error) {
			error = r.error;
			return;
		}
		pedidos = r.data ?? [];
		if (!rD.error) domiciliarios = rD.data ?? [];
	}

	// Refresco con un pequeño retraso para absorber ráfagas de eventos.
	const cargarDebounced = debounce(() => cargar(), 250);

	const visibles = $derived(
		filtro === 'todos' ? pedidos : pedidos.filter((p) => p.estado === filtro)
	);

	const contar = $derived((estado: EstadoPedido) => pedidos.filter((p) => p.estado === estado).length);

	async function asignar(p: PedidoFila) {
		const domiciliarioId = asignacion[p.id];
		if (!domiciliarioId) {
			mensaje = { tipo: 'err', texto: `Selecciona un domiciliario para el pedido ${p.numero}.` };
			return;
		}
		guardando[p.id] = true;
		guardando = { ...guardando };
		mensaje = null;
		const r = await api.post(`/api/pedidos/${p.id}/asignar`, { domiciliario_id: domiciliarioId });
		guardando[p.id] = false;
		guardando = { ...guardando };
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		mensaje = { tipo: 'ok', texto: `Pedido ${p.numero} asignado.` };
		await cargar();
	}

	function abrirCancelacion(p: PedidoFila) {
		motivo = '';
		detalle = '';
		cancelando = p;
	}

	async function confirmarCancelacion() {
		if (!cancelando) return;
		const p = cancelando;
		const motivoFinal =
			motivo === 'Otro'
				? `Otro${detalle.trim() ? ` · ${detalle.trim()}` : ''}`
				: motivo.trim();
		guardando[p.id] = true;
		guardando = { ...guardando };
		mensaje = null;
		const r = await api.post(`/api/pedidos/${p.id}/estado`, {
			estado: 'cancelado',
			motivo: motivoFinal || null
		});
		guardando[p.id] = false;
		guardando = { ...guardando };
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			cancelandoPedido = false;
			return;
		}
		cancelando = null;
		cancelandoPedido = false;
		mensaje = { tipo: 'ok', texto: `Pedido ${p.numero} cancelado.` };
		await cargar();
	}

	$effect(() => {
		// Primera carga + hidratación de sesión para Realtime (admin ve todo).
		let activo = true;
		let limpiar: (() => void) | undefined;
		hidratarSesionRealtime().then(() => {
			if (!activo) return;
			// Si la sesión se hidrató, Realtime entrega los cambios de pedidos.
			limpiar = suscribirCambios({
				tabla: 'pedidos',
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
	<title>Pedidos — StarGo Admin</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-2xl font-extrabold tracking-tight text-slate-900">Pedidos</h1>
		<p class="mt-1 text-sm text-slate-500">
			Asigna domiciliarios, sigue cada entrega y cancela si es necesario — todo se registra en el historial.
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

<div class="mb-5 flex gap-1.5 overflow-x-auto pb-1">
	{#each tabs as tab (tab.valor)}
		<button
			type="button"
			onclick={() => (filtro = tab.valor)}
			class="shrink-0 rounded-lg px-3.5 py-2 text-sm font-semibold transition {filtro === tab.valor
				? 'bg-primary text-white shadow-sm'
				: 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}"
		>
			{tab.label}
			{#if tab.valor !== 'todos'}
				<span class="ml-1.5 rounded-full px-1.5 text-xs {filtro === tab.valor ? 'bg-white/20' : 'bg-slate-100'}">
					{contar(tab.valor)}
				</span>
			{/if}
		</button>
	{/each}
</div>

<div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
	{#if cargando && pedidos.length === 0}
		<div class="flex items-center justify-center gap-3 py-16 text-slate-500">
			<span class="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
			Cargando pedidos…
		</div>
	{:else if error}
		<div class="p-6 text-sm text-red-600">No se pudieron cargar los pedidos: {error}</div>
	{:else if visibles.length === 0}
		<p class="p-10 text-center text-sm text-slate-400">
			No hay pedidos {filtro === 'todos' ? '' : `${etiquetaEstado(filtro).toLowerCase()}s`} por ahora.
		</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-left text-sm">
				<thead>
					<tr class="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase">
						<th class="px-4 py-3">Pedido</th>
						<th class="px-4 py-3">Origen → Destino</th>
						<th class="px-4 py-3">Tarifa</th>
						<th class="px-4 py-3">Domiciliario</th>
						<th class="px-4 py-3">Estado</th>
						<th class="px-4 py-3 text-right">Acción</th>
					</tr>
				</thead>
				<tbody>
					{#each visibles as p (p.id)}
						{@const recs = p.recargos ?? []}
						<tr class="border-b border-slate-100 align-top transition hover:bg-slate-50/60">
							<td class="px-4 py-3">
								<p class="font-mono text-sm font-bold text-slate-900">{p.numero}</p>
								<p class="text-xs text-slate-400">{formatearFecha(p.created_at)}</p>
								<details class="mt-1">
									<summary class="cursor-pointer text-xs font-medium text-primary-dark hover:underline">
										Historial ({p.historial.length})
									</summary>
									<ul class="mt-2 space-y-1.5 border-l-2 border-slate-200 pl-3">
										{#each p.historial as hito (hito.id)}
											<li class="text-xs text-slate-500">
												<span class="font-semibold text-slate-700">{etiquetaEstado(hito.estado)}</span>
												{hito.notas ? ` · ${hito.notas}` : ''}
												<span class="text-slate-400"> · {formatearFecha(hito.created_at)}</span>
											</li>
										{/each}
									</ul>
								</details>
							</td>
							<td class="px-4 py-3">
								<p class="font-medium text-slate-900">
									{p.barrio_origen_nombre ?? p.zona_origen_id ?? '—'}
									<span class="text-slate-300">→</span>
									{p.barrio_destino_nombre ?? p.zona_destino_id ?? '—'}
								</p>
								<p class="text-xs text-slate-500">{p.direccion_origen} → {p.direccion_destino}</p>
							</td>
							<td class="px-4 py-3 font-bold whitespace-nowrap text-slate-900">
								{formatearPeso(p.total ?? p.tarifa_base)}
								{#if recs.length > 0}
									<span class="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500" title={recs.map((r) => r.nombre).join(' · ')}>
										+{recs.length} recargo{recs.length > 1 ? 's' : ''}
									</span>
								{/if}
							</td>
							<td class="px-4 py-3">
								{#if p.domiciliario_nombre}
									<span class="inline-flex items-center gap-1.5 text-sm font-medium text-slate-800">
										<span class="flex size-6 items-center justify-center rounded-full bg-primary-light text-[10px] font-bold text-primary">
											{p.domiciliario_nombre.charAt(0).toUpperCase()}
										</span>
										{p.domiciliario_nombre}
									</span>
								{:else}
									<span class="text-xs text-slate-300">Sin asignar</span>
								{/if}
							</td>
							<td class="px-4 py-3">
							<BadgeEstado estado={p.estado} />
							</td>
							<td class="px-4 py-3 text-right">
								{#if p.estado === 'pendiente'}
									<div class="flex flex-col items-end gap-1.5">
										<select
											value={asignacion[p.id] ?? ''}
											onchange={(e) => {
												asignacion[p.id] = (e.currentTarget as HTMLSelectElement).value;
												asignacion = { ...asignacion };
											}}
											disabled={guardando[p.id]}
											class="w-44 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 transition focus:border-primary focus:outline-none disabled:opacity-60"
										>
											<option value="">Elegir domiciliario…</option>
											{#each activos as d (d.id)}
												<option value={d.id}>{d.nombre}</option>
											{/each}
										</select>
										<button
											type="button"
											onclick={() => asignar(p)}
											disabled={guardando[p.id] || !asignacion[p.id]}
											class="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
										>
											{guardando[p.id] ? 'Asignando…' : 'Asignar'}
										</button>
									</div>
								{:else if p.estado !== 'entregado' && p.estado !== 'cancelado'}
									<button
										type="button"
										onclick={() => abrirCancelacion(p)}
										disabled={guardando[p.id]}
										class="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100 disabled:opacity-60"
									>
										Cancelar
									</button>
								{:else}
									<span class="text-xs text-slate-300">—</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

{#if cancelando}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
	>
		<div class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
			<h2 class="text-lg font-bold text-slate-900">Cancelar pedido {cancelando.numero}</h2>
			<p class="mt-1 text-sm text-slate-500">Esta acción no se puede deshacer. El motivo queda registrado en el historial.</p>
			<div class="mt-5 space-y-4">
				<div>
					<label for="motivo-cancel" class="mb-1.5 block text-sm font-semibold text-slate-700">Motivo</label>
					<select
						id="motivo-cancel"
						bind:value={motivo}
						class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-primary focus:outline-none"
					>
						<option value="">Selecciona un motivo…</option>
						{#each MOTIVOS as m (m)}
							<option value={m}>{m}</option>
						{/each}
					</select>
				</div>
				<div>
					<label for="motivo-detalle" class="mb-1.5 block text-sm font-semibold text-slate-700">
						Detalle <span class="font-normal text-slate-400">(opcional)</span>
					</label>
					<textarea
						id="motivo-detalle"
						bind:value={detalle}
						rows="2"
						maxlength="300"
						placeholder="Complementa el motivo si lo necesitas…"
						class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:outline-none"
					></textarea>
				</div>
			</div>
			<div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<button
					type="button"
					onclick={() => (cancelando = null)}
					disabled={cancelandoPedido}
					class="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
				>
					Volver
				</button>
				<button
					type="button"
					onclick={() => {
						cancelandoPedido = true;
						confirmarCancelacion();
					}}
					disabled={cancelandoPedido || !motivo.trim()}
					class="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60"
				>
					{cancelandoPedido ? 'Cancelando…' : 'Confirmar cancelación'}
				</button>
			</div>
		</div>
	</div>
{/if}
