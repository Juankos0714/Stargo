<script lang="ts">
	export interface SearchItem {
		id: string;
		label: string;
		detalle?: string;
	}

	let {
		items,
		value,
		onchange,
		placeholder = 'Buscar…',
		id,
		disabled = false
	}: {
		items: SearchItem[];
		value: string | null;
		onchange: (id: string | null) => void;
		placeholder?: string;
		id?: string;
		disabled?: boolean;
	} = $props();

	let query = $state('');
	let abierto = $state(false);
	let activo = $state(0);
	let root = $state<HTMLElement>();
	let prevValue: string | null = null;
	let inicializado = false;

	const seleccionado = $derived(items.find((i) => i.id === value) ?? null);

	const filtrados = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const base = q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
		return base.slice(0, 150);
	});

	// Sincronizar el input cuando el value cambia desde fuera.
	$effect(() => {
		if (!inicializado) {
			inicializado = true;
			prevValue = value;
			query = seleccionado?.label ?? '';
			return;
		}
		if (value !== prevValue) {
			prevValue = value;
			query = seleccionado?.label ?? '';
		}
	});

	// Cerrar al hacer clic fuera.
	$effect(() => {
		if (!abierto) return;
		const onDoc = (e: PointerEvent) => {
			if (root && !root.contains(e.target as Node)) abierto = false;
		};
		document.addEventListener('pointerdown', onDoc);
		return () => document.removeEventListener('pointerdown', onDoc);
	});

	function elegir(item: SearchItem) {
		query = item.label;
		abierto = false;
		onchange(item.id);
	}

	function limpiar() {
		query = '';
		abierto = false;
		onchange(null);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			abierto = true;
			activo = Math.min(activo + 1, filtrados.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			activo = Math.max(activo - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const it = filtrados[activo];
			if (it) elegir(it);
		} else if (e.key === 'Escape') {
			abierto = false;
		}
	}
</script>

<div class="relative" bind:this={root}>
	<div class="relative">
		<svg
			class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
			viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
		>
			<circle cx="11" cy="11" r="8" />
			<path d="m21 21-4.3-4.3" />
		</svg>
		<input
			{id}
			type="text"
			bind:value={query}
			placeholder={placeholder}
			{disabled}
			autocomplete="off"
			role="combobox"
			aria-expanded={abierto}
			aria-controls={id ? `${id}-list` : undefined}
			onfocus={() => (abierto = true)}
			oninput={() => {
				abierto = true;
				activo = 0;
			}}
			onkeydown={onKeydown}
			class="w-full rounded-xl border border-slate-300 bg-white min-h-11 py-2.5 pr-9 pl-9 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100"
		/>
		{#if seleccionado}
			<button
				type="button"
				aria-label="Limpiar selección"
				onclick={limpiar}
				class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
			>
				<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					<path d="M18 6 6 18M6 6l12 12" />
				</svg>
			</button>
		{/if}
	</div>

	{#if abierto}
		<ul
			id={id ? `${id}-list` : undefined}
			role="listbox"
			class="absolute z-30 mt-1.5 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl shadow-slate-900/10"
		>
			{#if filtrados.length === 0}
				<li class="px-4 py-3 text-sm text-slate-500">Sin resultados</li>
			{:else}
				{#each filtrados as item, i (item.id)}
					<li
						role="option"
						aria-selected={item.id === value}
						class="cursor-pointer px-4 py-2 text-sm transition {i === activo ? 'bg-primary-light text-primary-dark' : 'text-slate-700 hover:bg-slate-50'}"
						onpointerdown={(e) => {
							e.preventDefault();
							elegir(item);
						}}
						onmouseenter={() => (activo = i)}
					>
						<div class="font-medium">{item.label}</div>
						{#if item.detalle}
							<div class="text-xs text-slate-400">{item.detalle}</div>
						{/if}
					</li>
				{/each}
			{/if}
		</ul>
	{/if}
</div>
