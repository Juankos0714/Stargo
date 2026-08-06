import * as Sentry from '@sentry/sveltekit';
import { env } from '$env/dynamic/private';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAnon } from './supabase';
import {
	pedidosPendientesVencidos,
	textoWebhook,
	type NivelAlerta,
	type PedidoPendiente
} from '$lib/logic/alertas';

/**
 * Motor de alertas (Parte 9). Lo invoca el cron /api/cron/alertas.
 *
 * Evaluaciones (todas best-effort, el cron NUNCA lanza):
 *   1. Pedidos pendientes sin asignar por más de ALERTAS_PENDIENTE_MINUTOS.
 *   2. Tasa de errores 5xx / rate limits recientes (errores_app).
 *   3. Caída de conexión a Supabase (si los RPCs fallan por red).
 *
 * Cada alerta:
 *   - se registra en la tabla `alertas` (bitácora del dashboard);
 *   - se envía al webhook (ALERTAS_WEBHOOK_URL, formato { text } compatible
 *     con Slack/Discord) SI la del mismo evento no está en cooldown;
 *   - se captura en Sentry (nivel según severidad).
 *
 * El cooldown evita spamear el webhook: si ya se alertó del mismo evento en
 * los últimos ALERTAS_COOLDOWN_MIN, la alerta se registra en la bitácora pero
 * no se re-envía por webhook.
 */

export interface AlertaEmitida {
	evento: string;
	nivel: NivelAlerta;
	detalle: string;
	registrada: boolean;
	enviada_webhook: boolean;
	en_cooldown: boolean;
}

export interface ResultadoChequeos {
	ejecutado_en: string;
	alertas: AlertaEmitida[];
	webhook_configurado: boolean;
}

export interface OpcionesChequeos {
	/** true para forzar una alerta de prueba (ignora cooldown). */
	prueba?: boolean;
	/** Cliente inyectado (tests) o el anónimo por defecto. */
	db?: SupabaseClient;
	/** URL del webhook inyectada (tests) o la de ALERTAS_WEBHOOK_URL. */
	webhookUrl?: string;
	/** fetch inyectado (tests) o el global. */
	fetchImpl?: typeof fetch;
}

const NUM = (v: string | undefined, def: number) => {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : def;
};

function config() {
	return {
		pendienteMin: NUM(env.ALERTAS_PENDIENTE_MINUTOS, 30),
		ventanaErroresMin: NUM(env.ALERTAS_VENTANA_ERRORES_MIN, 10),
		umbral5xx: NUM(env.ALERTAS_UMBRAL_5XX, 5),
		umbralRateLimit: NUM(env.ALERTAS_UMBRAL_RATE_LIMIT, 1),
		cooldownMin: NUM(env.ALERTAS_COOLDOWN_MIN, 60),
		webhookUrl: env.ALERTAS_WEBHOOK_URL ?? '',
		entorno: env.ALERTAS_ENTORNO ?? 'local'
	};
}

/** Registra la alerta en la bitácora (RPC público). Devuelve true si pudo. */
async function registrarEnBitacora(
	db: SupabaseClient,
	evento: string,
	nivel: NivelAlerta,
	detalle: string
): Promise<boolean> {
	const { error } = await db.rpc('registrar_alerta', {
		p_evento: evento,
		p_nivel: nivel,
		p_detalle: detalle
	});
	return !error;
}

/** Consulta el cooldown: ¿ya se alertó del mismo evento? (RPC público). */
async function enCooldown(
	db: SupabaseClient,
	evento: string,
	cooldownMin: number
): Promise<boolean> {
	const { data } = await db.rpc('alerta_reciente', {
		p_evento: evento,
		p_minutos: cooldownMin
	});
	return data === true;
}

async function enviarWebhook(
	fetchImpl: typeof fetch,
	url: string,
	texto: string
): Promise<boolean> {
	try {
		const res = await fetchImpl(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: texto }),
			signal: AbortSignal.timeout(8000)
		});
		return res.ok;
	} catch {
		return false;
	}
}

