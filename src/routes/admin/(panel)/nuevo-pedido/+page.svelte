<script lang="ts">
	import FormularioPedido from '../../../nuevo-pedido/+page.svelte';

	let { data } = $props();
</script>

<FormularioPedido data={data as any} integrado />
