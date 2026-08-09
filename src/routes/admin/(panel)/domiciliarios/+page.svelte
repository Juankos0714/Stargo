<script lang="ts">
	import { api } from '$lib/api';
	import { hidratarSesionRealtime } from '$lib/supabase-browser';
	import { debounce, suscribirCambios, type RealtimeEstado } from '$lib/realtime';
	import IndicadorRealtime from '$lib/components/IndicadorRealtime.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { formatearPeso, type Domiciliario, type PagoDomiciliario } from '$lib/types';

	interface DomiciliarioFila extends Domiciliario {
		deuda: number;
		total_comision: number;
		total_pagos: number;
		pagos: PagoDomiciliario[];
	}

	let lista = $state<DomiciliarioFila[]>([]);
	let cargando = $state(true);
	let error = $state<string | null>(null);
	let mensaje = $state<{ tipo: 'ok' | 'err'; texto: string } | null>(null);
	let busqueda = $state('');
	let estadoRealtime = $state<RealtimeEstado>('conectando');

	// Formulario de registro
	let nombre = $state('');
	let email = $state('');
	let telefono = $state('');
	let password = $state('');
	let registrando = $state(false);
	// Modo de alta: 'invitacion' (correo con enlace para definir contraseña) o
	// 'directo' (el admin define la contraseña). Ninguno toca Supabase.
	let modoRegistro = $state<'invitacion' | 'directo'>('invitacion');

	// Bloqueo y acceso: estados de carga independientes por fila
	let guardandoBloqueo = $state<Record<string, boolean>>({});
	let alternandoAcceso = $state<Record<string, boolean>>({});

	// Abono (modal)
	let abonando = $state<DomiciliarioFila | null>(null);
	let abonoValor = $state('');
	let abonoNota = $state('');
	let registrandoAbono = $state(false);

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
	function formatearFechaHora(iso: string): string {
		return new Date(iso).toLocaleString('es-CO', {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	async function cargar() {
		cargando = true;
		const r = await api.get<DomiciliarioFila[]>('/api/domiciliarios');
		cargando = false;
		if (r.error) {
			error = r.error;
			return;
		}
		lista = (r.data ?? []).map((d) => ({
			...d,
			deuda: d.deuda ?? 0,
			total_comision: d.total_comision ?? 0,
			total_pagos: d.total_pagos ?? 0,
			pagos: d.pagos ?? []
		}));
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
			op: modoRegistro === 'invitacion' ? 'invitar' : 'registrar',
			nombre: nombre.trim(),
			email: email.trim(),
			telefono: telefono.trim(),
			...(modoRegistro === 'directo' && password ? { password: password.trim() } : {})
		});
		registrando = false;
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		const emailRegistrado = r.data?.email ?? email.trim();
		const cuentaCreada = r.meta?.cuentaCreada === true;
		const invitacionEnviada = r.meta?.invitacionEnviada === true;
		if (modoRegistro === 'invitacion') {
			mensaje = {
				tipo: 'ok',
				texto: invitacionEnviada
					? `Invitación enviada a ${emailRegistrado}: recibirá un correo para crear su contraseña y entrar al panel.`
					: `${r.data?.nombre ?? nombre.trim()} enlazado con la cuenta existente ${emailRegistrado}.`
			};
		} else {
			mensaje = {
				tipo: 'ok',
				texto: cuentaCreada
					? `${r.data?.nombre ?? nombre.trim()} registrado: cuenta creada. Puede ingresar al panel con ${emailRegistrado} y la contraseña que definiste.`
					: `${r.data?.nombre ?? nombre.trim()} enlazado con la cuenta existente ${emailRegistrado}.`
			};
		}
		nombre = '';
		email = '';
		telefono = '';
		password = '';
		await cargar();
	}

	async function alternarActivo(d: DomiciliarioFila) {
		error = null;
		mensaje = null;
		alternandoAcceso[d.id] = true;
		alternandoAcceso = { ...alternandoAcceso };
		const r = await api.put(`/api/domiciliarios?id=${d.id}`, { activo: !d.activo });
		alternandoAcceso[d.id] = false;
		alternandoAcceso = { ...alternandoAcceso };
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

	async function alternarBloqueo(d: DomiciliarioFila) {
		guardandoBloqueo[d.id] = true;
		guardandoBloqueo = { ...guardandoBloqueo };
		mensaje = null;
		const r = await api.put(`/api/domiciliarios?id=${d.id}`, { bloqueado: !d.bloqueado });
		guardandoBloqueo[d.id] = false;
		guardandoBloqueo = { ...guardandoBloqueo };
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		mensaje = {
			tipo: 'ok',
			texto: d.bloqueado
				? `${d.nombre} desbloqueado: ya puede recibir pedidos.`
				: `${d.nombre} bloqueado: no recibirá pedidos nuevos hasta desbloquearlo.`
		};
		await cargar();
	}

	function abrirAbono(d: DomiciliarioFila) {
		abonoValor = d.deuda > 0 ? String(d.deuda) : '';
		abonoNota = '';
		abonando = d;
	}

	async function confirmarAbono() {
		if (!abonando) return;
		const valor = Number(abonoValor);
		if (!Number.isFinite(valor) || valor <= 0) {
			mensaje = { tipo: 'err', texto: 'Ingresa un valor mayor que cero.' };
			return;
		}
		const nombre = abonando.nombre;
		registrandoAbono = true;
		mensaje = null;
		const r = await api.post('/api/pagos', {
			domiciliario_id: abonando.id,
			valor: Math.round(valor),
			nota: abonoNota.trim() || undefined
		});
		registrandoAbono = false;
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		abonando = null;
		mensaje = { tipo: 'ok', texto: `Abono de ${formatearPeso(Math.round(valor))} registrado para ${nombre}.` };
		await cargar();
	}

	async function eliminar(d: DomiciliarioFila) {
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
		let limpiar: (() => void)[] = [];
		hidratarSesionRealtime().then(() => {
			if (!activo) return;
			limpiar = (['domiciliarios', 'pagos_domiciliarios'] as const).map((tabla) =>
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
	<title>Domiciliarios — StarGo Admin</title>
</svelte:head>

<header class="mb-6 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-2xl font-extrabold tracking-tight text-slate-900">Domiciliarios</h1>
		<p class="mt-1 text-sm text-slate-500">
			Registra repartidores y gestiona su deuda, abonos y bloqueos por falta de pago.
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

<div class="grid gap-6 lg:grid-cols-3">
	<!-- Formulario de registro -->
	<div class="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-1">
		<h2 class="text-sm font-bold tracking-wide text-slate-500 uppercase">Alta de domiciliario</h2>
		<p class="mt-1 text-xs text-slate-400">
			Sin tocar Supabase: el repartidor recibe un correo y crea su propia contraseña.
		</p>

		<!-- Selector de modo de alta -->
		<div class="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
			<button
				type="button"
				onclick={() => (modoRegistro = 'invitacion')}
				class="rounded-lg px-3 py-2 text-xs font-semibold transition {modoRegistro === 'invitacion'
					? 'bg-white text-slate-900 shadow-sm'
					: 'text-slate-500 hover:text-slate-700'}"
			>
				Correo de invitación
			</button>
			<button
				type="button"
				onclick={() => (modoRegistro = 'directo')}
				class="rounded-lg px-3 py-2 text-xs font-semibold transition {modoRegistro === 'directo'
					? 'bg-white text-slate-900 shadow-sm'
					: 'text-slate-500 hover:text-slate-700'}"
			>
				Cuenta con contraseña
			</button>
		</div>

		{#if modoRegistro === 'invitacion'}
			<p class="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-relaxed text-sky-800">
				Se enviará un correo con un enlace para que <strong>el propio repartidor</strong> defina su contraseña.
				Cuando la cree, podrá iniciar sesión en su panel.
			</p>
		{:else}
			<p class="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
				Tú defines la contraseña (mín. 6 caracteres). Sin contraseña, el email debe pertenecer a una cuenta ya
				existente.
			</p>
		{/if}

		<form class="mt-5 space-y-4" onsubmit={registrar}>
			<div>
				<label for="dom-nombre" class="mb-1.5 block text-sm font-semibold text-slate-700">Nombre completo</label>
				<input
					id="dom-nombre"
					type="text"
					required
					bind:value={nombre}
					placeholder="Ej: Carlos Ramírez"
					class="w-full rounded-xl border border-slate-300 bg-white min-h-11 px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
				/>
			</div>
			<div>
				<label for="dom-email" class="mb-1.5 block text-sm font-semibold text-slate-700">Email</label>
				<input
					id="dom-email"
					type="email"
					required
					bind:value={email}
					placeholder="repartidor@correo.com"
					class="w-full rounded-xl border border-slate-300 bg-white min-h-11 px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
				/>
			</div>
			{#if modoRegistro === 'directo'}
				<div>
					<label for="dom-password" class="mb-1.5 block text-sm font-semibold text-slate-700">
						Contraseña <span class="font-normal text-slate-400">(para crear la cuenta, opcional)</span>
					</label>
					<input
						id="dom-password"
						type="password"
						minlength="6"
						bind:value={password}
						placeholder="Mín. 6 caracteres"
						class="w-full rounded-xl border border-slate-300 bg-white min-h-11 px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
					/>
				</div>
			{/if}
			<div>
				<label for="dom-tel" class="mb-1.5 block text-sm font-semibold text-slate-700">Teléfono <span class="font-normal text-slate-400">(opcional)</span></label>
				<input
					id="dom-tel"
					type="tel"
					bind:value={telefono}
					placeholder="300 123 4567"
					class="w-full rounded-xl border border-slate-300 bg-white min-h-11 px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
				/>
			</div>
			<button
				type="submit"
				disabled={registrando}
				class="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:opacity-60"
			>
				{#if registrando}
					<span class="size-4 animate-spin rounded-full border-2 border-white/50 border-t-white"></span>
					{modoRegistro === 'invitacion' ? 'Enviando invitación…' : 'Registrando…'}
				{:else}
					{modoRegistro === 'invitacion' ? 'Enviar invitación por correo' : 'Registrar domiciliario'}
				{/if}
			</button>
		</form>

		<div class="mt-6 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-relaxed text-sky-800">
			<p class="font-semibold">Deuda por comisiones</p>
			<p class="mt-1">
				Por cada día trabajado se calcula la comisión según el total acumulado del día (el nivel alcanzado se
				cobra por cada nivel que cruza; configúrala en
				<a href="/admin/comisiones" class="font-semibold underline">Comisiones</a>). Esa deuda se acumula hasta que registres
				un abono; si no la paga, puedes bloquear al domiciliario.
			</p>
		</div>
	</div>

	<!-- Listado -->
	<div class="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm lg:col-span-2">
		<div class="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
			<input
				type="search"
				bind:value={busqueda}
				placeholder="Buscar por nombre o email…"
				class="w-full max-w-xs rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition placeholder:text-slate-400 focus:border-primary focus:bg-white focus:outline-none"
			/>
			<span class="ml-auto text-xs text-slate-400">{visibles.length} de {lista.length}</span>
		</div>

		{#if cargando && lista.length === 0}
			<div class="flex items-center justify-center gap-3 py-16 text-slate-500">
				<span class="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
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
					<li class="p-4 transition hover:bg-slate-50/60">
						<div class="flex flex-wrap items-center gap-3">
							<div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-light text-sm font-bold text-primary">
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
									? 'border-primary/30 bg-primary-light text-primary-dark'
									: 'border-slate-200 bg-slate-100 text-slate-500'}"
							>
								{d.activo ? 'Activo' : 'Inactivo'}
							</span>
							<span
								class="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold {d.bloqueado
									? 'border-red-200 bg-red-50 text-red-700'
									: 'border-slate-200 bg-slate-100 text-slate-500'}"
								title={d.bloqueado ? 'Bloqueado por falta de pago' : 'Sin bloqueo'}
							>
								{#if d.bloqueado}
									<Icon name="ban" class="size-3" />
								{/if}
								{d.bloqueado ? 'Bloqueado' : 'Al día'}
							</span>
						</div>

						<div class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
							<!-- Deuda -->
							<div class="rounded-xl border p-3 {d.deuda > 0 ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}">
								<p class="text-[10px] font-semibold tracking-wide uppercase {d.deuda > 0 ? 'text-red-600' : 'text-green-700'}">
									Deuda pendiente
								</p>
								<p class="mt-1 text-lg font-extrabold {d.deuda > 0 ? 'text-red-700' : 'text-green-700'}">
									{formatearPeso(d.deuda)}
								</p>
								<p class="text-[10px] text-slate-500">
									{formatearPeso(d.total_comision)} generado · {formatearPeso(d.total_pagos)} abonado
								</p>
							</div>

							<!-- Acciones de cuenta -->
							<div class="flex flex-wrap content-start gap-1.5">
								<button
									type="button"
									onclick={() => abrirAbono(d)}
									class="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary-light px-3 py-1.5 text-xs font-semibold text-primary-dark transition hover:bg-primary-light"
								>
									<Icon name="plus" class="size-3" />
									Registrar abono
								</button>
								<button
									type="button"
									onclick={() => alternarBloqueo(d)}
									disabled={guardandoBloqueo[d.id]}
									class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 {d.bloqueado
										? 'border-primary/30 bg-primary-light text-primary-dark hover:bg-primary-light'
										: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'}"
								>
									<Icon name="ban" class="size-3" />
									{guardandoBloqueo[d.id] ? 'Guardando…' : d.bloqueado ? 'Desbloquear' : 'Bloquear'}
								</button>
							</div>

							<!-- Acciones de acceso -->
							<div class="flex flex-wrap content-start gap-1.5">
								<button
									type="button"
									onclick={() => alternarActivo(d)}
									disabled={alternandoAcceso[d.id]}
									class="rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 {d.activo
										? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
										: 'border-primary/30 bg-primary-light text-primary-dark hover:bg-primary-light'}"
								>
									{alternandoAcceso[d.id] ? 'Guardando…' : d.activo ? 'Desactivar' : 'Activar'}
								</button>
								<button
									type="button"
									onclick={() => eliminar(d)}
									class="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100"
								>
									Eliminar
								</button>
							</div>
						</div>

						{#if d.pagos.length > 0}
							<details class="mt-3">
								<summary class="cursor-pointer text-xs font-medium text-primary-dark hover:underline">
									Abonos ({d.pagos.length})
								</summary>
								<div class="mt-2 grid gap-4 text-xs sm:grid-cols-2">
									{#if d.pagos.length > 0}
										<ul class="space-y-1.5 border-l-2 border-slate-200 pl-3">
											{#each d.pagos as pago (pago.id)}
												<li class="text-slate-500">
													<span class="font-bold text-green-700">{formatearPeso(pago.valor)}</span>
													{pago.nota ? ` · ${pago.nota}` : ''}
													<span class="text-slate-400"> · {formatearFechaHora(pago.created_at)}</span>
												</li>
											{/each}
										</ul>
									{/if}
								</div>
							</details>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

{#if abonando}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
	>
		<div class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
			<h2 class="text-lg font-bold text-slate-900">Registrar abono — {abonando.nombre}</h2>
			<p class="mt-1 text-sm text-slate-500">
				Deuda actual: <span class="font-bold {abonando.deuda > 0 ? 'text-red-600' : 'text-green-600'}">{formatearPeso(abonando.deuda)}</span>
			</p>
			<div class="mt-5 space-y-4">
				<div>
					<label for="abono-valor" class="mb-1.5 block text-sm font-semibold text-slate-700">Valor del abono (COP)</label>
					<input
						id="abono-valor"
						type="number"
						min="1"
						step="500"
						bind:value={abonoValor}
						placeholder="Ej: 20000"
						class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition focus:border-primary focus:outline-none"
					/>
				</div>
				<div>
					<label for="abono-nota" class="mb-1.5 block text-sm font-semibold text-slate-700">
						Nota <span class="font-normal text-slate-400">(opcional)</span>
					</label>
					<input
						id="abono-nota"
						type="text"
						maxlength="300"
						bind:value={abonoNota}
						placeholder="Ej: Abono en efectivo, 5 de agosto"
						class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:outline-none"
					/>
				</div>
			</div>
			<div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<button
					type="button"
					onclick={() => (abonando = null)}
					disabled={registrandoAbono}
					class="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
				>
					Cancelar
				</button>
				<button
					type="button"
					onclick={confirmarAbono}
					disabled={registrandoAbono || !(Number(abonoValor) > 0)}
					class="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:opacity-60"
				>
					{registrandoAbono ? 'Registrando…' : 'Registrar abono'}
				</button>
			</div>
		</div>
	</div>
{/if}
