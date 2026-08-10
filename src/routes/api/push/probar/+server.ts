import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAsUser } from '$lib/server/supabase';
import { requireRol } from '$lib/server/auth';
import { esClaveVapidValida } from '$lib/push-vapid';
import { PUBLIC_SUPABASE_URL, PUBLIC_VAPID_PUBLIC_KEY } from '$env/static/public';

/**
 * POST /api/push/probar — requiere sesión con rol (admin o domiciliario).
 *
 * Diagnóstico de la cadena de Web Push. Prueba TODOS los eslabones y devuelve
 * un veredicto que identifica el roto:
 *
 *   1. Suscripciones del usuario en push_subscriptions (eslabón navegador).
 *   2. Edge Function send-push: ¿desplegada? ¿secrets VAPID configurados?
 *   3. PAREADO VAPID: la huella de la clave pública del cliente (Vercel) se
 *      compara con la de la clave pública de la Edge Function (Supabase). Si
 *      NO coinciden, la pareja pública/privada está cruzada y TODOS los push
 *      fallan con 401/403 (la causa nº 1 de «el push no llega»).
 *   4. INSERT real en `notificaciones` dirigido al propio usuario: ejercita el
 *      flujo REAL pedido → trigger → notificaciones → WEBHOOK → send-push.
 *   5. Envío directo a la Edge Function (sin webhook) con un push garantizado.
 *
 * Cómo leer el resultado:
 *   - «SIN SUSCRIPCIÓN»            → activa el push desde la campanita.
 *   - «EDGE INALCANZABLE»          → send-push no está desplegada.
 *   - «VAPID SIN CONFIGURAR»       → faltan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY
 *                                    en los secrets de send-push.
 *   - «VAPID DESPAREJADO»          → las claves pública (Vercel) y privada
 *                                    (Supabase) no son la misma pareja.
 *   - «MIGRACIÓN NO EJECUTADA»     → el INSERT de prueba falló por permisos.
 *   - «TODO OK» pero no llega nada → revisa el webhook (Database → Webhooks):
 *                                    tabla, evento INSERT y URL correctas.
 */

