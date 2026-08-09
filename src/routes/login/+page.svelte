<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import Logo from '$lib/components/Logo.svelte';

	let email = $state('');
	let password = $state('');
	let cargando = $state(false);
	let error = $state<string | null>(null);

	// Recuperación de contraseña desde el correo.
	let modoRecuperar = $state(false);
	let enviandoEnlace = $state(false);
	let enlaceEnviado = $state(false);
	let errorRecuperar = $state<string | null>(null);
	let aviso = $state<string | null>(null);

	// Viene de /recuperar-clave: la contraseña se cambió correctamente.
	onMount(() => {
		if (new URLSearchParams(window.location.search).get('recuperada')) {
			aviso = 'Contraseña actualizada. Inicia sesión con tu nueva contraseña.';
			window.history.replaceState(null, '', window.location.pathname);
		}
	});

	async function entrar(e: SubmitEvent) {
		e.preventDefault();
		if (!email || !password) {
			error = 'Ingresa tu usuario o email y contraseña';
			return;
		}
		cargando = true;
		error = null;
		const r = await api.post<{ email: string; esAdmin: boolean; esDomiciliario: boolean }>('/api/login', {
			identificador: email,
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

	async function enviarEnlace(e: SubmitEvent) {
		e.preventDefault();
		const correo = email.trim();
		if (!correo) {
			errorRecuperar = 'Ingresa tu email para enviarte el enlace de recuperación.';
			return;
		}
		enviandoEnlace = true;
		errorRecuperar = null;
		const { error } = await supabaseBrowser.auth.resetPasswordForEmail(correo, {
			redirectTo: `${window.location.origin}/recuperar-clave`
		});
		enviandoEnlace = false;
		if (error) {
			errorRecuperar =
				error.message.toLowerCase().includes('email not confirmed')
					? 'Confirma tu email antes de recuperar tu contraseña.'
					: error.message || 'No se pudo enviar el enlace. Intenta de nuevo.';
			return;
		}
		enlaceEnviado = true;
	}

	function volverAlLogin() {
		modoRecuperar = false;
		enlaceEnviado = false;
		errorRecuperar = null;
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
				Ingresa con tu usuario (ej. «movil1») o tu email y tu contraseña. El sistema detecta tu rol y te lleva a tu panel.
			</p>

			{#if aviso}
				<div class="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
					{aviso}
				</div>
			{/if}

			{#if enlaceEnviado}
				<div class="mt-6">
					<div class="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-300">
						<p class="font-semibold">Revisa tu correo</p>
						<p class="mt-1 leading-relaxed">
							Te enviamos un enlace de recuperación a <span class="font-semibold">{email.trim()}</span>.
							Ábrelo para definir una nueva contraseña. Revisa también la carpeta de spam.
						</p>
					</div>
					<button
						type="button"
						onclick={volverAlLogin}
						class="mt-4 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10"
					>
						Volver al inicio de sesión
					</button>
				</div>
			{:else if modoRecuperar}
				<form class="mt-6 space-y-4" onsubmit={enviarEnlace}>
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

					{#if errorRecuperar}
						<div class="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
							{errorRecuperar}
						</div>
					{/if}

					<button
						type="submit"
						disabled={enviandoEnlace}
						class="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-white shadow-lg transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
					>
						{#if enviandoEnlace}
							<span class="size-4 animate-spin rounded-full border-2 border-slate-900/40 border-t-slate-900"></span>
							Enviando…
						{:else}
							Enviar enlace de recuperación
						{/if}
					</button>

					<button
						type="button"
						onclick={volverAlLogin}
						class="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10"
					>
						Volver al inicio de sesión
					</button>
				</form>
			{:else}
				<form class="mt-6 space-y-4" onsubmit={entrar}>
					<div>
						<label for="email" class="mb-1.5 block text-sm font-medium text-slate-300">Usuario o email</label>
						<input
							id="email"
							type="text"
							required
							autocomplete="username"
							bind:value={email}
							placeholder="movil1 o tucuenta@correo.com"
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

				<div class="mt-4 text-center">
					<button
						type="button"
						onclick={() => {
							modoRecuperar = true;
							error = null;
						}}
						class="text-sm text-slate-400 underline-offset-4 transition hover:text-slate-200 hover:underline"
					>
						¿Olvidaste tu contraseña?
					</button>
				</div>
			{/if}
		</div>

		<div class="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-xs leading-relaxed text-slate-400">
			<p class="mb-1 font-semibold text-slate-300">¿Primera vez?</p>
			<p>
				Tu cuenta de acceso (admin o domiciliario) la crea tu administrador en el panel de administración de la
				app. Una vez creada, inicia sesión aquí con el usuario o email y la contraseña que te entregaron.
			</p>
		</div>
	</div>
</div>
