<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { Zap, CircleCheck, Download, Bot, Apple, ExternalLink } from 'lucide';
	import {
		obtenerEventoInstalacion,
		estaInstalada,
		suscribirseInstalacion,
		limpiarEventoInstalacion,
		type BeforeInstallPromptEvent
	} from '$lib/pwa';

	let evento = $state<BeforeInstallPromptEvent | null>(null);
	let instalada = $state(false);
	let esIOS = $state(false);

	$effect(() => {
		evento = obtenerEventoInstalacion();
		instalada = estaInstalada();
		const unsub = suscribirseInstalacion((evt) => {
			evento = evt;
			instalada = estaInstalada();
		});
		return unsub;
	});

	$effect(() => {
		const ua = navigator.userAgent;
		esIOS =
			/iPad|iPhone|iPod/.test(ua) ||
			(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
		if (
			(typeof window.matchMedia === 'function' &&
				window.matchMedia('(display-mode: standalone)').matches) ||
			(navigator as Navigator & { standalone?: boolean }).standalone === true
		) {
			instalada = true;
		}
	});

	async function instalarPWA() {
		if (!evento) return;
		try {
			await evento.prompt();
		} catch (err) {
			console.warn('[PWA] El diálogo de instalación no se pudo abrir:', err);
		}
		limpiarEventoInstalacion();
	}

	// URLs configurables via variables de entorno (agregar en .env de admin)
	// Por ahora usamos placeholders que el admin puede cambiar
	const APK_URL = import.meta.env.PUBLIC_APK_URL ?? '';
	const TESTFLIGHT_URL = import.meta.env.PUBLIC_TESTFLIGHT_URL ?? '';
</script>

<svelte:head>
	<title>Descargar app — StarGo Admin</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-8">
	<div>
		<h1 class="text-2xl font-extrabold tracking-tight text-slate-900">Descargar StarGo</h1>
		<p class="mt-2 text-sm text-slate-500">
			Opciones para instalar la app en dispositivos móviles y computadores.
		</p>
	</div>

	<!-- PWA -->
	<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
		<div class="flex items-start gap-4">
			<div class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
				<Icon icon={Zap} class="size-6" />
			</div>
			<div class="flex-1">
				<h2 class="text-lg font-bold text-slate-900">App web (PWA)</h2>
				<p class="mt-1 text-sm text-slate-500">
					La forma más rápida. Funciona desde cualquier navegador moderno.
				</p>

				{#if instalada}
					<p class="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
						<Icon icon={CircleCheck} class="size-3.5" />
						Ya tienes StarGo instalada
					</p>
				{:else if esIOS}
					<div class="mt-4 space-y-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
						<p class="font-semibold text-slate-800">Cómo instalar en iPhone:</p>
						<ol class="list-inside list-decimal space-y-1">
							<li>Toca el botón <b>Compartir</b> (cuadrado con flecha ↗).</li>
							<li>Elige <b>Añadir a pantalla de inicio</b>.</li>
							<li>Toca <b>Añadir</b> y StarGo quedará en tu pantalla.</li>
						</ol>
					</div>
				{:else if evento}
					<button
						type="button"
						onclick={instalarPWA}
						class="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-dark"
					>
						<Icon icon={Download} class="size-4" />
						Instalar StarGo
					</button>
				{:else}
					<div class="mt-4 space-y-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
						<p class="font-semibold text-slate-800">Cómo instalar:</p>
						<ol class="list-inside list-decimal space-y-1">
							<li>Abre <b>stargo.vercel.app</b> en el navegador.</li>
							<li>Toca el menú <b>⋮</b> → <b>Añadir a pantalla de inicio</b>.</li>
							<li>Confirma y StarGo quedará en tu pantalla.</li>
						</ol>
					</div>
				{/if}

				<div class="mt-3 flex flex-wrap gap-4 text-xs text-slate-400">
					<span>Funciona offline (básico)</span>
					<span>•</span>
					<span>Notificaciones push (Web Push)</span>
					<span>•</span>
					<span>Cualquier navegador</span>
				</div>
			</div>
		</div>
	</div>

	<!-- Android APK -->
	<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
		<div class="flex items-start gap-4">
			<div class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
				<Icon icon={Bot} class="size-6" />
			</div>
			<div class="flex-1">
				<h2 class="text-lg font-bold text-slate-900">Android (APK)</h2>
				<p class="mt-1 text-sm text-slate-500">
					Instalación directa sin pasar por Google Play. Push nativo con FCM.
				</p>

				{#if APK_URL}
					<a
						href={APK_URL}
						download
						class="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
					>
						<Icon icon={Download} class="size-4" />
						Descargar APK
					</a>
				{:else}
					<p class="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-700">
						El enlace de descarga del APK no está configurado. Agrega
						<code class="font-mono">PUBLIC_APK_URL</code> en las variables de entorno.
					</p>
				{/if}

				<div class="mt-4 space-y-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
					<p class="font-semibold text-slate-800">Cómo instalar:</p>
					<ol class="list-inside list-decimal space-y-1">
						<li>Descarga el archivo APK.</li>
						<li>Ábrelo en tu teléfono (habilita <b>Fuentes desconocidas</b> si es necesario).</li>
						<li>Sigue las instrucciones en pantalla.</li>
					</ol>
				</div>

				<div class="mt-3 flex flex-wrap gap-4 text-xs text-slate-400">
					<span>Android 8+</span>
					<span>•</span>
					<span>Push nativo (FCM)</span>
					<span>•</span>
					<span>Funciona offline</span>
				</div>
			</div>
		</div>
	</div>

	<!-- iOS TestFlight -->
	<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
		<div class="flex items-start gap-4">
			<div class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
				<Icon icon={Apple} class="size-6" />
			</div>
			<div class="flex-1">
				<h2 class="text-lg font-bold text-slate-900">iOS (TestFlight)</h2>
				<p class="mt-1 text-sm text-slate-500">
					Versión beta para iPhone. Requiere la app TestFlight de Apple.
				</p>

				{#if TESTFLIGHT_URL}
					<a
						href={TESTFLIGHT_URL}
						target="_blank"
						rel="noopener noreferrer"
						class="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
					>
						<Icon icon={ExternalLink} class="size-4" />
						Abrir en TestFlight
					</a>
				{:else}
					<p class="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-700">
						El enlace de TestFlight no está configurado. Agrega
						<code class="font-mono">PUBLIC_TESTFLIGHT_URL</code> en las variables de entorno.
					</p>
				{/if}

				<div class="mt-4 space-y-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
					<p class="font-semibold text-slate-800">Cómo instalar:</p>
					<ol class="list-inside list-decimal space-y-1">
						<li>Instala <a href="https://apps.apple.com/app/testflight/id899247664" target="_blank" rel="noopener noreferrer" class="font-semibold text-blue-600 hover:underline">TestFlight</a> desde la App Store (gratis).</li>
						<li>Abre el enlace de invitación.</li>
						<li>Toca <b>Aceptar</b> y luego <b>Instalar</b>.</li>
					</ol>
				</div>

				<div class="mt-3 flex flex-wrap gap-4 text-xs text-slate-400">
					<span>iOS 16.4+</span>
					<span>•</span>
					<span>Push nativo (APNs)</span>
					<span>•</span>
					<span>Actualizaciones automáticas</span>
				</div>
			</div>
		</div>
	</div>

	<!-- Comparación -->
	<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
		<h2 class="text-lg font-bold text-slate-900">Comparación</h2>
		<div class="mt-4 overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-slate-200 text-left text-xs font-semibold text-slate-500 uppercase">
						<th class="pb-3 pr-4">Característica</th>
						<th class="pb-3 pr-4">PWA</th>
						<th class="pb-3 pr-4">Android</th>
						<th class="pb-3">iOS</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100 text-slate-600">
					<tr>
						<td class="py-3 pr-4 font-medium text-slate-800">Instalación</td>
						<td class="py-3 pr-4">Desde el navegador</td>
						<td class="py-3 pr-4">Descarga APK</td>
						<td class="py-3">TestFlight</td>
					</tr>
					<tr>
						<td class="py-3 pr-4 font-medium text-slate-800">Push nativo</td>
						<td class="py-3 pr-4">Web Push</td>
						<td class="py-3 pr-4">FCM nativo</td>
						<td class="py-3">APNs nativo</td>
					</tr>
					<tr>
						<td class="py-3 pr-4 font-medium text-slate-800">Offline</td>
						<td class="py-3 pr-4">Básico</td>
						<td class="py-3 pr-4">Completo</td>
						<td class="py-3">Completo</td>
					</tr>
					<tr>
						<td class="py-3 pr-4 font-medium text-slate-800">Actualizaciones</td>
						<td class="py-3 pr-4">Automáticas</td>
						<td class="py-3 pr-4">Nuevo APK</td>
						<td class="py-3">Automáticas</td>
					</tr>
					<tr>
						<td class="py-3 pr-4 font-medium text-slate-800">Compatibilidad</td>
						<td class="py-3 pr-4">Cualquier navegador</td>
						<td class="py-3 pr-4">Android 8+</td>
						<td class="py-3">iOS 16.4+</td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>
</div>
