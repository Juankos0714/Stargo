<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		variant = 'secundario',
		size = 'sm',
		class: clase = '',
		children,
		...rest
	}: {
		variant?: 'primario' | 'secundario' | 'peligro' | 'fantasma';
		size?: 'xs' | 'sm' | 'md';
		class?: string;
		children: Snippet;
		[key: string]: unknown;
	} = $props();

	const VARIANTES = {
		primario: 'bg-primary text-white shadow-sm hover:bg-primary-dark',
		secundario: 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
		peligro: 'border border-red-200 bg-red-50 text-red-600 hover:bg-red-100',
		fantasma: 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
	} as const;

	const TAMANOS = {
		xs: 'px-2.5 py-1 text-xs',
		sm: 'px-3 py-1.5 text-xs',
		md: 'px-4 py-2.5 text-sm'
	} as const;
</script>

<button
	type="button"
	class="inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold whitespace-nowrap transition disabled:opacity-60 {VARIANTES[variant]} {TAMANOS[size]} {clase}"
	{...rest}
>
	{@render children()}
</button>