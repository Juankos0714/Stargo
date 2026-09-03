<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		tono = 'neutral',
		size = 'sm',
		class: clase = '',
		title,
		children
	}: {
		tono?: 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary';
		size?: 'xs' | 'sm';
		class?: string;
		title?: string;
		children: Snippet;
	} = $props();

	const TONOS = {
		success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
		warning: 'border-amber-200 bg-amber-50 text-amber-700',
		error: 'border-red-200 bg-red-50 text-red-700',
		info: 'border-sky-200 bg-sky-50 text-sky-700',
		neutral: 'border-slate-200 bg-slate-100 text-slate-600',
		primary: 'border-primary/30 bg-primary-light text-primary-dark'
	} as const;

	const TAMANOS = {
		xs: 'px-2 py-0.5 text-[10px]',
		sm: 'px-2.5 py-0.5 text-xs'
	} as const;
</script>

<span
	{title}
	class="inline-flex shrink-0 items-center gap-1 rounded-full border font-semibold whitespace-nowrap {TAMANOS[size]} {TONOS[tono]} {clase}"
>
	{@render children()}
</span>