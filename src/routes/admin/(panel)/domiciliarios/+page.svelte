<script lang="ts">
	import { api } from '$lib/api';
	import { hidratarSesionRealtime } from '$lib/supabase-browser';
	import { debounce, suscribirCambios, type RealtimeEstado } from '$lib/realtime';
	import IndicadorRealtime from '$lib/components/IndicadorRealtime.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { Ban, Plus, RotateCw, Users } from 'lucide';
	import Badge from '$lib/components/tabla/Badge.svelte';
	import TablaVacia from '$lib/components/tabla/TablaVacia.svelte';
	import TablaError from '$lib/components/tabla/TablaError.svelte';
	import { formatearMontoCampo, formatearPeso, normalizarMontoCampo, type Domiciliario, type DomiciliarioConBase, type PagoDomiciliario } from '$lib/types';

	interface DomiciliarioFila extends Domiciliario {
		deuda: number;
		credito_favor: number;
		pagos: PagoDomiciliario[];
	}

	let lista = $state<DomiciliarioFila[]>([]);
	let baseData = $state<DomiciliarioConBase[]>([]);
	let cargando = $state(true);
	let error = $state<string | null>(null);
	let mensaje = $state<{ tipo: 'ok' | 'err'; texto: string } | null>(null);
	let busqueda = $state('');
	let estadoRealtime = $state<RealtimeEstado>('conectando');

	// Formulario de registro: el repartidor entra con su USUARIO («movil1») o
	// con su email + contraseña. Con contraseña se crea la cuenta de Auth al
	// instante (sin correo de confirmación); sin contraseña solo se enlaza
	// una cuenta ya existente (Fase 16: username sin correo). Usuario y email
	// son ALTERNATIVAS (no combinables): el tipo de identidad lo decide el admin.
	type IdentidadAlta = 'usuario' | 'email';
	let identidadAlta = $state<IdentidadAlta>('usuario');
	let nombre = $state('');
	let username = $state('');
	let email = $state('');
	let telefono = $state('');
	let password = $state('');
	let registrando = $state(false);

	// Bloqueo y acceso: estados de carga independientes por fila
	let guardandoBloqueo = $state<Record<string, boolean>>({});
	let alternandoAcceso = $state<Record<string, boolean>>({});

	// Abono (modal)
	let abonando = $state<DomiciliarioFila | null>(null);
	let abonoValor = $state('');
	let abonoNota = $state('');
	let registrandoAbono = $state(false);

	// Reinicio de contraseña (modal): el domiciliario entra con la nueva clave,
	// sin correo de confirmación (service role en el backend).
	let reiniciandoClave = $state<DomiciliarioFila | null>(null);
	let claveNueva = $state('');
	let guardandoClave = $state(false);

	const visibles = $derived(
		lista.filter(
			(d) =>
				!busqueda.trim() ||
				d.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()) ||
				(d.username ?? '').toLowerCase().includes(busqueda.trim().toLowerCase()) ||
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
		const [r, rB] = await Promise.all([
			api.get<DomiciliarioFila[]>('/api/domiciliarios'),
			api.get<DomiciliarioConBase[]>('/api/domiciliarios/con-base')
		]);
		cargando = false;
		if (r.error) {
			error = r.error;
			return;
		}
		lista = (r.data ?? []).map((d) => ({
			...d,
			deuda: d.deuda ?? 0,				credito_favor: d.credito_favor ?? 0,
			pagos: d.pagos ?? []
		}));
		if (!rB.error) baseData = rB.data ?? [];
	}

	const cargarDebounced = debounce(() => cargar(), 250);

	async function registrar(e: SubmitEvent) {
		e.preventDefault();
		const valorIdentidad = identidadAlta === 'usuario' ? username.trim() : email.trim();
		if (!nombre.trim() || !valorIdentidad) {
			mensaje = {
				tipo: 'err',
				texto: identidadAlta === 'usuario' ? 'El nombre y el usuario son obligatorios.' : 'El nombre y el email son obligatorios.'
			};
			return;
		}
		registrando = true;
		mensaje = null;
		const r = await api.post<Domiciliario>('/api/domiciliarios', {
			nombre: nombre.trim(),
			...(identidadAlta === 'usuario' ? { username: username.trim() } : { email: email.trim() }),
			telefono: telefono.trim(),
			...(password ? { password: password.trim() } : {})
		});
		registrando = false;
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		const credencial = r.data?.username ?? r.data?.email ?? valorIdentidad;
		const cuentaCreada = r.meta?.cuentaCreada === true;
		mensaje = {
			tipo: 'ok',
			texto: cuentaCreada
				? `${r.data?.nombre ?? nombre.trim()} registrado. Ingresa al panel con «${credencial}» y la contraseña definida (sin confirmar correo).`
				: `${r.data?.nombre ?? nombre.trim()} enlazado con «${credencial}».`
		};
		nombre = '';
		username = '';
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

	function abrirReinicioClave(d: DomiciliarioFila) {
		claveNueva = '';
		reiniciandoClave = d;
	}

	async function confirmarReinicioClave() {
		if (!reiniciandoClave) return;
		const clave = claveNueva.trim();
		if (clave.length < 6) {
			mensaje = { tipo: 'err', texto: 'La contraseña debe tener al menos 6 caracteres.' };
			return;
		}
		const nombre = reiniciandoClave.nombre;
		guardandoClave = true;
		mensaje = null;
		const r = await api.put(`/api/domiciliarios?id=${reiniciandoClave.id}`, { password: clave });
		guardandoClave = false;
		if (r.error) {
			mensaje = { tipo: 'err', texto: r.error };
			return;
		}
		reiniciandoClave = null;
		claveNueva = '';
		mensaje = {
			tipo: 'ok',
			texto: `Contraseña de ${nombre} reiniciada: entra al panel con la nueva clave (sin confirmar correo).`
		};
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
			// Suscribirse también a 'pedidos' para que los cambios de estado
			// (entregado → recalcula comisión) refresquen la deuda al instante.
			limpiar = (['domiciliarios', 'pagos_domiciliarios', 'pedidos'] as const).map((tabla) =>
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
			Registra domiciliarios y gestiona su deuda, abonos y bloqueos por falta de pago.
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
			Crea el domiciliario con un usuario («movil1», «movil2»…) y contraseña: entra sin correo.
		</p>

		<p class="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-relaxed text-sky-800">
			Con contraseña se crea la cuenta <strong>automáticamente</strong> y el domiciliario ingresa con el
			<strong>usuario</strong> o <strong>email</strong> que definas, <strong>sin correo ni confirmación</strong>.
			Sin contraseña, la cuenta debe existir y solo se enlaza la fila.
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
					class="w-full rounded-xl border border-slate-300 bg-white min-h-11 px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
				/>
			</div>
			<div>
				<div class="mb-1.5 flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
					<button
						type="button"
						onclick={() => (identidadAlta = 'usuario')}
						class="flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition {identidadAlta === 'usuario'
							? 'bg-white text-primary-dark shadow-sm'
							: 'text-slate-500 hover:text-slate-700'}"
					>
						Usuario
					</button>
					<button
						type="button"
						onclick={() => (identidadAlta = 'email')}
						class="flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition {identidadAlta === 'email'
							? 'bg-white text-primary-dark shadow-sm'
							: 'text-slate-500 hover:text-slate-700'}"
					>
						Email
					</button>
				</div>
				{#if identidadAlta === 'usuario'}
					<label for="dom-username" class="mb-1.5 block text-sm font-semibold text-slate-700">
						Usuario <span class="font-normal text-slate-400">(ej. movil1)</span>
					</label>
					<input
						id="dom-username"
						type="text"
						minlength="2"
						maxlength="30"
						bind:value={username}
						placeholder="movil1"
						class="w-full rounded-xl border border-slate-300 bg-white min-h-11 px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
					/>
				{:else}
					<label for="dom-email" class="mb-1.5 block text-sm font-semibold text-slate-700">Email</label>
					<input
						id="dom-email"
						type="email"
						bind:value={email}
						placeholder="domiciliario@correo.com"
						class="w-full rounded-xl border border-slate-300 bg-white min-h-11 px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
					/>
				{/if}
			</div>
			<div>
				<label for="dom-password" class="mb-1.5 block text-sm font-semibold text-slate-700">
					Contraseña <span class="font-normal text-slate-400">(mín. 6, crea la cuenta)</span>
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
					{password ? 'Creando cuenta…' : 'Enlazando…'}
				{:else}
					{password ? 'Crear cuenta y registrar' : 'Enlazar domiciliario'}
				{/if}
			</button>
		</form>

		<div class="mt-6 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-relaxed text-sky-800">
			<p class="font-semibold">Deuda por comisiones</p>
			<p class="mt-1">
				Cada domicilio entregado genera una comisión según el nivel que corresponde al valor de ese servicio, configurada en
				<a href="/admin/comisiones" class="font-semibold underline">Comisiones</a>. Cada abono se descuenta
				inmediatamente de la deuda; si la supera, queda como crédito a favor.
			</p>
		</div>
	</div>

	<!-- Listado -->
	<div class="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm lg:col-span-2">
		<div class="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
			<input
				type="search"
				bind:value={busqueda}
				placeholder="Buscar por nombre, usuario o email…"
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
			<TablaError
				titulo="No se pudieron cargar los domiciliarios"
				mensaje={error}
				onreintentar={cargar}
			/>
		{:else if visibles.length === 0}
			<TablaVacia
				icono={Users}
				titulo={lista.length === 0 ? 'Aún no hay domiciliarios registrados.' : 'Sin resultados para la búsqueda.'}
				descripcion={lista.length === 0
					? 'Registra el primer domiciliario con el formulario de la izquierda para que aparezca aquí.'
					: 'Ajusta la búsqueda para ver más resultados.'}
			/>
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
								{d.username ? `@${d.username}` : d.email ?? '—'}{d.telefono ? ` · ${d.telefono}` : ''} · desde{' '}
								{formatearFecha(d.created_at ?? '')}
							</p>
						</div>
						<Badge tono={d.activo ? 'primary' : 'neutral'}>{d.activo ? 'Activo' : 'Inactivo'}</Badge>
						<Badge tono={d.bloqueado ? 'error' : 'success'} title={d.bloqueado ? 'Bloqueado por falta de pago' : 'Sin bloqueo'}>
							{#if d.bloqueado}
								<Icon icon={Ban} class="size-3" />
							{/if}
							{d.bloqueado ? 'Bloqueado' : 'Al día'}
						</Badge>
						</div>

						<div class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
							<!-- Deuda -->
							<div class="rounded-xl border p-3 {d.deuda > 0 ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}">
								<p class="text-[10px] font-semibold tracking-wide uppercase {d.deuda > 0 ? 'text-red-600' : 'text-green-700'}">
									Deuda pendiente
								</p>
								<p class="mt-1 text-lg font-extrabold {d.deuda > 0 ? 'text-red-700' : 'text-green-700'}">
									{formatearPeso(d.deuda)}
								</p>										<p class="text-[10px] text-slate-500">
											deuda {formatearPeso(d.deuda)}{d.credito_favor > 0 ? ` · crédito ${formatearPeso(d.credito_favor)}` : ''}
										</p>
									</div>

								<!-- Base disponible (Fase 21) -->
								{#if baseData.find((db) => db.domiciliario_id === d.id)?.turno_activo}
									{@const dBase = baseData.find((db) => db.domiciliario_id === d.id)!}
									<div class="rounded-xl border border-amber-200 bg-amber-50 p-3">
										<p class="text-[10px] font-semibold tracking-wide uppercase text-amber-600">
											💵 Base del turno
										</p>
										<p class="mt-1 text-lg font-extrabold text-slate-900">{formatearPeso(dBase.base_disponible_actual ?? 0)}</p>
										<p class="text-[10px] text-slate-500">
											declarada {formatearPeso(dBase.base_declarada ?? 0)} · desde {formatearFecha(dBase.iniciado_en ?? '')}
										</p>
									</div>
								{:else}
									<div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
										<p class="text-[10px] font-semibold tracking-wide uppercase text-slate-400">
											Sin turno activo
										</p>
									</div>
								{/if}

								<!-- Acciones de cuenta -->
							<div class="flex flex-wrap content-start gap-1.5">
								<button
									type="button"
									onclick={() => abrirAbono(d)}
									class="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary-light px-3 py-1.5 text-xs font-semibold text-primary-dark transition hover:bg-primary-light"
								>
									<Icon icon={Plus} class="size-3" />
									Registrar abono
								</button>
								<button
									type="button"
									onclick={() => abrirReinicioClave(d)}
									class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
									title="Cambiar la contraseña del domiciliario (sin correo de confirmación)"
								>
									<Icon icon={RotateCw} class="size-3" />
									Reiniciar contraseña
								</button>
								<button
									type="button"
									onclick={() => alternarBloqueo(d)}
									disabled={guardandoBloqueo[d.id]}
									class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 {d.bloqueado
										? 'border-primary/30 bg-primary-light text-primary-dark hover:bg-primary-light'
										: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'}"
								>
									<Icon icon={Ban} class="size-3" />
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

{#if reiniciandoClave}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
	>
		<div class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
			<h2 class="text-lg font-bold text-slate-900">Reiniciar contraseña — {reiniciandoClave.nombre}</h2>
			<p class="mt-1 text-sm text-slate-500">
				El domiciliario entrará al panel con la nueva contraseña, <strong>sin correo de confirmación</strong>.
			</p>
			<div class="mt-5">
				<label for="clave-nueva" class="mb-1.5 block text-sm font-semibold text-slate-700">Nueva contraseña</label>
				<input
					id="clave-nueva"
					type="password"
					minlength="6"
					required
					bind:value={claveNueva}
					placeholder="Mín. 6 caracteres"
					class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:outline-none"
				/>
			</div>
			<div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<button
					type="button"
					onclick={() => (reiniciandoClave = null)}
					disabled={guardandoClave}
					class="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
				>
					Cancelar
				</button>
				<button
					type="button"
					onclick={confirmarReinicioClave}
					disabled={guardandoClave || claveNueva.trim().length < 6}
					class="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:opacity-60"
				>
					{guardandoClave ? 'Guardando…' : 'Reiniciar contraseña'}
				</button>
			</div>
		</div>
	</div>
{/if}

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
						type="text"
						inputmode="numeric"
						value={formatearMontoCampo(abonoValor)}
						oninput={(e) => (abonoValor = normalizarMontoCampo(e.currentTarget.value))}
						placeholder="Ej: 20.000"
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