/** Huella SHA-256 (base64url) de la clave VAPID pública del cliente. */
async function huellaLocal(clave: string): Promise<string> {
	// .trim(): ambas copias (Vercel vs Supabase) pueden traer saltos de línea
	// al pegar; sin trim la comparación daría un falso «desparejado».
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clave.trim()));
	return btoa(String.fromCharCode(...new Uint8Array(digest)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

export const POST: RequestHandler = async (event) => {
	const { sesion, esAdmin } = await requireRol(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	// ---- Eslabón 1: suscripciones guardadas -------------------------------
	const { data: subs, error: errSubs } = await db
		.from('push_subscriptions')
		.select('id')
		.eq('usuario_id', sesion.user.id);
	if (errSubs) return json({ error: errSubs.message }, { status: 500 });
	const suscripciones = subs?.length ?? 0;
	if (suscripciones === 0) {
		return json({
			data: {
				suscripciones: 0,
				enviadas: 0,
				diagnostico: 'SIN SUSCRIPCIÓN',
				ok: false,
				detalle:
					'No hay suscripciones guardadas para este usuario.\nAbre la campanita y pulsa «Activar notificaciones push» en ESTE navegador (en iPhone requiere la app instalada en pantalla de inicio).'
			}
		});
	}

	// ---- Eslabón 2 y 3: estado y pareado VAPID de la Edge Function ---------
	let ref = '';
	try {
		ref = new URL(PUBLIC_SUPABASE_URL).hostname.split('.')[0];
	} catch {
		return json({ error: 'PUBLIC_SUPABASE_URL no es una URL válida.' }, { status: 500 });
	}
	const edgeUrl = `https://${ref}.functions.supabase.co/send-push`;

	let vapidConfigurado = false;
	let huellaEdge: string | null = null;
	try {
		const res = await fetch(edgeUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			signal: AbortSignal.timeout(15_000),
			body: JSON.stringify({ diagnostico: true })
		});
		const body = (await res.json().catch(() => null)) as
			| { diagnostico?: { vapid_configurado?: boolean; huella?: string | null } }
			| null;
		vapidConfigurado = Boolean(body?.diagnostico?.vapid_configurado);
		huellaEdge = body?.diagnostico?.huella ?? null;
	} catch {
		return json({
			data: {
				suscripciones,
				enviadas: 0,
				diagnostico: 'EDGE FUNCTION INALCANZABLE',
				ok: false,
				detalle: `No se pudo llamar a la Edge Function (${edgeUrl}).\n¿Está desplegada? Despliega con: supabase functions deploy send-push\n(¿cold start muy lento o red?).`
			}
		});
	}

	if (!vapidConfigurado) {
		return json({
			data: {
				suscripciones,
				enviadas: 0,
				diagnostico: 'VAPID SIN CONFIGURAR',
				ok: false,
				detalle:
					'La Edge Function respondió pero le faltan las secrets VAPID.\nEn Supabase → Edge Functions → Secrets de send-push, añade VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY (el par generado con npx web-push generate-vapid-keys).'
			}
		});
	}

	// La clave pública del CLIENTE (Vercel) debe existir y estar bien formada
	// ANTES de comparar parejas: un PEM/JWK pegado daría una huella engañosa.
	const clavePublica = (PUBLIC_VAPID_PUBLIC_KEY ?? '').trim();
	if (!clavePublica) {
		return json({
			data: {
				suscripciones,
				enviadas: 0,
				diagnostico: 'FALTA PUBLIC_VAPID_PUBLIC_KEY',
				ok: false,
				detalle:
					'La variable PUBLIC_VAPID_PUBLIC_KEY no está definida en el entorno de la app (Vercel).\nAñádela con el publicKey del par VAPID (npx web-push generate-vapid-keys --json).'
			}
		});
	}
	if (!esClaveVapidValida(clavePublica)) {
		return json({
			data: {
				suscripciones,
				enviadas: 0,
				diagnostico: 'CLAVE VAPID INVÁLIDA',
				ok: false,
				detalle:
					'PUBLIC_VAPID_PUBLIC_KEY no tiene formato de clave VAPID (base64url, 65 bytes).\nDebe ser el publicKey desnudo, NO un PEM (— BEGIN PUBLIC KEY —) ni un JSON.\nRegenera el par con: npx web-push generate-vapid-keys --json'
			}
		});
	}

	// Pareado: la pública del cliente (Vercel) debe ser la misma que la de la
	// Edge Function (Supabase). Si no, la privada que firma no corresponde.
	const huellaLocalKey = await huellaLocal(clavePublica);
	const pareadas = Boolean(huellaEdge && huellaLocalKey && huellaEdge === huellaLocalKey);
	if (!pareadas) {
		return json({
			data: {
				suscripciones,
				enviadas: 0,
				diagnostico: 'VAPID DESPAREJADO',
				ok: false,
				detalle:
					'La clave pública del cliente (PUBLIC_VAPID_PUBLIC_KEY en Vercel) NO es la pareja de la clave privada de send-push (Supabase).\nTODOS los push fallan en silencio (401/403).\nSolución: copia la MISMA clave pública a ambos lados, o regenera el par con:\n  npx web-push generate-vapid-keys --json\n  → publicKey en Vercel y en send-push; privateKey solo en send-push.'
			}
		});
	}

	const recordBase = {
		destinatario_tipo: (esAdmin ? 'admin' : 'domiciliario') as 'admin' | 'domiciliario',
		destinatario_id: sesion.user.id,
		pedido_id: null,
		tipo: 'nuevo_pedido'
	} as const;

	// ---- Eslabón 4: INSERT real → ejercita el WEBHOOK de punta a punta -----
	// Este INSERT dispara el Database Webhook (INSERT en notificaciones →
	// send-push). Si te llega el banner «(webhook)», el webhook funciona.
	const { error: errIns } = await db.from('notificaciones').insert({
		...recordBase,
		titulo: '🔔 Prueba (webhook)',
		cuerpo: 'Si te llega el push del sistema, el webhook funciona.'
	});
	const webhookInsertOk = !errIns;

	// ---- Eslabón 5: envío directo garantizado (sin depender del webhook) ---
	let enviadas = 0;
	let errorEnvio: string | null = null;
	try {
		const res = await fetch(edgeUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			signal: AbortSignal.timeout(15_000),
			body: JSON.stringify({
				type: 'INSERT',
				table: 'notificaciones',
				schema: 'public',
				record: {
					...recordBase,
					titulo: '🔔 Prueba (directo)',
					cuerpo: 'Enviado sin pasar por el webhook.'
				}
			})
		});
		const body = (await res.json().catch(() => null)) as { enviadas?: number } | null;
		enviadas = body?.enviadas ?? 0;
		if (!res.ok) errorEnvio = `HTTP ${res.status}`;
	} catch (e) {
		errorEnvio = e instanceof Error && e.name === 'TimeoutError' ? 'timeout (> 15 s)' : e instanceof Error ? e.message : 'error de red';
	}

	// ---- Veredicto ---------------------------------------------------------
	if (!webhookInsertOk) {
		return json({
			data: {
				suscripciones,
				enviadas,
				diagnostico: 'MIGRACIÓN NO EJECUTADA',
				ok: false,
				detalle: `El INSERT de prueba falló (${errIns?.message ?? 'desconocido'}).\nEjecuta la migración fase17 (supabase/migrations/20260816000000_fase17_diagnostico_push.sql) en el SQL Editor de Supabase para habilitar el diagnóstico.`
			}
		});
	}	if (enviadas > 0) {
		return json({
			data: {
				suscripciones,
				enviadas,
				diagnostico: 'TODO OK',
				ok: true,
				detalle:
					`La Edge Function envió ${enviadas} push directo(s) «(directo)» y el INSERT del webhook quedó registrado «(webhook)».\nCon la app CERRADA deberían llegar ambos tipos de banner.\nSi solo llegan los «(directo)», el problema es el WEBHOOK: en Supabase → Database → Webhooks revisa que apunte a send-push, con evento INSERT y tabla public.notificaciones.\nNota: el centro de notificaciones mostrará la entrada «Prueba (webhook)» — es esperado; se puede marcar como leída.`
			}
		});
	}

	if (errorEnvio) {
		return json({
			data: {
				suscripciones,
				enviadas,
				diagnostico: 'EDGE INALCANZABLE EN ENVÍO',
				ok: false,
				detalle:
					`El diagnóstico VAPID fue correcto pero el envío directo falló (${errorEnvio}).\nLa Edge Function estuvo inalcanzable en ese momento o respondió con error.\nReintenta en unos segundos; si persiste, revisa los logs de send-push en Supabase.`
			}
		});
	}

	return json({
		data: {
			suscripciones,
			enviadas,
			diagnostico: 'ENVÍO FALLIDO',
			ok: false,
			detalle:
				'VAPID pareado y webhook OK, pero la Edge Function no envió ningún push.\nCausa más probable: las suscripciones guardadas se crearon con la clave VAPID ANTERIOR (si regeneraste el par) o están expiradas — el servicio de push las rechaza en silencio (403) y send-push ya las va limpiando.\nSolución: en la campanita pulsa «Activar notificaciones push»: ahora regenera la suscripción automáticamente si detecta la clave vieja.'
		}
	});
};
