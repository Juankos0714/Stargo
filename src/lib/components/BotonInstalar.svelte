<script lang="ts">
	import Icon from './Icon.svelte';
	import {
		obtenerEventoInstalacion,
		estaInstalada,
		suscribirseInstalacion,
		limpiarEventoInstalacion,
		type BeforeInstallPromptEvent
	} from '$lib/pwa';

	/**
	 * Botón flotante de instalación PWA.
	 *
	 * - Chrome/Edge (Android y Desktop): dispara el diálogo nativo usando el
	 *   `beforeinstallprompt` capturado a nivel de módulo en $lib/pwa.ts
	 *   (así no se pierde si llega antes de que la app hidrate).
	 * - iOS Safari: no existe `beforeinstallprompt`; se muestra una guía
	 *   paso a paso (Compartir → Añadir a pantalla de inicio).
	 * - Firefox Android / Samsung Internet / navegadores embebidos: tampoco lo
	 *   disparan; en móvil, si el evento no llega al poco de cargar, se ofrece
	 *   la guía del menú del navegador como respaldo.
	 * - No se muestra si la app ya está instalada o corre en modo standalone.
	 *
	 * IMPORTANTE (SSR): este componente se renderiza en el servidor, donde NO
	 * existe `window` (ni `navigator` en entornos antiguos). Toda la detección
	 * de dispositivo/instalación vive en $effects, que solo corren en el
	 * cliente tras la hidratación: así el HTML del servidor y el primer render
	 * del cliente son idénticos (sin botón) y no hay mismatch de hidratación
	 * ni 500 por acceder a `window` en Node.
	 */

	let evento = $state<BeforeInstallPromptEvent | null>(null);
	let instalada = $state(false);
	// Detección de dispositivo: solo disponible en el cliente (post-hidratación).
	let esIOS = $state(false);
	let esMovil = $state(false);
	let guia = $state(false);
	let dialogoEl = $state<HTMLDivElement | null>(null);
	// Respaldo para móviles sin beforeinstallprompt (Firefox Android, Samsung
	// Internet…): si el evento nativo no llega al poco de cargar, se muestra
	// la guía del menú del navegador.
	let guiaRespaldo = $state(false);

	$effect(() => {
		// Sincroniza con la captura a nivel de módulo: el evento pudo llegar
		// antes de que este componente montara (hidratación lenta en móvil).
		evento = obtenerEventoInstalacion();
		instalada = estaInstalada();
		const unsub = suscribirseInstalacion((evt) => {
			evento = evt;
			instalada = estaInstalada();
			if (evt) {
				// Llegó el evento nativo: se deja la guía a un lado para ofrecer
				// el diálogo real de instalación.
				guiaRespaldo = false;
				guia = false;
			}
		});
		return unsub;
	});

	$effect(() => {
		// Detección de dispositivo e instalación (solo cliente).
		const ua = navigator.userAgent;
		// iOS Safari no dispara beforeinstallprompt: detecta iPhone/iPad/iPod
		// (incluye el iPad con iPadOS que reporta platform "MacIntel").
		esIOS =
			/iPad|iPhone|iPod/.test(ua) ||
			(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
		// Móvil/tableta: pantalla táctil (pointer: coarse) o user-agent móvil.
		esMovil =
			(typeof window.matchMedia === 'function' &&
				window.matchMedia('(pointer: coarse)').matches) ||
			/android|iphone|ipad|ipod/i.test(ua);
		// Si la app ya corre en modo standalone (instalada desde el inicio),
		// no se ofrece el botón.
		if (
			(typeof window.matchMedia === 'function' &&
				window.matchMedia('(display-mode: standalone)').matches) ||
			(navigator as Navigator & { standalone?: boolean }).standalone === true
		) {
			instalada = true;
		}
	});

	$effect(() => {
		if (instalada || esIOS || evento) return;
		if (!esMovil) return;
		const t = setTimeout(() => {
			guiaRespaldo = true;
		}, 2500);
		return () => clearTimeout(t);
	});

	// Al abrir la guía, mueve el foco al diálogo (accesibilidad de teclado).
	$effect(() => {
		if (guia && dialogoEl) dialogoEl.focus();
	});

	async function instalar() {
		if (!evento) return;
		try {
			await evento.prompt();
		} catch (err) {
			// Algún navegador puede no mostrar el diálogo; no bloquea la app.
			console.warn('[PWA] El diálogo de instalación no se pudo abrir:', err);
		}
		// El evento guardado solo se puede usar una vez; si el usuario lo
		// descarta, la opción vuelve a ofrecerse en una visita posterior.
		limpiarEventoInstalacion();
	}

	function alHacerClic() {
		if (evento) {
			instalar();
		} else {
			guia = true;
		}
	}
</script>

{#if !instalada && (evento || esIOS || guiaRespaldo)}
	<button
		type="button"
		onclick={alHacerClic}
		class="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/30 transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary-dark hover:shadow-xl active:scale-95"
	>
		<Icon name="download" class="size-4" />
		Instalar app
	</button>
{/if}

{#if guia}
	<div
		class="fixed inset-0 z-[70] flex items-end justify-center bg-navy/40 p-4 backdrop-blur-sm sm:items-center"
		role="dialog"
		aria-modal="true"
		aria-label="Cómo instalar StarGo"
		tabindex="-1"
		bind:this={dialogoEl}
		onclick={(e) => {
			if (e.target === e.currentTarget) guia = false;
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') guia = false;
		}}
	>
		<div class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
			<div class="flex items-start justify-between gap-3">
				<h2 class="text-base font-bold text-navy">Instalar StarGo</h2>
				<button
					type="button"
					onclick={() => (guia = false)}
					class="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
					aria-label="Cerrar"
				>
					<Icon name="xmark" class="size-4" />
				</button>
			</div>
			{#if esIOS}
				<ol class="mt-4 space-y-3 text-sm text-gray-600">
					<li class="flex gap-2.5">
						<span class="font-bold text-primary">1</span>
						Toca el botón <b>Compartir</b> (cuadrado con flecha hacia arriba)
						en la barra inferior del navegador.
					</li>
					<li class="flex gap-2.5">
						<span class="font-bold text-primary">2</span>
						Desliza hacia abajo y elige
						<b class="font-semibold">&nbsp;Añadir a pantalla de inicio</b>.
					</li>
					<li class="flex gap-2.5">
						<span class="font-bold text-primary">3</span>
						Toca <b class="font-semibold">&nbsp;Añadir</b>&nbsp;y StarGo quedará
						en tu pantalla como una app.
					</li>
				</ol>
			{:else}
				<ol class="mt-4 space-y-3 text-sm text-gray-600">
					<li class="flex gap-2.5">
						<span class="font-bold text-primary">1</span>
						Toca el menú <b>&nbsp;⋮&nbsp;</b> (tres puntos) en la esquina
						superior derecha del navegador.
					</li>
					<li class="flex gap-2.5">
						<span class="font-bold text-primary">2</span>
						Elige <b class="font-semibold">&nbsp;Añadir a pantalla de inicio</b>
						(o <b class="font-semibold">&nbsp;Instalar app</b>).
					</li>
					<li class="flex gap-2.5">
						<span class="font-bold text-primary">3</span>
						Confirma el diálogo y StarGo quedará en tu pantalla como una app.
					</li>
				</ol>
			{/if}
			<button
				type="button"
				onclick={() => (guia = false)}
				class="mt-5 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
			>
				Entendido
			</button>
		</div>
	</div>
{/if}
