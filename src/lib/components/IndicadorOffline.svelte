<script lang="ts">
	import Icon from './Icon.svelte';

	let offline = $state(false);

	$effect(() => {
		const actualizar = () => (offline = !navigator.onLine);
		window.addEventListener('online', actualizar);
		window.addEventListener('offline', actualizar);
		actualizar();
		return () => {
			window.removeEventListener('online', actualizar);
			window.removeEventListener('offline', actualizar);
		};
	});
</script>

{#if offline}
	<div
		class="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-xs font-bold text-amber-950 shadow-lg"
		role="status"
	>
		<Icon name="triangle-exclamation" class="size-3.5 shrink-0" />
		Sin conexión — los datos pueden estar desactualizados
	</div>
{/if}
