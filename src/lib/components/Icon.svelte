<script lang="ts">
	import { FontAwesomeIcon } from '@fortawesome/svelte-fontawesome';
	import { faCircleInfo } from '@fortawesome/free-solid-svg-icons';
	import { iconos } from './icon-registry';

	let { name, class: clase = '', title }: { name: string; class?: string; title?: string } = $props();
</script>

<FontAwesomeIcon icon={iconos[name] ?? faCircleInfo} class={clase} {title} />
