<script lang="ts">
	/**
	 * Logo único de StarGo.
	 * - type: 'mark' = solo símbolo "S" · 'full' = símbolo + wordmark "stargo".
	 * - surface: 'light' = logo azul sobre fondos claros · 'dark' = logo blanco sobre fondos oscuros.
	 * Los consumidores SIEMPRE pasan por <Logo /> (nada de rutas /brand/ hardcodeadas).
	 */
	let {
		type = 'full',
		surface = 'light',
		height = 32,
		priority = false
	}: {
		type?: 'mark' | 'full';
		surface?: 'light' | 'dark';
		height?: number;
		priority?: boolean;
	} = $props();

	const ASSETS = {
		mark: {
			light: '/brand/stargo-mark-blue.svg',
			dark: '/brand/stargo-mark-white.svg'
		},
		full: {
			light: '/brand/stargo-full-blue.svg',
			dark: '/brand/stargo-full-white.svg'
		}
	};
</script>

<img
	src={ASSETS[type][surface]}
	alt="Stargo"
	style="height: {height}px; width: auto;"
	loading={priority ? 'eager' : 'lazy'}
	fetchpriority={priority ? 'high' : 'auto'}
/>
