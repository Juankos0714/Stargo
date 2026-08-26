<script lang="ts">
	import { fly } from 'svelte/transition';
	import SearchSelect, { type SearchItem } from '$lib/components/SearchSelect.svelte';
	import { api } from '$lib/api';
	import Icon from '$lib/components/Icon.svelte';
	import { Check, TriangleAlert, CircleCheck, Clock, Truck, ShoppingCart, CreditCard, Landmark, FileText, HelpCircle } from 'lucide';
	import Logo from '$lib/components/Logo.svelte';
	import {
		etiquetaTipoRecargo,
		etiquetaTipoServicio,
		formatearPeso,
		type Barrio,
		type Recargo,
		type TipoServicio,
		type Zona
	} from '$lib/types';
	import { calcularRecargos } from '$lib/logic/recargos';
	import { validarPedido, type TipoDiligencia } from '$lib/logic/validacion';
	import { MATRIZ_RECARGOS } from '$lib/logic/matriz-recargos';
	import { calcularBaseSugerida } from '$lib/logic/base-necesaria';
	import { page } from '$app/state';
	import type { HorarioHoy } from '$lib/types';
	import { apiFetch } from '$lib/api';
	import { esCapacitor } from '$lib/push-capacitor';

	// El catálogo (barrios, zonas, recargos y horario de hoy) lo resuelve el
	// servidor (+page.server.ts): el formulario ya viene en el HTML inicial,
	// sin las 4 llamadas /api encadenadas que retrasaban el render en mobile.
	// En Capacitor (ssr: false), se cargan via API en el cliente.
	let { data } = $props();
	let horario = $state<HorarioHoy | null>(data?.horario ?? null);
	let barrios = $state<Barrio[]>(data?.barrios ?? []);
	let zonas = $state<Zona[]>(data?.zonas ?? []);
	let recargos = $state<Recargo[]>(data?.recargos ?? []);
	let cargando = $state(!data?.barrios);
	let errorCarga = $state<string | null>(data?.error ?? null);

	// En Capacitor, cargar catálogo via API.
	if (esCapacitor() && barrios.length === 0) {
		Promise.all([
			apiFetch('/api/barrios').then((r) => r.json().catch(() => ({ data: [] }))),
			apiFetch('/api/zonas').then((r) => r.json().catch(() => ({ data: [] }))),
			apiFetch('/api/recargos').then((r) => r.json().catch(() => ({ data: [] }))),
			apiFetch('/api/horario').then((r) => r.json().catch(() => ({ data: null })))
		]).then(([rB, rZ, rR, rH]) => {
			barrios = rB?.data ?? [];
			zonas = rZ?.data ?? [];
			recargos = rR?.data ?? [];
			horario = rH?.data ?? null;
			cargando = false;
		}).catch(() => {
			cargando = false;
			errorCarga = 'No se pudieron cargar los datos.';
		});
	}

	// ---------- Tipo de servicio (Fase 14) ----------
	let tipoServicio = $state<TipoServicio>('domicilio');
	// Opciones de tipo de servicio: cada una mapea a tipoServicio + tipoDiligencia.
	const TIPOS_SERVICIO_OPCIONES = [
		{
			valor: 'domicilio',
			label: 'Domicilio normal',
			desc: 'Recoger y entregar entre dos puntos.',
			icon: Truck,
			tipoServicio: 'domicilio' as TipoServicio,
			tipoDiligencia: ''
		},
		{
			valor: 'pago',
			label: 'Pago de factura o servicio',
			desc: 'Pagar un recibo o servicio en un punto de pago.',
			icon: CreditCard,
			tipoServicio: 'compra_diligencia' as TipoServicio,
			tipoDiligencia: 'pago'
		},
		{
			valor: 'banco',
			label: 'Pago bancario o corresponsal',
			desc: 'Consignar o pagar en el banco o corresponsal.',
			icon: Landmark,
			tipoServicio: 'compra_diligencia' as TipoServicio,
			tipoDiligencia: 'banco'
		},
		{
			valor: 'compra',
			label: 'Compra de productos',
			desc: 'Mercado, medicamentos, encargos en tiendas.',
			icon: ShoppingCart,
			tipoServicio: 'compra_diligencia' as TipoServicio,
			tipoDiligencia: 'compra'
		},
		{
			valor: 'tramite',
			label: 'Trámite o documento',
			desc: 'Radicar, reclamar o entregar papeles.',
			icon: FileText,
			tipoServicio: 'compra_diligencia' as TipoServicio,
			tipoDiligencia: 'tramite'
		},
		{
			valor: 'otro',
			label: 'Otra diligencia',
			desc: 'Cualquier otro encargo.',
			icon: HelpCircle,
			tipoServicio: 'compra_diligencia' as TipoServicio,
			tipoDiligencia: 'otro'
		}
	];
	let tipoDiligencia = $state('');
	let necesitaRecoger = $state<boolean | null>(null);

	// --- Campos específicos por tipo de diligencia ---
	let dilDescripcion = $state('');
	let dilValorFactura = $state('');
	let dilEntidad = $state('');
	let dilProductos = $state('');
	let dilCantidad = $state('');
	let dilPresupuesto = $state('');
	let dilTramite = $state('');
	let dilInstrucciones = $state('');
	let dilLugarTramite = $state('');
	let dilOtraDescripcion = $state('');

	// --- Peso y transferencia obligatorios (domicilio) ---
	let pesoKg = $state('');
	let transferencia = $state<'si' | 'no' | ''>('');
	let transferenciaMonto = $state('');

	let origen = $state<string | null>(null);
	let dirOrigen = $state('');
	let destino = $state<string | null>(null);
	let dirDestino = $state('');
	let observaciones = $state('');
	let recargosSel = $state<string[]>([]);
	let recargosConfirmadosNoAplica = $state(false);
	// Contacto del cliente (Fase 19): el celular es obligatorio y el nombre opcional.
	let nombreCliente = $state('');
	let telefono = $state('');
	// Base necesaria (Fase 21): efectivo que el domiciliario debe adelantar.
	let baseNecesaria = $state('');
	let errores = $state<Record<string, string>>({});

	let precio = $state<{ valor: number | null; meta: Record<string, unknown> } | null>(null);
	let calculando = $state(false);
	let calcId = 0;

	let confirmando = $state(false);
	let error = $state<string | null>(null);
	let creado = $state<{
		pedido_id: string;
		numero: string;
		tarifa_base: number;
		recargos?: { codigo: string; nombre: string; valor: number }[] | null;
		recargo_total?: number;
		total?: number | null;
		estado: string;
		zona_origen?: string | null;
		zona_destino?: string | null;
		tipo_servicio?: TipoServicio;
	} | null>(null);

	// En compra/diligencia el origen se pide solo si se debe recoger algo antes.
	const mostrarOrigen = $derived(tipoServicio === 'domicilio' || necesitaRecoger === true);
	const origenRequerido = $derived(tipoServicio === 'domicilio' || necesitaRecoger === true);

	// Decisión explícita de recargos: elegir alguno o marcar «No aplica».




	const itemsBarrios = $derived<SearchItem[]>(
		barrios.map((b) => ({
			id: b.id,
			label: b.nombre,
			detalle: zonas.find((z) => z.id === b.zona_id)?.nombre ?? 'Sin zona asignada'
		}))
	);

	const nombreZona = $derived.by(() => {
		const mapa = new Map(zonas.map((z) => [z.id, z.nombre]));
		return (id: string) => mapa.get(id) ?? id;
	});

	// ---------- Recargos (Fase 7 + 16) ----------
	// En un Domicilio normal los recargos de tipo «compra» no aplican (son de
	// compras/diligencias): se ocultan para simplificar el proceso. En
	// Compra/diligencia se ofrecen todos.
	// Filtra recargos activos con datos válidos: valor >= 0 y nombre no vacío.
	// Esto excluye registros de prueba o corruptos que hayan quedado en la BD
	// (la migración CHECK recargos_valor_no_negativo puede no haberse ejecutado).
	const recargosActivos = $derived(
		recargos
			.filter((r) => r.activo && r.valor >= 0 && r.nombre?.trim())
			.sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nombre.localeCompare(b.nombre, 'es'))
	);



	/** Textos de ayuda contextual bajo el selector de tipo de diligencia. */
	const AYUDA_DILIGENCIA: Record<string, string> = {
		pago: 'El pago que va a realizar el domiciliario se registra en el paso de datos, no como recargo.',
		banco: 'El monto y la entidad se registran en el paso de datos, no como recargo.',
		compra: 'El valor de la compra se registra en el paso de datos. El recargo por compra es obligatorio.',
		tramite: 'El trámite se describe en el paso de datos. Solo puedes agregar tiempo de espera o paradas.',
		otro: 'Describe la diligencia en el paso de datos y agrega los recargos que apliquen.'
	};

	// ---------- Recargos disponibles ----------
	// En domicilio: todos excepto tipo «compra».
	// En compra/diligencia: se usa la matriz para decidir visibles/obligatorios.
	const recargosDisponibles = $derived.by(() => {
		if (tipoServicio === 'domicilio') {
			return recargosActivos.filter((r) => r.tipo !== 'compra');
		}
		// Compra/diligencia: usar la matriz de visibilidad.
		const matriz = MATRIZ_RECARGOS[tipoDiligencia ?? ''];
		if (!matriz) return [];
		const visibles = new Set(matriz.visibles);
		return recargosActivos.filter((r) => visibles.has(r.tipo));
	});

	/** Recargos obligatorios para el tipo de diligencia actual. */
	const recargosObligatorios = $derived.by(() => {
		if (tipoServicio !== 'compra_diligencia' || !tipoDiligencia) return [];
		const matriz = MATRIZ_RECARGOS[tipoDiligencia];
		if (!matriz) return [];
		return matriz.obligatorios;
	});

	const grupos = $derived.by(() => {
		const m = new Map<string, Recargo[]>();
		for (const r of recargosDisponibles) {
			const arr = m.get(r.tipo) ?? [];
			arr.push(r);
			m.set(r.tipo, arr);
		}
		return [...m.entries()].map(([tipo, items]) => ({ tipo, label: etiquetaTipoRecargo(tipo), items }));
	});

	// Filtrar recargos que ya no son válidos al calcular.
	const recargosSelFiltrados = $derived.by(() => {
		if (tipoServicio !== 'compra_diligencia' || !tipoDiligencia) return recargosSel;
		const matriz = MATRIZ_RECARGOS[tipoDiligencia];
		if (!matriz) return [];
		const visibles = new Set(matriz.visibles);
		return recargosSel.filter((c) => {
			const rec = recargosActivos.find((r) => r.codigo === c);
			return rec && visibles.has(rec.tipo);
		});
	});

	// --- Recargos en tiempo real (independiente de recargosSel que solo llena al confirmar) ---
	const recargosTiempoReal = $derived.by(() => {
		const sel = new Set(recargosSelFiltrados);
		if (tipoServicio === 'domicilio') {
			// Peso: siempre seleccionar el recargo correcto
			const pesoRecargos = recargosActivos.filter((r) => r.tipo === 'peso');
			for (const pr of pesoRecargos) sel.delete(pr.codigo);
			const peso = Number(pesoKg) || 0;
			if (peso > 0) {
				let codigoPeso = 'sin_peso';
				if (peso > 60) codigoPeso = 'peso_mas_60kg';
				else if (peso > 40) codigoPeso = 'peso_mas_40kg';
				else if (peso > 20) codigoPeso = 'peso_mas_20kg';
				const rp = pesoRecargos.find((r) => r.codigo === codigoPeso);
				if (rp) sel.add(rp.codigo);
			}
			// Transferencia: seleccionar el recargo correcto
			const transferRecargos = recargosActivos.filter((r) => r.tipo === 'transferencia');
			for (const tr of transferRecargos) sel.delete(tr.codigo);
			if (transferencia === 'si' && transferenciaMonto) {
				const monto = Number(transferenciaMonto) || 0;
				if (monto > 0) {
					let codigoTransfer = '';
					if (monto > 1000000) codigoTransfer = 'transferencia_1m';
					else if (monto > 500000) codigoTransfer = 'transferencia_500k';
					else if (monto > 100000) codigoTransfer = 'transferencia_100k';
					if (codigoTransfer) {
						const rt = transferRecargos.find((r) => r.codigo === codigoTransfer);
						if (rt) sel.add(rt.codigo);
					}
				}
			}
		}
		return [...sel];
	});
	const calculoRecargos = $derived(calcularRecargos(recargosDisponibles, recargosTiempoReal));
	// Los valores de recargos vienen directamente de la BD (ya escalonados).
	const recargosAplicados = calculoRecargos.aplicados;
	const recargoTotal = $derived(recargosAplicados.reduce((s, r) => s + r.valor, 0));
	const precioDisponible = $derived(precio?.meta?.disponible === true && precio?.valor != null);
	// Con ruta completa (origen+destino) el estimado incluye la tarifa; sin
	// ella (compra/diligencia solo con destino) va solo el total de recargos.
	const totalEstimado = $derived(precioDisponible ? (precio?.valor ?? 0) + recargoTotal : recargoTotal);
	const tieneRutaCompleta = $derived(Boolean(origen && destino));
	// valor_mandado: dinero del cliente que el domiciliario adelanta (solo pago/banco).
	const valorMandadoNum = $derived(
		(tipoDiligencia === 'pago' || tipoDiligencia === 'banco') && String(dilValorFactura ?? '').trim()
			? Number(String(dilValorFactura ?? '')) || 0
			: 0
	);

	// El botón se habilita con la tarifa disponible (domicilio) o con destino
	// (compra/diligencia); la validación de campos se dispara al confirmar
	// y muestra errores por campo.
	const puedeConfirmar = $derived(
		!confirmando &&
			(tipoServicio === 'domicilio'
				? precioDisponible
				: Boolean(destino))
	);

	function validar(): boolean {
		errores = validarPedido({
			barrioOrigen: origenRequerido ? origen : null,
			barrioDestino: destino,
			direccionOrigen: origenRequerido ? dirOrigen : '',
			direccionDestino: dirDestino,
			observaciones,
			recargos: recargosSel,
			tipoServicio,
			recargosConfirmadosNoAplica,
			telefono,
			nombreCliente,
			tipoDiligencia: tipoDiligencia as TipoDiligencia,
			dilDescripcion,
			dilValorFactura,
				dilEntidad,
			dilProductos,
			dilCantidad,
			dilPresupuesto,
			dilTramite,
			dilInstrucciones,
			dilLugarTramite,
			dilOtraDescripcion,
			peso: pesoKg,
			transferencia,
			transferenciaMonto
		});
		return Object.keys(errores).length === 0;
	}

	async function calcular() {
		// En compra/diligencia solo se necesita destino (origen es opcional).
		if (!destino) return;
		if (tipoServicio === 'domicilio' && !origen) return;
		const id = ++calcId;
		calculando = true;

		// Construir payload según el tipo de servicio.
		// Para compra/diligencia sin origen, usar el destino como origen
		// (el domiciliario parte del destino o zona cercana).
		const payload: Record<string, unknown> = {
			barrio_origen: tipoServicio === 'compra_diligencia' ? (origen ?? destino) : origen,
			barrio_destino: destino
		};

		// Para compra/diligencia, enviar tipo_diligencia y datos adicionales.
		if (tipoServicio === 'compra_diligencia' && tipoDiligencia) {
			payload.tipo_diligencia = tipoDiligencia;
			payload.subtipo_pago = tipoDiligencia === 'banco' ? 'bancario' : tipoDiligencia === 'pago' ? 'corresponsal' : undefined;

			// Si necesita recoger en otro punto, enviar como tramo adicional.
			if (necesitaRecoger && origen) {
				payload.tramos_adicionales = [{
					origen: origen,
					destino: destino
				}];
			}

			// Enviar recargos seleccionados con sus valores.
			payload.recargos = recargosSelFiltrados.map((codigo) => {
				const rec = recargosActivos.find((r) => r.codigo === codigo);
				return rec ? { id: rec.tipo } : { id: codigo };
			});

			// Peso y monto de pago para recargos escalonados.
			if (pesoKg) payload.peso_kg = Number(pesoKg);
			if (dilValorFactura) payload.monto_pago = Number(dilValorFactura);
		} else {		// Domicilio: incluir peso y monto de transferencia para recargo escalonado.
				if (pesoKg) payload.peso_kg = Number(pesoKg);
				if (transferencia === 'si' && transferenciaMonto) {
					payload.monto_pago = Number(transferenciaMonto);
				}
				payload.recargos = recargosSelFiltrados.map((codigo) => {
					const rec = recargosActivos.find((r) => r.codigo === codigo);
					return rec ? { id: rec.tipo } : { id: codigo };
				});
		}

		// El endpoint responde { data: <número>, meta: {...} }
		const r = await api.post<number>('/api/calcular_tarifa', payload);
		if (id !== calcId) return;
		calculando = false;
		if (r.error) {
			precio = null;
			error = r.error;
			return;
		}
		precio = { valor: r.data, meta: r.meta ?? {} };
		error = null;
	}

	function limpiarCamposDiligencia() {
		tipoDiligencia = '';
		necesitaRecoger = null;
		dilDescripcion = '';
		dilValorFactura = '';
		dilEntidad = '';
		dilProductos = '';
		dilCantidad = '';
		dilPresupuesto = '';
		dilTramite = '';
		dilInstrucciones = '';
		dilLugarTramite = '';
		dilOtraDescripcion = '';
		pesoKg = '';
		transferencia = '';
		transferenciaMonto = '';
	}
	/** Selecciona un tipo de servicio desde las opciones del paso 0. */
	function elegirTipoOpcion(valor: string) {
		const opcion = TIPOS_SERVICIO_OPCIONES.find((o) => o.valor === valor);
		if (!opcion) return;

		tipoServicio = opcion.tipoServicio;
		tipoDiligencia = opcion.tipoDiligencia;

		// Limpiar precio y errores.
		precio = null;
		error = null;

		// Si es domicilio, limpiar campos de diligencia.
		if (tipoServicio === 'domicilio') {
			limpiarCamposDiligencia();
		}
		// Si es compra/diligencia sin origen, limpiar origen.
		if (tipoServicio === 'compra_diligencia' && !mostrarOrigen) {
			origen = null;
				dirOrigen = '';
			}

		// Limpiar recargos que ya no aplican.
		if (tipoServicio === 'domicilio') {
			const codigosCompra = new Set(
				recargosActivos.filter((r) => r.tipo === 'compra').map((r) => r.codigo)
			);
			recargosSel = recargosSel.filter((c) => !codigosCompra.has(c));
		} else {
			const matriz = MATRIZ_RECARGOS[tipoDiligencia ?? ''];
			if (matriz) {
				const ocultos = new Set(matriz.ocultos);
				recargosSel = recargosSel.filter((c) => {
					const rec = recargosActivos.find((r) => r.codigo === c);
					return rec && !ocultos.has(rec.tipo);
				});
			}
		}
		errores = {};
	}

	/** Empaqueta los datos de la diligencia en observaciones como texto estructurado. */
	function empaquetarObservaciones(): string {
		const parts: string[] = [];
		if (tipoServicio === 'compra_diligencia' && tipoDiligencia) {
			parts.push(`[DILIGENCIA: ${TIPOS_SERVICIO_OPCIONES.find((t) => t.valor === tipoDiligencia)?.label ?? tipoDiligencia}]`);
		}
		if (dilDescripcion.trim()) parts.push(`Descripción: ${dilDescripcion.trim()}`);
		if (dilEntidad.trim()) parts.push(`Entidad: ${dilEntidad.trim()}`);
		if (String(dilValorFactura ?? '').trim()) parts.push(`Valor a pagar: $${String(dilValorFactura ?? '')}`);
		if (dilProductos.trim()) parts.push(`Productos: ${dilProductos.trim()}`);
		if (dilCantidad.trim()) parts.push(`Cantidad: ${dilCantidad.trim()}`);
		if (String(dilPresupuesto ?? '').trim()) parts.push(`Presupuesto: $${String(dilPresupuesto ?? '')}`);
		if (dilTramite.trim()) parts.push(`Trámite: ${dilTramite.trim()}`);
		if (dilInstrucciones.trim()) parts.push(`Instrucciones: ${dilInstrucciones.trim()}`);
		if (dilLugarTramite.trim()) parts.push(`Lugar: ${dilLugarTramite.trim()}`);
		if (dilOtraDescripcion.trim()) parts.push(`Detalle: ${dilOtraDescripcion.trim()}`);
		// Agregar observaciones libres del usuario si existen.
		if (observaciones.trim()) parts.push(observaciones.trim());
		return parts.join('\n');
	}

	function sincronizarRecargos() {
		// Sincronizar peso y transferencia con recargosSel
		// La BD tiene múltiples recargos de peso/transferencia, cada uno con un rango.
		// Seleccionamos el correcto según el peso/monto del cliente.
		
		// --- Peso: seleccionar el recargo correcto ---
		const pesoRecargos = recargosActivos.filter((r) => r.tipo === 'peso');
		// Eliminar todos los recargos de peso de la selección actual
		recargosSel = recargosSel.filter((c) => !pesoRecargos.some((r) => r.codigo === c));
		
		const peso = Number(pesoKg) || 0;
		if (peso > 0) {
			// Seleccionar el recargo de peso correcto según el rango
			let codigoPeso = 'sin_peso'; // Default: 0-15kg
			if (peso > 60) codigoPeso = 'peso_mas_60kg';
			else if (peso > 40) codigoPeso = 'peso_mas_40kg';
			else if (peso > 20) codigoPeso = 'peso_mas_20kg';
			else codigoPeso = 'sin_peso';
			
			const recargoPeso = pesoRecargos.find((r) => r.codigo === codigoPeso);
			if (recargoPeso) recargosSel = [...recargosSel, recargoPeso.codigo];
		}
		
		// --- Transferencia: seleccionar el recargo correcto ---
		const transferRecargos = recargosActivos.filter((r) => r.tipo === 'transferencia');
		// Eliminar todos los recargos de transferencia de la selección actual
		recargosSel = recargosSel.filter((c) => !transferRecargos.some((r) => r.codigo === c));
		
		if (transferencia === 'si' && transferenciaMonto) {
			const monto = Number(transferenciaMonto) || 0;
			if (monto > 0) {
				// Seleccionar el recargo de transferencia correcto según el monto
				let codigoTransfer = '';
				if (monto > 1000000) codigoTransfer = 'transferencia_1m';
				else if (monto > 500000) codigoTransfer = 'transferencia_500k';
				else if (monto > 100000) codigoTransfer = 'transferencia_100k';
				// Si monto <= 100000, no se agrega recargo
				
				if (codigoTransfer) {
					const recargoTransfer = transferRecargos.find((r) => r.codigo === codigoTransfer);
					if (recargoTransfer) recargosSel = [...recargosSel, recargoTransfer.codigo];
				}
			}
		}
	}

	async function confirmar(e: SubmitEvent) {
		e.preventDefault();
		if (!puedeConfirmar) return;
		sincronizarRecargos();
		if (!validar()) return;
		confirmando = true;
		error = null;
		const obs = empaquetarObservaciones();
		// valor_mandado: solo para pago/banco cuando hay valor de factura.
		const valorMandado = (tipoDiligencia === 'pago' || tipoDiligencia === 'banco') && String(dilValorFactura ?? '').trim()
			? Math.round(Number(String(dilValorFactura ?? '')))
			: undefined;
		const payloadPedido: Record<string, unknown> = {
			barrio_origen: origen,
			direccion_origen: dirOrigen,
			barrio_destino: destino,
			direccion_destino: dirDestino,
			observaciones: obs || undefined,
			tipo_servicio: tipoServicio,
			tipo_diligencia: tipoDiligencia || undefined,
			recargos: recargosSel,
			recargos_confirmados_no_aplica: recargosConfirmadosNoAplica,
			nombre_cliente: nombreCliente.trim() || undefined,
			telefono: telefono.trim(),
			base_necesaria: baseNecesaria.trim() ? Number(baseNecesaria.trim()) : undefined,
			valor_mandado: valorMandado
		};
		// Domicilio: incluir peso y monto de transferencia para cálculo de recargos.
		if (tipoServicio === 'domicilio') {
			if (pesoKg) payloadPedido.peso_kg = Number(pesoKg);
			if (transferencia === 'si' && transferenciaMonto) {
				payloadPedido.monto_pago = Number(transferenciaMonto);
			}
		}
		const r = await api.post<typeof creado>('/api/pedidos', payloadPedido);
		confirmando = false;
		if (r.error) {
			error = r.error;
			return;
		}
		creado = r.data;
	}

	function reiniciar() {
		creado = null;
		tipoServicio = 'domicilio';
		limpiarCamposDiligencia();
		origen = null;
		destino = null;
		dirOrigen = '';
		dirDestino = '';
		observaciones = '';
		recargosSel = [];
		recargosConfirmadosNoAplica = false;
		nombreCliente = '';
		telefono = '';
		baseNecesaria = '';
		errores = {};
		precio = null;
		error = null;
	}

	// Deep-link desde la calculadora: /nuevo-pedido?origen=<id>&destino=<id>
	// preselecciona los barrios apenas se cargan (y la tarifa se calcula sola).
	let deepLinkAplicado = $state(false);
	$effect(() => {
		if (cargando || barrios.length === 0 || deepLinkAplicado) return;
		deepLinkAplicado = true;
		const q = page.url.searchParams;
		const o = q.get('origen');
		const d = q.get('destino');
		const existe = (id: string | null) => id !== null && barrios.some((b) => b.id === id);
		if (existe(o)) origen = o;
		if (existe(d)) destino = d;
	});

	$effect(() => {
		// Recalcular cuando cambian origen/destino (domicilio) o parámetros de compra/diligencia.
		if (tipoServicio === 'domicilio') {
			// eslint-disable-next-line @typescript-eslint/no-unused-expressions
			origen; destino; pesoKg; transferencia; transferenciaMonto;
			if (origen && destino) calcular();
		} else {
			// En compra/diligencia: recalcular al cambiar tipo, peso, monto, transferencia, recargos.
			// eslint-disable-next-line @typescript-eslint/no-unused-expressions
			tipoDiligencia; pesoKg; dilValorFactura; transferencia; transferenciaMonto; recargosSelFiltrados;
			if (destino) calcular();
		}
	});

	// Auto-seleccionar recargos obligatorios al cambiar tipo de diligencia.
	$effect(() => {
		if (tipoServicio !== 'compra_diligencia' || !tipoDiligencia) return;
		const matriz = MATRIZ_RECARGOS[tipoDiligencia];
		if (!matriz?.obligatorios?.length) return;
		for (const tipo of matriz.obligatorios) {
			const rec = recargosActivos.find((r) => r.tipo === tipo);
			if (rec && !recargosSel.includes(rec.codigo)) {
				recargosSel = [...recargosSel, rec.codigo];
			}
		}
	});



	// Refrescar horario inmediatamente y cada 30 s para detectar
	// excepciones nuevas que el admin haya creado (p. ej. ampliar el horario de hoy).
	$effect(() => {
		async function refrescarHorario() {
			try {
				const r = await apiFetch('/api/horario');
				const body = await r.json().catch(() => ({}));
				if (body?.data) horario = body.data;
			} catch {
				// Silenciar errores de red en polling
			}
		}
		// Refresco inmediato al montar (captura excepciones creadas
		// después del render inicial del servidor).
		refrescarHorario();
		const interval = setInterval(refrescarHorario, 30_000);
		return () => clearInterval(interval);
	});