/** Captura en Sentry con el nivel correcto (no lanza si no hay DSN). */
function capturarSentry(evento: string, nivel: NivelAlerta, detalle: string) {
	const scope = { level: nivel as Sentry.SeverityLevel };
	try {
		Sentry.captureMessage(`[alerta] ${evento}: ${detalle}`, scope);
	} catch {
		// Sentry sin inicializar: nunca debe romper el cron.
	}
}

/** Pedidos pendientes vencidos vía RPC (el anon no puede leer pedidos). */
async function pendientesVencidos(
	db: SupabaseClient,
	p_minutos: number
): Promise<PedidoPendiente[]> {
	const { data, error } = await db.rpc('pedidos_pendientes_para_alerta', {
		p_minutos
	});
	if (error) throw new Error(error.message);
	return Array.isArray(data) ? (data as PedidoPendiente[]) : [];
}

/** Conteo de errores recientes por tipo vía RPC. */
async function erroresRecientes(
	db: SupabaseClient,
	p_minutos: number
): Promise<{ tipo: string; total: number }[]> {
	const { data, error } = await db.rpc('errores_recientes_para_alerta', {
		p_minutos
	});
	if (error) throw new Error(error.message);
	return Array.isArray(data) ? (data as { tipo: string; total: number }[]) : [];
}

/**
 * Ejecuta los chequeos y emite las alertas. NUNCA lanza: ante un fallo de
 * red/BD (Supabase caído) emite una alerta `supabase_caido` y continúa.
 */
