<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';

	let email = $state('');
	let password = $state('');
	let cargando = $state(false);
	let error = $state<string | null>(null);

	async function entrar(e: SubmitEvent) {
		e.preventDefault();
		if (!email || !password) {
			error = 'Ingresa tu email y contraseña';
			return;
		}
		cargando = true;
		error = null;
		const r = await api.post<{ email: string; esAdmin: boolean; esDomiciliario: boolean }>('/api/login', {
			email,
			password
		});
		cargando = false;
		if (r.error) {
			error = r.error;
			return;
		}
		if (r.data?.esAdmin) goto('/admin');
		else if (r.data?.esDomiciliario) goto('/domiciliario');
		else goto('/');
	}
</script>

<svelte:head>
	<title>Iniciar sesión — StarGo</title>
</svelte:head>

<div class="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-6 py-12">
	<div class="pointer-events-none absolute inset-0">
		<div class="absolute -top-32 right-0 size-[28rem] rounded-full bg-emerald-500/20 blur-3xl" ></div>
		<div class="absolute -bottom-32 left-0 size-[28rem] rounded-full bg-teal-500/15 blur-3xl" ></div>
	</div>

	<div class="relative z-10 w-full max-w-md">
		<a href="/" class="mb-8 flex items-center justify-center gap-2.5">
			<div class="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg shadow-emerald-500/30">
				<svg class="size-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M5 11 4 4h4l3 7" />
					<path d="M5 11h14l1 3H6" />
					<circle cx="6" cy="17" r="1.5" />
					<circle cx="17" cy="17" r="1.5" />
				</svg>
			</div>
			<span class="text-xl font-bold text-white">StarGo</span>
		</a>

		<div class="rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
			<h1 class="text-lg font-bold text-white">Acceso a los paneles</h1>
			<p class="mt-1 text-sm text-slate-400">
				Ingresa con tu cuenta de Supabase. El sistema detecta tu rol (administrador o domiciliario).
			</p>

			<form class="mt-6 space-y-4" onsubmit={entrar}>
				<div>
					<label for="email" class="mb-1.5 block text-sm font-medium text-slate-300">Email</label>
					<input
						id="email"
						type="email"
						required
						autocomplete="email"
						bind:value={email}
						placeholder="tucuenta@correo.com"
						class="w-full rounded-xl border border-white/10 bg-slate-900/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30 focus:outline-none"
					/>
				</div>
				<div>
					<label for="password" class="mb-1.5 block text-sm font-medium text-slate-300">Contraseña</label>
					<input
						id="password"
						type="password"
						required
						autocomplete="current-password"
						bind:value={password}
						placeholder="••••••••"
						class="w-full rounded-xl border border-white/10 bg-slate-900/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30 focus:outline-none"
					/>
				</div>

				{#if error}
					<div class="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
				{/if}

				<button
					type="submit"
					disabled={cargando}
					class="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-slate-950 shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
				>
					{#if cargando}
						<span class="size-4 animate-spin rounded-full border-2 border-slate-900/40 border-t-slate-900" ></span>
						Ingresando…
					{:else}
						Iniciar sesión
					{/if}
				</button>
			</form>
		</div>

		<div class="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-xs leading-relaxed text-slate-400">
			<p class="mb-1 font-semibold text-slate-300">¿Primera vez?</p>
			<p>
				<span class="text-emerald-300">Administrador:</span> crea tu usuario en Supabase (Authentication → Users → Add user),
				ejecuta <code class="text-emerald-300">supabase/agregar_admin.sql</code> con tu email y entra aquí.
			</p>
			<p class="mt-2">
				<span class="text-emerald-300">Domiciliario:</span> crea tu cuenta en Supabase con el mismo email y pide al administrador
				que te registre desde el panel (Admin → Domiciliarios).
			</p>
		</div>
	</div>
</div>
