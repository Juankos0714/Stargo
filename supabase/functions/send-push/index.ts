// ============================================================
// StarGo · Edge Function send-push
// ============================================================
// Recibe el Database Webhook de Supabase (INSERT en public.notificaciones)
// y envía Web Push (VAPID) a las suscripciones del destinatario guardadas
// en push_subscriptions. Con la PWA instalada, la notificación aparece
// aunque la app esté cerrada.
//
// SECRETS (Supabase → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY   (misma clave pública que PUBLIC_VAPID_PUBLIC_KEY)
//   VAPID_PRIVATE_KEY
//   VAPID_SUBJECT      (mailto:... o https://... — obligatorio para VAPID)
//
// El webhook se crea en el dashboard: Database → Webhooks → INSERT en
// public.notificaciones → POST https://<project-ref>.functions.supabase.co/send-push
// (verify_jwt = false, configurado en supabase/config.toml).
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@^3.6.7';

const supabase = createClient(
	Deno.env.get('SUPABASE_URL') ?? '',
	Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@stargo.app';

/** Configura VAPID solo si hay claves; devuelve false si faltan (no lanza al importar). */
function vapidListo(): boolean {
	if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
	try {
		webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
		return true;
	} catch {
		return false;
	}
}

interface Notificacion {
	id: number;
	destinatario_tipo: 'admin' | 'domiciliario';
	destinatario_id: string;
	pedido_id: string | null;
	tipo: string;
	titulo: string;
	cuerpo: string | null;
}

/** URL a la que abre la notificación (depende del rol del destinatario). */
function urlDe(notificacion: Notificacion): string {
	if (notificacion.destinatario_tipo === 'domiciliario') return '/domiciliario';
	return '/admin/pedidos';
}

/**
 * Huella de la clave VAPID pública (SHA-256 en base64url).
 *
 * El endpoint /api/push/probar la compara con la huella de
 * PUBLIC_VAPID_PUBLIC_KEY (la clave pública del CLIENTE en Vercel): si no
 * coinciden, la pareja de claves está DESPAREJADA (la privada que firma en
 * la Edge Function no corresponde con la pública con la que el navegador se
 * suscribió) y TODOS los push fallan con 401/403 en silencio. Es la causa
 * nº 1 de «el push no llega aunque todo parece configurado».
 */
async function huellaVapid(): Promise<string> {
	// .trim(): las secrets pegadas en dashboards suelen traer saltos de línea
	// finales; sin trim daría falsos «desparejados» si una de las dos copias
	// (Vercel vs Supabase) trae \n y la otra no.
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(VAPID_PUBLIC.trim()));
	return btoa(String.fromCharCode(...new Uint8Array(digest)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

Deno.serve(async (req) => {
	if (req.method !== 'POST') return new Response('Método no permitido', { status: 405 });

	// Payload del webhook de Supabase: { type, table, record, old_record }.
	const payload = await req.json().catch(() => null);

	// --- Modo diagnóstico (lo llama /api/push/probar): NO envía nada, solo
	// reporta si las secrets VAPID están configuradas y la huella de la clave
	// pública, para que el cliente verifique el pareado. ---
	if (payload?.diagnostico === true) {
		const configurado = vapidListo();
		return new Response(
			JSON.stringify({
				diagnostico: {
					vapid_configurado: configurado,
					huella: configurado ? await huellaVapid() : null
				}
			}),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	}

	const record = payload?.record as Notificacion | undefined;
	if (!record?.destinatario_id || !record?.titulo) {
		// Sin destinatario no hay nada que enviar (p. ej. webhook de prueba).
		return new Response('ok');
	}

	// Sin claves VAPID (secrets sin configurar) la función sigue viva y
	// reporta el problema en lugar de fallar al cargar.
	if (!vapidListo()) {
		console.error('Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en los secrets de send-push.');
		return new Response('Faltan las claves VAPID de la Edge Function send-push.', { status: 500 });
	}

	const { data: subs, error } = await supabase
		.from('push_subscriptions')
		.select('id, endpoint, p256dh, auth')
		.eq('usuario_id', record.destinatario_id);

	if (error) {
		console.error('Error leyendo push_subscriptions:', error.message);
		return new Response('error', { status: 500 });
	}
	if (!subs || subs.length === 0) return new Response('ok');

	const mensaje = JSON.stringify({
		title: record.titulo,
		body: record.cuerpo ?? 'Tienes una nueva notificación de StarGo.',
		icon: '/icons/icon-192.png',
		badge: '/icons/icon-192.png',
		data: { url: urlDe(record), pedidoId: record.pedido_id }
	});

	let enviadas = 0;
	for (const sub of subs) {
		try {
			await webpush.sendNotification(
				{ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
				mensaje
			);
			enviadas++;
		} catch (e) {
			// 404/410: la suscripción ya no existe → se limpia para no reintentar.
			const status = (e as { statusCode?: number })?.statusCode;
			if (status === 404 || status === 410) {
				await supabase.from('push_subscriptions').delete().eq('id', sub.id);
			} else {
				console.error('Push fallido para', sub.endpoint, (e as Error)?.message);
			}
		}
	}

	return new Response(JSON.stringify({ enviadas }), {
		headers: { 'Content-Type': 'application/json' }
	});
});