export async function ejecutarChequeos(opts: OpcionesChequeos = {}): Promise<ResultadoChequeos> {
	const cfg = config();
	const db = opts.db ?? getSupabaseAnon();
	const webhookUrl = opts.webhookUrl ?? cfg.webhookUrl;
	const fetchImpl = opts.fetchImpl ?? fetch;

	const emitidas: AlertaEmitida[] = [];
	const ahora = new Date();

	// 1) Supabase caído: el chequeo completo depende de la BD. Si los RPCs
	//    fallan por red, se alerta y se corta (no hay más que evaluar).
	let dbOk = true;
	try {
		await db.from('zonas').select('id', { count: 'exact', head: true }).limit(1);
	} catch {
		dbOk = false;
	}
	if (!dbOk) {
		const nivel: NivelAlerta = 'critical';
		const detalle = 'No se pudo contactar a Supabase desde el cron de alertas.';
		// La BD está caída: la bitácora no podrá registrarlo (queda false);
		// lo importante es que el WEBHOOK (externo) reciba la alerta.
		const registrada = webhookUrl ? await registrarEnBitacora(db, 'supabase_caido', nivel, detalle) : false;
		const enviada = webhookUrl
			? await enviarWebhook(fetchImpl, webhookUrl, textoWebhook('Supabase caído', nivel, detalle, cfg.entorno))
			: false;
		capturarSentry('supabase_caido', nivel, detalle);
		emitidas.push({ evento: 'supabase_caido', nivel, detalle, registrada, enviada_webhook: enviada, en_cooldown: false });
		return { ejecutado_en: ahora.toISOString(), alertas: emitidas, webhook_configurado: Boolean(webhookUrl) };
	}

	// 2) Pedidos pendientes vencidos.
	try {
		const vencidos = await pendientesVencidos(db, cfg.pendienteMin);
		if (vencidos.length > 0) {
			const filtrados = pedidosPendientesVencidos(vencidos, ahora, cfg.pendienteMin);
			const evento = 'pedidos_pendientes_sin_asignar';
			const nivel: NivelAlerta = 'critical';
			const detalle =
				filtrados.length === 1
					? `El pedido ${filtrados[0].numero} lleva ${filtrados[0].minutos} min sin asignar.`
					: `${filtrados.length} pedidos llevan más de ${cfg.pendienteMin} min sin asignar (el más antiguo: ${filtrados[0].numero}, ${filtrados[0].minutos} min).`;

			const cooldown = opts.prueba ? false : await enCooldown(db, evento, cfg.cooldownMin);
			if (!cooldown) {
				// No está en cooldown: registrar + webhook + Sentry. Si el webhook
				// falla, NO se registró la alerta, así que el próximo tick reintenta.
				const registrada = await registrarEnBitacora(db, evento, nivel, detalle);
				const enviada = await enviarWebhook(fetchImpl, webhookUrl, textoWebhook('Pedidos sin asignar', nivel, detalle, cfg.entorno));
				capturarSentry(evento, nivel, detalle);
				emitidas.push({ evento, nivel, detalle, registrada, enviada_webhook: enviada, en_cooldown: false });
			} else {
				emitidas.push({ evento, nivel, detalle, registrada: false, enviada_webhook: false, en_cooldown: true });
			}
		}
	} catch (e) {
		emitidas.push({
			evento: 'chequeo_pendientes_error',
			nivel: 'warning',
			detalle: e instanceof Error ? e.message : String(e),
			registrada: false,
			enviada_webhook: false,
			en_cooldown: false
		});
	}

	// 3) Tasa de 5xx y rate limits recientes.
	try {
		const errores = await erroresRecientes(db, cfg.ventanaErroresMin);
		const total5xx = errores.find((e) => e.tipo === '5xx')?.total ?? 0;
		const totalRate = errores.find((e) => e.tipo === 'rate_limit')?.total ?? 0;

		if (total5xx >= cfg.umbral5xx) {
			const evento = 'tasa_errores_5xx_elevada';
			const nivel: NivelAlerta = 'warning';
			const detalle = `${total5xx} errores 5xx en los últimos ${cfg.ventanaErroresMin} min (umbral: ${cfg.umbral5xx}).`;
			const cooldown = opts.prueba ? false : await enCooldown(db, evento, cfg.cooldownMin);
			if (!cooldown) {
				const registrada = await registrarEnBitacora(db, evento, nivel, detalle);
				const enviada = await enviarWebhook(fetchImpl, webhookUrl, textoWebhook('Tasa de errores 5xx', nivel, detalle, cfg.entorno));
				capturarSentry(evento, nivel, detalle);
				emitidas.push({ evento, nivel, detalle, registrada, enviada_webhook: enviada, en_cooldown: false });
			} else {
				emitidas.push({ evento, nivel, detalle, registrada: false, enviada_webhook: false, en_cooldown: true });
			}
		}

		if (totalRate >= cfg.umbralRateLimit) {
			const evento = 'rate_limit_supabase';
			const nivel: NivelAlerta = 'warning';
			const detalle = `${totalRate} respuesta(s) de rate limit (429) de Supabase en los últimos ${cfg.ventanaErroresMin} min.`;
			const cooldown = opts.prueba ? false : await enCooldown(db, evento, cfg.cooldownMin);
			if (!cooldown) {
				const registrada = await registrarEnBitacora(db, evento, nivel, detalle);
				const enviada = await enviarWebhook(fetchImpl, webhookUrl, textoWebhook('Rate limit de Supabase', nivel, detalle, cfg.entorno));
				capturarSentry(evento, nivel, detalle);
				emitidas.push({ evento, nivel, detalle, registrada, enviada_webhook: enviada, en_cooldown: false });
			} else {
				emitidas.push({ evento, nivel, detalle, registrada: false, enviada_webhook: false, en_cooldown: true });
			}
		}
	} catch (e) {
		emitidas.push({
			evento: 'chequeo_errores_error',
			nivel: 'warning',
			detalle: e instanceof Error ? e.message : String(e),
			registrada: false,
			enviada_webhook: false,
			en_cooldown: false
		});
	}

	// 4) Alerta de prueba (verificación del entregable).
	if (opts.prueba) {
		const evento = 'alerta_prueba';
		const nivel: NivelAlerta = 'info';
		const detalle = 'Alerta de prueba solicitada desde el cron (?prueba=1).';
		const registrada = await registrarEnBitacora(db, evento, nivel, detalle);
		const enviada = await enviarWebhook(fetchImpl, webhookUrl, textoWebhook('Prueba de alertas', nivel, detalle, cfg.entorno));
		capturarSentry(evento, nivel, detalle);
		emitidas.push({ evento, nivel, detalle, registrada, enviada_webhook: enviada, en_cooldown: false });
	}

	return { ejecutado_en: ahora.toISOString(), alertas: emitidas, webhook_configurado: Boolean(webhookUrl) };
}
