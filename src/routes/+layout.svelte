<script lang="ts">
	import './layout.css';
	// Inter auto-alojada: @font-face con font-display: swap, sin petición
	// bloqueante a fonts.googleapis.com en la ruta crítica.
	import '@fontsource-variable/inter';
	import IndicadorOffline from '$lib/components/IndicadorOffline.svelte';
	import BotonInstalar from '$lib/components/BotonInstalar.svelte';
	import { registrarSonidoSW } from '$lib/sonido';
	import { base as basePath } from '$app/paths';

	let { children } = $props();

	// Registro del service worker (requisito PWA para que aparezca la opción
	// de instalar/descargar en móviles). SvelteKit NO lo registra solo, y el
	// archivo solo se compila en builds de producción. También se escuchan los
	// mensajes «sonar» del SW: cuando llega un push con la app abierta y
	// Realtime está caído, el SW pide a la pestaña que reproduzca la campana.
	$effect(() => {
		if (!import.meta.env.PROD) return;
		registrarSonidoSW();
		if (!('serviceWorker' in navigator)) return;
		navigator.serviceWorker.register(`${basePath}/service-worker.js`).catch((err) => {
			// No bloquea la app; solo ayuda a diagnosticar si no aparece el prompt de instalación.
			console.warn('[PWA] Service worker no registrado:', err);
		});
	});

	// OG/Twitter necesitan URL absoluta: usa PUBLIC_APP_URL si está definida
	// (definirla en el deploy), con fallback relativo en desarrollo.
	const base = String(import.meta.env.PUBLIC_APP_URL ?? '').replace(/\/$/, '');
	const ogImage = base ? `${base}/icons/og-image.png` : '/icons/og-image.png';
</script>

<svelte:head>
	<link rel="icon" type="image/png" href="/icons/favicon.png" />
	<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
	<meta name="description" content="Haz tu pedido con tarifa calculada automáticamente y sigue su estado en vivo." />
	<meta property="og:site_name" content="StarGo" />
	<meta property="og:title" content="StarGo — Domicilios en Armenia" />
	<meta property="og:description" content="Haz tu pedido con tarifa calculada automáticamente y sigue su estado en vivo." />
	<meta property="og:type" content="website" />
	<meta property="og:image" content={ogImage} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="StarGo — Domicilios en Armenia" />
	<meta name="twitter:image" content={ogImage} />
</svelte:head>
<IndicadorOffline />
<BotonInstalar />
{@render children()}
