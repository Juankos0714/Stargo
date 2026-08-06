<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import Logo from '$lib/components/Logo.svelte';

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

<div class="relative flex min-h-screen items-center justify-center overflow-hidden bg-navy px-6 py-12">

	<div class="relative z-10 w-full max-w-md">
		<a href="/" class="mb-8 flex justify-center">
			<Logo type="full" surface="dark" height={40} priority />
		</a>

		<div class="rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
			<h1 class="text-lg font-bold text-white">Acceso a los paneles</h1>
			<p class="mt-1 text-sm text-slate-400">
				Ingresa con tu correo y contraseña. El sistema detecta tu rol y te lleva a tu panel.
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
						class="w-full rounded-xl border border-white/10 bg-slate-900/60 min-h-11 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
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
						class="w-full rounded-xl border border-white/10 bg-slate-900/60 min-h-11 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
					/>
				</div>

				{#if error}
					<div class="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
				{/if}

				<button
					type="submit"
					disabled={cargando}
					class="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-white shadow-lg transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
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
				Si aún no tienes acceso, pide a tu administrador que cree tu cuenta. Cada usuario entra con su correo y contraseña.
			</p>
		</div>
	</div>
</div>