</script>

<svelte:head>
	<title>Nuevo pedido — StarGo</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-b from-slate-50 via-primary-light/40 to-slate-50">
	<header class="border-b border-slate-200/70 bg-white/80 backdrop-blur">
		<div class="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
			<a href="/" class="flex items-center">
				<Logo type="full" surface="light" height={32} priority />
			</a>
			<nav class="flex items-center gap-3 text-sm">
				<a href="/consultar-estado" class="font-medium text-slate-500 transition hover:text-primary">Consultar estado</a>
			</nav>
		</div>
	</header>

	<main class="mx-auto max-w-3xl px-6 py-12">
		{#if creado}
			<!-- Confirmación -->
			<div class="mx-auto max-w-lg rounded-2xl border border-success/30 bg-white p-8 text-center shadow-lg">
				<div class="mx-auto flex size-16 items-center justify-center rounded-full bg-success text-white shadow-lg shadow-slate-900/10">
					<Icon icon={Check} class="size-8" />
				</div>
				<h1 class="mt-5 text-2xl font-extrabold tracking-tight text-slate-900">¡Pedido confirmado!</h1>
				<p class="mt-2 text-sm text-slate-500">Guarda tu código para consultar el estado del pedido:</p>
				<p
					data-testid="codigo-pedido"
					class="mt-4 inline-block rounded-xl border-2 border-dashed border-success bg-green-50 px-6 py-3 font-mono text-3xl font-black tracking-widest text-green-700"
				>
					{creado.numero}
				</p>
				<div class="mt-6 space-y-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
					<p class="flex justify-between">
						<span>Tipo de servicio</span>
						<span class="inline-flex rounded-full border border-primary/30 bg-primary-light px-2.5 py-0.5 text-xs font-semibold text-primary-dark">
							{etiquetaTipoServicio(creado.tipo_servicio)}
						</span>
					</p>
					<p class="flex justify-between">
						<span>{creado.tipo_servicio === 'compra_diligencia' && creado.tarifa_base === 0 ? 'Tarifa (la confirma el domiciliario)' : 'Tarifa base'}</span>
						<span class="font-bold text-slate-900">{formatearPeso(creado.tarifa_base)}</span>
					</p>
					{#each creado.recargos ?? [] as r (r.codigo)}
						<p class="flex justify-between">
							<span class="text-left">{r.nombre}</span>
							<span class="font-semibold text-slate-800">{formatearPeso(r.valor)}</span>
						</p>
					{/each}
					<p class="flex justify-between border-t border-slate-200 pt-2">
						<span class="font-semibold">Total</span>
						<span class="font-extrabold text-slate-900">
							{formatearPeso(creado.total ?? (creado.tarifa_base + (creado.recargo_total ?? 0)))}
						</span>
					</p>
					<p class="flex justify-between">
						<span>Estado</span>
						<span class="inline-flex rounded-full border border-amber-200 bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Pendiente</span>
					</p>
				</div>
				<p class="mt-4 flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-xs text-amber-800">
					<Icon icon={TriangleAlert} class="mt-0.5 size-3.5 shrink-0" />
					<span>Este valor es un estimado: el precio final lo confirma el domiciliario según el servicio que realmente realice.</span>
				</p>
				<div class="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
					<a
						href="/consultar-estado?numero={creado.numero}"
						class="rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-dark"
					>
						Consultar estado
					</a>
					<button
						type="button"
						onclick={reiniciar}
						class="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
					>
						Crear otro pedido
					</button>
				</div>
			</div>
		{:else}
			<div class="text-center">
				<h1 class="text-3xl font-extrabold tracking-tight text-slate-900">Hacer un pedido</h1>
				<p class="mt-2 text-slate-500">La tarifa se calcula automáticamente al seleccionar los barrios.</p>
				{#if horario?.abierto}
					<p class="mt-2 inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-green-700">
						<Icon icon={CircleCheck} class="size-3.5" />
						Atendemos hoy hasta las {horario.cierre}
					</p>
				{/if}
			</div>

			{#if horario && !horario.abierto}
				<!-- Fuera de horario: la app no recibe pedidos nuevos -->
				<div class="mx-auto mt-10 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center shadow-sm">
					<div class="mx-auto flex size-14 items-center justify-center rounded-full bg-amber-100 text-amber-600">
						<Icon icon={Clock} class="size-7" />
					</div>
					<h2 class="mt-4 text-xl font-extrabold text-slate-900">Estamos fuera de horario de atención</h2>
					<p class="mt-2 text-sm text-slate-600">
						No se están recibiendo pedidos nuevos en este momento
						{#if horario.fuente === 'excepcion' && horario.motivo} ({horario.motivo}){/if}.
					</p>
					<p class="mt-3 text-sm text-slate-600">
						Horario de hoy: <strong>{horario.apertura} – {horario.cierre}</strong>. Vuelve a intentarlo dentro de ese
						rango o consulta el estado de un pedido ya creado.
					</p>
					<a
						href="/consultar-estado"
						class="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-dark"
					>
						Consultar estado de mi pedido
					</a>
				</div>
			{:else if cargando}
				<div class="mt-10 flex items-center justify-center gap-3 py-16 text-slate-500">
					<span class="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
					Cargando barrios…
				</div>
			{:else if errorCarga}
				<div class="mt-10 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
					No se pudieron cargar los barrios: {errorCarga}
				</div>
			{:else}
				<form class="mt-8 space-y-6" onsubmit={confirmar} novalidate>					<!-- Paso 0: tipo de servicio (Fase 14) -->
					<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
						<h2 class="mb-1 flex items-center gap-2 text-sm font-bold tracking-wide text-slate-500 uppercase">
							<span class="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">0</span>
							¿Qué necesitas?
						</h2>
						<div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{#each TIPOS_SERVICIO_OPCIONES as opcion (opcion.valor)}
								{@const seleccionado = tipoServicio === opcion.tipoServicio && (opcion.tipoServicio === 'domicilio' ? tipoDiligencia === '' : tipoDiligencia === opcion.tipoDiligencia)}
								<button
									type="button"
									onclick={() => elegirTipoOpcion(opcion.valor)}
									class="rounded-xl border-2 p-4 text-left transition {seleccionado
										? 'border-primary bg-primary-light/40 shadow-sm'
										: 'border-slate-200 hover:border-primary/50'}"
								>
									<span class="flex items-center gap-2 text-sm font-bold text-slate-900">
										<Icon icon={opcion.icon} class="size-4 text-primary" />
										{opcion.label}
									</span>
									<span class="mt-1 block text-xs text-slate-500">{opcion.desc}</span>
								</button>
							{/each}
						</div>

						{#if tipoDiligencia && AYUDA_DILIGENCIA[tipoDiligencia]}
							<p class="mt-3 flex items-start gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary-dark">
								<span class="shrink-0">💡</span>
								<span>{AYUDA_DILIGENCIA[tipoDiligencia]}</span>
							</p>
						{/if}

						<!-- Pregunta de recogida: aplica para compra/diligencia -->
						{#if tipoServicio === 'compra_diligencia' && tipoDiligencia}
							<fieldset class="mt-4">
								<legend class="text-sm font-semibold text-slate-800">¿Se debe recoger algo o a alguien antes?</legend>
								<div class="mt-2 flex gap-2">
									<button
										type="button"
										onclick={() => { necesitaRecoger = true; error = null; }}
										class="rounded-xl border-2 px-4 py-2 text-sm font-semibold transition {necesitaRecoger === true ? 'border-primary bg-primary-light text-primary-dark' : 'border-slate-200 text-slate-600 hover:border-primary/50'}"
									>
										Sí, hay recogida
									</button>
									<button
										type="button"
										onclick={() => {
											necesitaRecoger = false;
											origen = null;
											dirOrigen = '';
											errores.origen = '';
											errores.dirOrigen = '';
											error = null;
										}}
										class="rounded-xl border-2 px-4 py-2 text-sm font-semibold transition {necesitaRecoger === false ? 'border-primary bg-primary-light text-primary-dark' : 'border-slate-200 text-slate-600 hover:border-primary/50'}"
									>
										No, solo el destino
									</button>
									</div>
								</fieldset>
						{/if}
					</div>

							<!-- Campos específicos por tipo de diligencia -->
							{#if tipoDiligencia}
								<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
									<h2 class="mb-1 flex items-center gap-2 text-sm font-bold tracking-wide text-slate-500 uppercase">
										<span class="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">A</span>
										Datos de la diligencia
									</h2>
									<p class="mb-4 ml-7 text-xs text-slate-400">
										{TIPOS_SERVICIO_OPCIONES.find((t) => t.valor === tipoDiligencia)?.label ?? ''}
									</p>

									<!-- Pago de factura o servicio -->
									{#if tipoDiligencia === 'pago'}
										<div class="space-y-4">
											<div>
												<label for="dil-desc" class="mb-1.5 block text-sm font-semibold text-slate-700">Descripción <span class="text-amber-600">(obligatorio)</span></label>
												<input
													id="dil-desc"
													type="text"
													bind:value={dilDescripcion}
													maxlength="300"												placeholder="Ej: Pago de factura de luz, recibo de agua…"
												class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.dilDescripcion ? 'border-red-400' : ''}"
													/>
													{#if errores.dilDescripcion}<p class="mt-1 text-xs text-red-600">{errores.dilDescripcion}</p>{/if}						</div>
					<div class="grid gap-4 sm:grid-cols-2">
												<div>
													<label for="dil-valor-pagar" class="mb-1.5 block text-sm font-semibold text-slate-700">Valor de la factura <span class="text-amber-600">(obligatorio)</span></label>
													<div class="relative">
														<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>															<input
																id="dil-valor-pagar"
																type="text"
																inputmode="numeric"
																pattern="[0-9]*"
																bind:value={dilValorFactura}
																placeholder="Ej: 85000"
														class="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.dilValorFactura ? 'border-red-400' : ''}"
														/>														{#if errores.dilValorFactura}<p class="mt-1 text-xs text-red-600">{errores.dilValorFactura}</p>{/if}
													</div>
												</div>
											</div>
										</div>

									<!-- Pago bancario o corresponsal -->
									{:else if tipoDiligencia === 'banco'}
										<div class="space-y-4">
											<div>
												<label for="dil-entidad" class="mb-1.5 block text-sm font-semibold text-slate-700">Entidad / banco <span class="text-amber-600">(obligatorio)</span></label>
												<input
													id="dil-entidad"
													type="text"
													bind:value={dilEntidad}
													maxlength="200"
													placeholder="Ej: Bancolombia, Daviplata, Efecty…"
													class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.dilEntidad ? 'border-red-400' : ''}"
												/>
													{#if errores.dilEntidad}<p class="mt-1 text-xs text-red-600">{errores.dilEntidad}</p>{/if}						</div>
					<div>
												<label for="dil-desc-banco" class="mb-1.5 block text-sm font-semibold text-slate-700">Descripción del pago <span class="text-amber-600">(obligatorio)</span></label>
												<input
													id="dil-desc-banco"
													type="text"
													bind:value={dilDescripcion}
													maxlength="300"														placeholder="Ej: Consignación, pago de cuota…"
														class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.dilDescripcion ? 'border-red-400' : ''}"
													/>
													{#if errores.dilDescripcion}<p class="mt-1 text-xs text-red-600">{errores.dilDescripcion}</p>{/if}						</div>
					<div class="grid gap-4 sm:grid-cols-2">
												<div>
													<label for="dil-valor-pagar" class="mb-1.5 block text-sm font-semibold text-slate-700">Valor a pagar <span class="text-amber-600">(obligatorio)</span></label>
													<div class="relative">
														<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>															<input
																id="dil-valor-pagar"
																type="text"
																inputmode="numeric"
																pattern="[0-9]*"
																bind:value={dilValorFactura}
																placeholder="Ej: 150000"
															class="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.dilValorFactura ? 'border-red-400' : ''}"
														/>
														{#if errores.dilValorFactura}<p class="mt-1 text-xs text-red-600">{errores.dilValorFactura}</p>{/if}														</div>						</div>
											</div>
										</div>

									<!-- Compra de productos -->
									{:else if tipoDiligencia === 'compra'}
										<div class="space-y-4">
											<div>
												<label for="dil-productos" class="mb-1.5 block text-sm font-semibold text-slate-700">Productos / descripción <span class="text-amber-600">(obligatorio)</span></label>
												<textarea
													id="dil-productos"
													bind:value={dilProductos}
													rows="3"
													maxlength="500"
													placeholder="Ej: 2 paquetes de arroz, 1 leche, 1 medicamento X"
													class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.dilProductos ? 'border-red-400' : ''}"
												></textarea>
													{#if errores.dilProductos}<p class="mt-1 text-xs text-red-600">{errores.dilProductos}</p>{/if}						</div>
					<div>
												<label for="dil-cantidad" class="mb-1.5 block text-sm font-semibold text-slate-700">Cantidad</label>
												<input
													id="dil-cantidad"
													type="text"
													bind:value={dilCantidad}														maxlength="100"
														placeholder="Ej: 3 artículos, 1 paquete…"
													class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11"
													/>						</div>
					<div class="grid gap-4 sm:grid-cols-2">
												<div>
													<label for="dil-presupuesto" class="mb-1.5 block text-sm font-semibold text-slate-700">Presupuesto / valor estimado</label>
													<div class="relative">
														<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>															<input
																id="dil-presupuesto"
																type="text"
																inputmode="numeric"
																pattern="[0-9]*"
																bind:value={dilPresupuesto}
																placeholder="Ej: 50000"
															class="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11"
														/>
													</div>						</div>
											</div>
										</div>

									<!-- Trámite o documento -->
									{:else if tipoDiligencia === 'tramite'}
										<div class="space-y-4">
											<div>
												<label for="dil-tramite" class="mb-1.5 block text-sm font-semibold text-slate-700">¿Qué trámite necesitas? <span class="text-amber-600">(obligatorio)</span></label>
												<input
													id="dil-tramite"
													type="text"
													bind:value={dilTramite}
													maxlength="300"
													placeholder="Ej: Radicar documento, recoger certificado…"
													class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.dilTramite ? 'border-red-400' : ''}"
												/>
													{#if errores.dilTramite}<p class="mt-1 text-xs text-red-600">{errores.dilTramite}</p>{/if}						</div>
					<div>
												<label for="dil-instrucciones" class="mb-1.5 block text-sm font-semibold text-slate-700">Descripción / instrucciones <span class="text-amber-600">(obligatorio)</span></label>
												<textarea
													id="dil-instrucciones"
													bind:value={dilInstrucciones}
													rows="3"
													maxlength="500"
													placeholder="Detalla qué debe hacer el domiciliario, qué documentos llevar, etc."
													class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.dilInstrucciones ? 'border-red-400' : ''}"
												></textarea>
													{#if errores.dilInstrucciones}<p class="mt-1 text-xs text-red-600">{errores.dilInstrucciones}</p>{/if}						</div>
					<div class="grid gap-4 sm:grid-cols-2">
												<div>
													<label for="dil-lugar" class="mb-1.5 block text-sm font-semibold text-slate-700">Lugar del trámite</label>
													<input
														id="dil-lugar"
														type="text"
														bind:value={dilLugarTramite}
														maxlength="200"
														placeholder="Ej: Alcaldía, notaría, etc."
														class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11"
													/>						</div>
											</div>
										</div>

									<!-- Otra diligencia -->
									{:else if tipoDiligencia === 'otro'}
										<div class="space-y-4">
											<div>
												<label for="dil-otra" class="mb-1.5 block text-sm font-semibold text-slate-700">Describe la diligencia <span class="text-amber-600">(obligatorio)</span></label>
												<textarea
													id="dil-otra"
													bind:value={dilOtraDescripcion}
													rows="3"
													maxlength="500"
													placeholder="Describe con detalle qué necesitas que haga el domiciliario."
													class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.dilOtraDescripcion ? 'border-red-400' : ''}"
												></textarea>
													{#if errores.dilOtraDescripcion}<p class="mt-1 text-xs text-red-600">{errores.dilOtraDescripcion}</p>{/if}						</div>
					<div>
												<label for="dil-instrucciones" class="mb-1.5 block text-sm font-semibold text-slate-700">Instrucciones adicionales</label>
												<textarea
													id="dil-instrucciones"
													bind:value={dilInstrucciones}
													rows="2"
													maxlength="500"
													placeholder="Detalles extra, horarios, referencias, etc."
													class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11"													></textarea>						</div>
										</div>
										{/if}
								</div>
							{/if}

					{#if mostrarOrigen}
					<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
						<h2 class="mb-4 flex items-center gap-2 text-sm font-bold tracking-wide text-slate-500 uppercase">
							<span class="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">1</span>
							{#if tipoServicio === 'compra_diligencia'}Recogida{:else}Origen{/if}
						</h2>
						<div class="grid gap-4 sm:grid-cols-2">								<div>
									<label for="ped-origen" class="mb-1.5 block text-sm font-semibold text-slate-700">
										{#if tipoServicio === 'compra_diligencia'}Barrio de recogida{:else}Barrio de origen{/if}
									</label>
									<SearchSelect
										id="ped-origen"
										items={itemsBarrios}
										value={origen}
										onchange={(id) => (origen = id)}
										placeholder="Ej: Barrio La Rivera…"
									/>
								{#if errores.origen}
									<p class="mt-1 text-xs text-red-600">{errores.origen}</p>
								{/if}
							</div>
									<div>
										<label for="dir-origen" class="mb-1.5 block text-sm font-semibold text-slate-700">Dirección</label>
										<input
											id="dir-origen"
											type="text"
											bind:value={dirOrigen}
											maxlength="300"
											placeholder="Calle 10 # 15-20, Apto 301"
											class="w-full rounded-xl border px-4 py-2.5 text-sm shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 bg-white text-slate-900 {errores.dirOrigen ? 'border-red-400' : 'border-slate-300'}"
										/>
										{#if errores.dirOrigen}
											<p class="mt-1 text-xs text-red-600">{errores.dirOrigen}</p>
										{/if}
									</div>
								</div>
						</div>
					{/if}

					<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
						<h2 class="mb-4 flex items-center gap-2 text-sm font-bold tracking-wide text-slate-500 uppercase">
							<span class="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">2</span>
							Destino
						</h2>
						<div class="grid gap-4 sm:grid-cols-2">
							<div>
								<label for="ped-destino" class="mb-1.5 block text-sm font-semibold text-slate-700">Barrio de destino</label>
								<SearchSelect
									id="ped-destino"
									items={itemsBarrios}
									value={destino}
									onchange={(id) => (destino = id)}
									placeholder="Ej: Mall Privilegio…"
								/>
								{#if errores.destino}
									<p class="mt-1 text-xs text-red-600">{errores.destino}</p>
								{/if}
							</div>
							<div>
								<label for="dir-destino" class="mb-1.5 block text-sm font-semibold text-slate-700">Dirección</label>
								<input
									id="dir-destino"
									type="text"
									bind:value={dirDestino}
									maxlength="300"
									placeholder="Carrera 19 # 20-30"
									class="w-full rounded-xl border px-4 py-2.5 text-sm shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 bg-white text-slate-900 {errores.dirDestino ? 'border-red-400' : 'border-slate-300'}"
								/>
								{#if errores.dirDestino}
									<p class="mt-1 text-xs text-red-600">{errores.dirDestino}</p>
								{/if}
							</div>
						</div>
					</div>					{#if tipoServicio === 'domicilio'}
					<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
						<h2 class="mb-1 flex items-center gap-2 text-sm font-bold tracking-wide text-slate-500 uppercase">
							<span class="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">3</span>
							Detalles del pedido
						</h2>
						<p class="mb-4 ml-7 text-xs text-slate-400">
							Indica el peso y si aplica transferencia.
						</p>
							<!-- Campo obligatorio: peso -->
							<div class="mb-4">
								<label for="domicilio-peso" class="mb-1.5 block text-sm font-semibold text-slate-700">Peso del paquete <span class="text-amber-600">(obligatorio)</span></label>
								<div class="relative">										<input
											id="domicilio-peso"
											type="text"
											inputmode="decimal"
											bind:value={pesoKg}
											placeholder="Ej: 2.5"
										oninput={() => sincronizarRecargos()}
										class="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.peso ? 'border-red-400' : ''}"
									/>
									<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">kg</span>
								</div>
								{#if errores.peso}<p class="mt-1 text-xs text-red-600">{errores.peso}</p>{/if}
							</div>

							<!-- Campo obligatorio: transferencia -->
							<div class="mb-4">
								<label class="mb-1.5 block text-sm font-semibold text-slate-700">Transferencia bancaria <span class="text-amber-600">(obligatorio)</span></label>
								<div class="flex gap-2">
									<button
										type="button"
										onclick={() => { transferencia = 'si'; error = null; sincronizarRecargos(); }}
										class="rounded-xl border-2 px-4 py-2 text-sm font-semibold transition {transferencia === 'si' ? 'border-primary bg-primary-light text-primary-dark' : 'border-slate-200 text-slate-600 hover:border-primary/50'}"
									>
										Sí, hay transferencia
									</button>
									<button
										type="button"
										onclick={() => { transferencia = 'no'; transferenciaMonto = ''; error = null; sincronizarRecargos(); }}
										class="rounded-xl border-2 px-4 py-2 text-sm font-semibold transition {transferencia === 'no' ? 'border-primary bg-primary-light text-primary-dark' : 'border-slate-200 text-slate-600 hover:border-primary/50'}"
									>
										No hay transferencia
									</button>
								</div>
								{#if errores.transferencia}<p class="mt-1 text-xs text-red-600">{errores.transferencia}</p>{/if}

								{#if transferencia === 'si'}
									<div class="mt-3 relative">
										<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
										<input												type="text"
												inputmode="numeric"
												pattern="[0-9]*"												bind:value={transferenciaMonto}
												placeholder="Monto a transferir"
												oninput={() => sincronizarRecargos()}
											class="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.transferenciaMonto ? 'border-red-400' : ''}"
											/>
											{#if errores.transferenciaMonto}<p class="mt-1 text-xs text-red-600">{errores.transferenciaMonto}</p>{/if}
										</div>
									{/if}
								</div>


						</div>						{:else if tipoServicio === 'compra_diligencia' && tipoDiligencia}
					<div transition:fly={{ y: 12, duration: 200 }} class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
						<h2 class="mb-1 flex items-center gap-2 text-sm font-bold tracking-wide text-slate-500 uppercase">
							<span class="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">3</span>
							Detalles del pedido
						</h2>
						<p class="mb-4 ml-7 text-xs text-slate-400">
							Indica el peso, transferencia y paradas si aplica.
						</p>

						<!-- Campo: peso -->
						<div class="mb-4">
							<label for="cd-peso" class="mb-1.5 block text-sm font-semibold text-slate-700">Peso del paquete <span class="text-amber-600">(obligatorio)</span></label>
							<div class="relative">
								<input
									id="cd-peso"
									type="text"
									inputmode="decimal"
									bind:value={pesoKg}
									placeholder="Ej: 2.5"
									oninput={() => sincronizarRecargos()}
									class="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.peso ? 'border-red-400' : ''}"
								/>
								<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">kg</span>
							</div>
							{#if errores.peso}<p class="mt-1 text-xs text-red-600">{errores.peso}</p>{/if}
						</div>

						<!-- Campo: transferencia -->
						<div class="mb-4">
							<label class="mb-1.5 block text-sm font-semibold text-slate-700">Transferencia bancaria <span class="text-amber-600">(obligatorio)</span></label>
							<div class="flex gap-2">
								<button
									type="button"
									onclick={() => { transferencia = 'si'; error = null; sincronizarRecargos(); }}
									class="rounded-xl border-2 px-4 py-2 text-sm font-semibold transition {transferencia === 'si' ? 'border-primary bg-primary-light text-primary-dark' : 'border-slate-200 text-slate-600 hover:border-primary/50'}"
								>
									Sí, hay transferencia
								</button>
								<button
									type="button"
									onclick={() => { transferencia = 'no'; transferenciaMonto = ''; error = null; sincronizarRecargos(); }}
									class="rounded-xl border-2 px-4 py-2 text-sm font-semibold transition {transferencia === 'no' ? 'border-primary bg-primary-light text-primary-dark' : 'border-slate-200 text-slate-600 hover:border-primary/50'}"
								>
									No hay transferencia
								</button>
							</div>
							{#if errores.transferencia}<p class="mt-1 text-xs text-red-600">{errores.transferencia}</p>{/if}

							{#if transferencia === 'si'}
								<div class="mt-3 relative">
									<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
									<input
										type="text"
										inputmode="numeric"
										pattern="[0-9]*"											bind:value={transferenciaMonto}
											placeholder="Monto a transferir"
											oninput={() => sincronizarRecargos()}
											class="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 {errores.transferenciaMonto ? 'border-red-400' : ''}"
										/>
									{#if errores.transferenciaMonto}<p class="mt-1 text-xs text-red-600">{errores.transferenciaMonto}</p>{/if}
								</div>
							{/if}
						</div>

						<!-- Campo: paradas adicionales -->
						<div class="mb-4">
							<label for="cd-paradas" class="mb-1.5 block text-sm font-semibold text-slate-700">Paradas adicionales <span class="font-normal text-slate-400">(opcional)</span></label>
							<div class="relative">
								<input
									id="cd-paradas"
									type="text"
									inputmode="numeric"
									pattern="[0-9]*"
									bind:value={dilCantidad}
									placeholder="0"
									class="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11"
								/>
								<span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">#</span>
							</div>
						</div>

						{#if errores.recargos}
							<p class="mt-2 text-xs text-red-600">{errores.recargos}</p>
						{/if}
					</div>
					{/if}

					<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
						<h2 class="mb-4 text-sm font-bold tracking-wide text-slate-500 uppercase">Observaciones <span class="font-normal normal-case text-slate-400">(opcional)</span></h2>
						<textarea
							bind:value={observaciones}
							rows="3"
							maxlength="1000"
							placeholder="Ej: entregar en portería, llamar al llegar…"
							class="w-full rounded-xl border border-slate-300 bg-white min-h-11 px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
						></textarea>
						{#if errores.observaciones}
							<p class="mt-1 text-xs text-red-600">{errores.observaciones}</p>
						{/if}
					</div>

					<!-- Contacto (Fase 19): el celular es obligatorio para coordinar por WhatsApp -->
					<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
						<h2 class="mb-1 text-sm font-bold tracking-wide text-slate-500 uppercase">Tus datos</h2>
						<p class="mb-4 text-xs text-slate-400">
							El negocio y el domiciliario te contactarán por WhatsApp para coordinar la entrega.
						</p>
						<div class="grid gap-4 sm:grid-cols-2">
							<div>
								<label for="cli-nombre" class="mb-1.5 block text-sm font-semibold text-slate-700">
									Nombre <span class="font-normal text-slate-400">(opcional)</span>
								</label>
								<input
									id="cli-nombre"
									type="text"
									bind:value={nombreCliente}
									maxlength="120"
									placeholder="Ej: Ana María"
									class="w-full rounded-xl border px-4 py-2.5 text-sm shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 bg-white text-slate-900 {errores.nombreCliente ? 'border-red-400' : 'border-slate-300'}"
								/>
								{#if errores.nombreCliente}
									<p class="mt-1 text-xs text-red-600">{errores.nombreCliente}</p>
								{/if}
							</div>
							<div>
								<label for="cli-telefono" class="mb-1.5 block text-sm font-semibold text-slate-700">
									Celular <span class="font-normal text-amber-600">(obligatorio)</span>
								</label>
								<input
									id="cli-telefono"
									type="tel"
									inputmode="numeric"
									bind:value={telefono}
									maxlength="20"
									placeholder="300 123 4567"
									class="w-full rounded-xl border px-4 py-2.5 text-sm shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11 bg-white text-slate-900 {errores.telefono ? 'border-red-400' : 'border-slate-300'}"
								/>
								{#if errores.telefono}
									<p class="mt-1 text-xs text-red-600">{errores.telefono}</p>
								{/if}
							</div>
						</div>
					</div>
						<!-- Base necesaria (Fase 21): efectivo que el domiciliario debe adelantar -->
						<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
							<h2 class="mb-1 flex items-center gap-2 text-sm font-bold tracking-wide text-slate-500 uppercase">
								<span class="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">4</span>
								Base necesaria
							</h2>
							<p class="mb-4 ml-7 text-xs text-slate-400">
								{#if tipoServicio === 'compra_diligencia'}
									Efectivo que el domiciliario necesitará adelantar para cubrir la compra o diligencia en el local. Se sugiere automáticamente el total, puedes ajustarlo si es necesario.
								{:else}
									Efectivo que el domiciliario necesitará para el pedido (compras, pago, etc.). Si no aplica, déjalo en 0.
								{/if}
							</p>
							<div class="grid gap-4 sm:grid-cols-2">
								<div>
									<label for="base-necesaria" class="mb-1.5 block text-sm font-semibold text-slate-700">Monto a adelantar (COP)</label>										<input
											id="base-necesaria"
											type="text"
											inputmode="numeric"
											pattern="[0-9]*"
											bind:value={baseNecesaria}
											placeholder="0"
										class="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none min-h-11"
									/>
								</div>
								<div class="flex items-end">
							{#if !baseNecesaria.trim()}
								{@const baseSugerida = calcularBaseSugerida({ valorMandado: valorMandadoNum, recargoTotal, tarifaServicio: precioDisponible ? (precio?.valor ?? 0) : 0 })}
								{#if baseSugerida > 0}
									<button
										type="button"
										onclick={() => { baseNecesaria = String(baseSugerida); }}
												class="rounded-xl border border-primary/30 bg-primary-light px-4 py-2.5 text-sm font-semibold text-primary-dark transition hover:bg-primary/20"
											>
												Usar total ({formatearPeso(baseSugerida)})
											</button>
										{/if}
									{/if}
								</div>
							</div>
						</div>

						<div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
							<div class="flex items-center justify-between gap-4">
								<div>
									<p class="text-xs font-semibold tracking-wide text-slate-500 uppercase">
										{tipoServicio === 'compra_diligencia' ? 'Valor del servicio' : 'Tarifa del trayecto'}
									</p>
								{#if !destino}
									<p class="mt-1 text-sm text-slate-400">Selecciona el barrio de destino para continuar.</p>
								{:else if calculando}
									<p class="mt-1 flex items-center gap-2 text-sm text-slate-500">
										<span class="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
										Calculando…
									</p>
								{:else if precioDisponible}
									<p class="mt-1 text-3xl font-extrabold tracking-tight text-slate-900">{formatearPeso(totalEstimado)}</p>
									<p class="mt-0.5 text-xs text-slate-500">
										{nombreZona(String(precio?.meta?.zona_origen))} → {nombreZona(String(precio?.meta?.zona_destino))}
									</p>
								{:else if tipoServicio === 'compra_diligencia' && !origenRequerido && !tieneRutaCompleta}
									<p class="mt-1 text-xl font-extrabold tracking-tight text-slate-900">Sin tarifa automática</p>
									<p class="mt-0.5 text-xs text-slate-500">
										El domiciliario confirma el precio final al realizar la diligencia{recargoTotal > 0
											? ` (recargos: ${formatearPeso(recargoTotal)})`
											: ''}.
									</p>
								{:else if !tieneRutaCompleta}
									<p class="mt-1 text-sm text-slate-400">
										Selecciona {tipoServicio === 'compra_diligencia' ? 'el barrio de recogida y el de destino' : 'ambos barrios'} para ver el precio.
									</p>
								{:else}
									<p class="mt-1 text-sm font-medium text-red-600">
										No disponible: este trayecto no tiene tarifa o pasa por una zona sin servicio.
									</p>
								{/if}
							</div>
							{#if calculando}
								<span class="size-8 animate-spin rounded-full border-[3px] border-primary border-t-transparent"></span>
							{/if}
						</div>

						{#if precioDisponible || recargosAplicados.length > 0 || valorMandadoNum > 0}
							<div class="mt-4 space-y-1.5 rounded-xl bg-white p-4 text-sm shadow-sm">
								{#if precioDisponible}
									<p class="flex justify-between text-slate-600">
										<span>Tarifa base</span>
										<span class="font-semibold text-slate-900">{formatearPeso(precio?.valor)}</span>
									</p>
								{/if}
								{#each recargosAplicados as r (r.codigo)}
									<p class="flex justify-between text-slate-600">
										<span>{r.nombre}</span>
										<span class="font-semibold text-slate-800">{formatearPeso(r.valor)}</span>
									</p>
								{/each}
								<p class="flex justify-between border-t border-slate-200 pt-1.5 font-bold text-slate-900">
									<span>{tipoServicio === 'compra_diligencia' ? 'Costo del servicio' : 'Total estimado'}</span>
									<span>{formatearPeso(totalEstimado)}</span>
								</p>
								{#if valorMandadoNum > 0}
									<div class="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
										<p class="text-xs font-semibold text-blue-700">Dinero a entregar / adelantar</p>
										<p class="mt-0.5 text-lg font-bold text-blue-900">{formatearPeso(valorMandadoNum)}</p>
										<p class="text-[11px] text-blue-600">Este valor NO es ingreso de StarGo: es dinero del cliente que el domiciliario entrega o consigna.</p>
									</div>
								{/if}
							</div>
						{/if}

						{#if precioDisponible || (tipoServicio === 'compra_diligencia' && !origenRequerido && !tieneRutaCompleta)}
							<div class="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
								<Icon icon={TriangleAlert} class="mt-0.5 size-3.5 shrink-0" />
								{#if precio?.meta?.aproximado}
									<span>Este es un <strong>precio aproximado</strong> ({formatearPeso(totalEstimado)}). El precio final lo confirma el domiciliario según el servicio que realmente realice.</span>
								{:else if tipoServicio === 'compra_diligencia' && !tieneRutaCompleta}
									<span>El precio final lo confirma el <strong>domiciliario</strong> al realizar la diligencia según lo que realmente se haga.</span>
								{:else}
									<span>Este es un <strong>estimado</strong>: el precio final lo confirma el domiciliario según el servicio real que realice (compras, peso, paradas, espera, método de pago, etc.).</span>
								{/if}
							</div>
						{/if}
						{#if error}
							<div class="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
						{/if}

						<button
							type="submit"
							disabled={!puedeConfirmar}
							class="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-slate-900/10 transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
						>
							{#if confirmando}
								<span class="size-4 animate-spin rounded-full border-2 border-white/50 border-t-white"></span>
								Confirmando…
							{:else}
								Confirmar pedido
							{/if}
						</button>
						{#if !puedeConfirmar && !confirmando}
							<p class="mt-2 text-center text-xs text-slate-400">								{tipoServicio === 'domicilio'
									? tieneRutaCompleta && !precioDisponible
										? 'No se puede confirmar sin una tarifa disponible.'
										: 'Completa los campos para confirmar el pedido.'
									: !destino
											? 'Selecciona el barrio de destino.'
												: 'Completa los campos para confirmar el pedido.'}
							</p>
						{/if}
					</div>
				</form>
			{/if}
		{/if}
	</main>
</div>
