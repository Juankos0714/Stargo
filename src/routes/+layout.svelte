<script lang="ts">
	import './layout.css';
	import IndicadorOffline from '$lib/components/IndicadorOffline.svelte';

	let { children } = $props();

	// OG/Twitter necesitan URL absoluta: usa PUBLIC_APP_URL si está definida
	// (definirla en el deploy), con fallback relativo en desarrollo.
	const base = String(import.meta.env.PUBLIC_APP_URL ?? '').replace(/\/$/, '');
	const ogImage = base ? `${base}/icons/og-image.png` : '/icons/og-image.png';
</script>

<svelte:head>
	<link rel="icon" type="image/png" href="/icons/favicon.png" />
	<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
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
{@render children()}
