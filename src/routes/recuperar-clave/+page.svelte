<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import Logo from '$lib/components/Logo.svelte';

	/**
	 * Página de recuperación de contraseña.
	 *
	 * Supabase Auth envía al correo un enlace de recuperación que termina
	 * acá con la sesión de recuperación. Según el flujo configurado el
	 * enlace llega de una de estas formas:
	 *
	 *   ?code=…                      (PKCE, el flujo por defecto de supabase-js)
	 *   ?token_hash=…                (token directo)
	 *   #access_token=…&type=recovery (flujo implícito clásico)
	 *
	 * El cliente supabase-js del navegador detecta y procesa SOLO el enlace
	 * de la URL durante su inicialización (emite el evento PASSWORD_RECOVERY
	 * al hacerlo), así que esta página usa el patrón canónico: escucha ese
	 * evento y, como respaldo, verifica la sesión de recuperación activa en
	 * caso de que el evento ya se haya disparado antes de suscribirse.
	 * Al tener la sesión de recuperación, el usuario define su nueva
	 * contraseña y se cierra la sesión para que entre desde el login.
	 */

	type Estado = 'cargando' | 'lista' | 'error';

	let estado = $state<Estado>('cargando');
	let mensaje = $state('');
	let password = $state('');
	let password2 = $state('');
	let cambiando = $state(false);
	let errorForm = $state<string | null>(null);

	onMount(() => {
		// El enlace venía en la URL de esta carga (code/token_hash o tokens en
		// el hash). Se captura sincrónico, antes de que gotrue-js lo procese.
		const params = new URLSearchParams(window.location.search);
		const hash = new URLSearchParams(window.location.hash.slice(1));
		const habiaEnlace = Boolean(
			params.get('code') ||
				params.get('token_hash') ||
				(hash.get('access_token') && hash.get('refresh_token'))
		);

		// Sin enlace en la URL no hay nada que validar.
		if (!habiaEnlace) {
			estado = 'error';
			mensaje = 'El enlace es inválido o ya expiró. Solicita uno nuevo desde el inicio de sesión.';
			return;
		}

		// gotrue-js procesa el enlace y emite PASSWORD_RECOVERY al lograrlo.
		const { data: suscripcion } = supabaseBrowser.auth.onAuthStateChange((evento) => {
			if (evento === 'PASSWORD_RECOVERY') {
				estado = 'lista';
				window.history.replaceState(null, '', window.location.pathname);
			}
		});

		// Respaldo: si el evento ya se disparó antes de suscribirnos (la
		// inicialización del cliente es asíncrona), la sesión de recuperación
		// ya está activa; si el enlace no se pudo consumir, mostramos el error.
		const verificar = async (): Promise<void> => {
			try {
				const { data } = await supabaseBrowser.auth.getSession();
				if (data.session && habiaEnlace) {
					estado = 'lista';
					window.history.replaceState(null, '', window.location.pathname);
				} else if (!data.session && estado !== 'lista') {
					estado = 'error';
					mensaje =
						'El enlace es inválido o ya expiró. Solicita uno nuevo desde el inicio de sesión.';
				}
			} catch {
				if (estado !== 'lista') {
					estado = 'error';
					mensaje =
						'El enlace es inválido o ya expiró. Solicita uno nuevo desde el inicio de sesión.';
				}
			}
		};
		const timer = setTimeout(verificar, 400);

		return () => {
			clearTimeout(timer);
			suscripcion.subscription.unsubscribe();
		};
	});

	async function cambiarClave(e: SubmitEvent) {
		e.preventDefault();
		if (password.length < 6) {
			errorForm = 'La contraseña debe tener al menos 6 caracteres.';
			return;
		}
		if (password !== password2) {
			errorForm = 'Las contraseñas no coinciden.';
			return;
		}
		cambiando = true;
		errorForm = null;
		const { error } = await supabaseBrowser.auth.updateUser({ password });
		cambiando = false;
		if (error) {
			errorForm = error.message || 'No se pudo cambiar la contraseña. Intenta de nuevo.';
			return;
		}
		// Cierra la sesión de recuperación (best-effort) y vuelve al login:
		// el usuario entra con su nueva clave.
		try {
			await supabaseBrowser.auth.signOut();
		} catch {
			// No debe bloquear la redirección aunque falle el cierre.
		}
		goto('/login?recuperada=1', { replaceState: true });
	}
</script>

<svelte:head>
	<title>Recuperar contraseña — StarGo</title>
</svelte:head>

<div class="relative flex min-h-screen items-center justify-center overflow-hidden bg-navy px-6 py-12">
	<div class="relative z-10 w-full max-w-md">
		<a href="/" class="mb-8 flex justify-center">
			<Logo type="full" surface="dark" height={40} priority />
		</a>

		<div class="rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
			{#if estado === 'cargando'}
				<div class="flex flex-col items-center gap-3 py-6 text-center">
					<span
						class="size-8 animate-spin rounded-full border-2 border-slate-400/30 border-t-slate-200"
					></span>
					<p class="text-sm text-slate-300">Validando tu enlace…</p>
				</div>
			{:else if estado === 'error'}
				<h1 class="text-lg font-bold text-white">Enlace no válido</h1>
				<p class="mt-2 text-sm leading-relaxed text-slate-400">{mensaje}</p>
				<button
					onclick={() => goto('/login')}
					class="mt-6 w-full rounded-xl bg-primary px-4 py-3 font-semibold text-white shadow-lg transition hover:bg-primary-dark"
				>
					Ir al inicio de sesión
				</button>
			{:else}
				<h1 class="text-lg font-bold text-white">Nueva contraseña</h1>
				<p class="mt-1 text-sm text-slate-400">
					Define una nueva contraseña para tu cuenta. Luego podrás entrar desde el inicio de sesión.
				</p>

				<form class="mt-6 space-y-4" onsubmit={cambiarClave}>
					<div>
						<label for="password" class="mb-1.5 block text-sm font-medium text-slate-300">
							Nueva contraseña
						</label>
						<input
							id="password"
							type="password"
							required
							minlength="6"
							autocomplete="new-password"
							bind:value={password}
							placeholder="Mínimo 6 caracteres"
							class="w-full rounded-xl border border-white/10 bg-slate-900/60 min-h-11 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
						/>
					</div>
					<div>
						<label for="password2" class="mb-1.5 block text-sm font-medium text-slate-300">
							Repite la contraseña
						</label>
						<input
							id="password2"
							type="password"
							required
							minlength="6"
							autocomplete="new-password"
							bind:value={password2}
							placeholder="••••••••"
							class="w-full rounded-xl border border-white/10 bg-slate-900/60 min-h-11 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
						/>
					</div>

					{#if errorForm}
						<div class="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
							{errorForm}
						</div>
					{/if}

					<button
						type="submit"
						disabled={cambiando}
						class="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-white shadow-lg transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
					>
						{#if cambiando}
							<span class="size-4 animate-spin rounded-full border-2 border-slate-900/40 border-t-slate-900"></span>
							Guardando…
						{:else}
							Cambiar contraseña
						{/if}
					</button>
				</form>
			{/if}
		</div>

		<div class="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-xs leading-relaxed text-slate-400">
			<p>
				¿No pediste recuperar tu contraseña? Ignora este correo; tu contraseña actual sigue funcionando
				mientras no completes este paso.
			</p>
		</div>
	</div>
</div>
