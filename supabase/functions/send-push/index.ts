// ============================================================
// StarGo · Edge Function send-push (v2 — FCM + Web Push)
// ============================================================
// Recibe el Database Webhook de Supabase (INSERT en public.notificaciones)
// y envía push a las suscripciones del destinatario:
//
//   - Token nativo (Capacitor): envía vía FCM HTTP v1 API.
//     FCM maneja Android directamente y reenvía a APNs para iOS.
//   - Suscripción Web Push (PWA): envía vía VAPID (web-push npm).
//
// SECRETS (Supabase → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY   (misma clave pública que PUBLIC_VAPID_PUBLIC_KEY)
//   VAPID_PRIVATE_KEY
//   VAPID_SUBJECT      (mailto:... o https://... — obligatorio para VAPID)
//   FCM_SERVER_KEY     (legacy server key de Firebase, para FCM v1 API)
//                       O
//   FIREBASE_SERVICE_ACCOUNT  (JSON de la service account, para OAuth2)
//   FIREBASE_PROJECT_ID       (ID del proyecto Firebase)
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

// --- Web Push (VAPID) ---
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@stargo.app';

/** Configura VAPID solo si hay claves; devuelve false si faltan. */
function vapidListo(): boolean {
	if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
	try {
		webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
		return true;
	} catch {
		return false;
	}
}

// --- FCM (Firebase Cloud Messaging) ---
const FCM_SERVER_KEY = Deno.env.get('FCM_SERVER_KEY') ?? '';
const FIREBASE_SERVICE_ACCOUNT = Deno.env.get('FIREBASE_SERVICE_ACCOUNT') ?? '';
const FIREBASE_PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID') ?? '';

/** Token de acceso OAuth2 para FCM v1 API (se cachea 50 min). */
let fcmAccessToken: string | null = null;
let fcmTokenExpiry = 0;

async function obtenerFcmToken(): Promise<string | null> {
	// Si hay token缓存且 no expiró, reusar.
	if (fcmAccessToken && Date.now() < fcmTokenExpiry) return fcmAccessToken;

	if (FIREBASE_SERVICE_ACCOUNT && FIREBASE_PROJECT_ID) {
		try {
			const sa = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
			const now = Math.floor(Date.now() / 1000);
			const header = { alg: 'RS256', typ: 'JWT' };
			const claimSet = {
				iss: sa.client_email,
				scope: 'https://www.googleapis.com/auth/firebase.messaging',
				aud: 'https://oauth2.googleapis.com/token',
				iat: now,
				exp: now + 3600
			};

			// Firma JWT con la private key de la service account
			const encoder = new TextEncoder();
			const headerB64 = btoa(JSON.stringify(header)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
			const claimB64 = btoa(JSON.stringify(claimSet)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
			const unsignedJwt = `${headerB64}.${claimB64}`;

			const keyData = sa.private_key;
			const pemBody = keyData.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '');
			const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

			const cryptoKey = await crypto.subtle.importKey(
				'pkcs8',
				binaryDer.buffer,
				{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
				false,
				['sign']
			);

			const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, encoder.encode(unsignedJwt));
			const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
			const jwt = `${unsignedJwt}.${sigB64}`;

			// Intercambiar JWT por access token
			const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
			});

			if (!tokenRes.ok) {
				console.error('Error obteniendo FCM token:', tokenRes.status);
				return null;
			}

			const tokenData = await tokenRes.json();
			fcmAccessToken = tokenData.access_token;
			fcmTokenExpiry = Date.now() + (tokenData.expires_in ?? 3600) * 1000 - 60_000; // 1 min margen
			return fcmAccessToken;
		} catch (e) {
			console.error('Error generando FCM token:', e);
			return null;
		}
	}

	// Fallback: legacy server key (simpler, deprecated but functional)
	if (FCM_SERVER_KEY) return `key=${FCM_SERVER_KEY}`;

	return null;
}

/**
 * Envía notificación push vía FCM v1 API a un device token.
 * Funciona para Android (directo) e iOS (FCM → APNs).
 */
async function enviarFcm(
	token: string,
	titulo: string,
	cuerpo: string,
	data: Record<string, string>
): Promise<boolean> {
	const fcmToken = await obtenerFcmToken();
	if (!fcmToken) {
		console.error('No se pudo obtener token de FCM');
		return false;
	}

	// Determinar si es legacy key o OAuth2 token
	const isLegacy = FCM_SERVER_KEY && !FIREBASE_SERVICE_ACCOUNT;

	if (isLegacy) {
		// Legacy FCM API (simpler, deprecated)
		const res = await fetch('https://fcm.googleapis.com/fcm/send', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: fcmToken
			},
			body: JSON.stringify({
				to: token,
				priority: 'high',
				notification: { title: titulo, body: cuerpo },
				data
			})
		});
		if (!res.ok) {
			console.error('FCM legacy error:', res.status, await res.text());
			return false;
		}
		return true;
	}

	// FCM HTTP v1 API (recomendado)
	const message = {
		token,
		notification: { title: titulo, body: cuerpo },
		data,
		android: { priority: 'high' as const },
		aps: { sound: 'default' as const, badge: 1 }
	};

	const res = await fetch(
		`https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${fcmToken}`
			},
			body: JSON.stringify({ message })
		}
	);

	if (!res.ok) {
		const errBody = await res.text();
		console.error('FCM v1 error:', res.status, errBody);
		// Token inválido/expirado → limpiar
		if (res.status === 404 || res.status === 400) {
			return false; // El caller limpiará el token
		}
		return false;
	}

	return true;
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
 * Para diagnóstico de pareado de claves.
 */
async function huellaVapid(): Promise<string> {
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

	// --- Modo diagnóstico (lo llama /api/push/probar): NO envía nada ---
	if (payload?.diagnostico === true) {
		const configurado = vapidListo();
		return new Response(
			JSON.stringify({
				diagnostico: {
					vapid_configurado: configurado,
					huella: configurado ? await huellaVapid() : null,
					fcm_configurado: Boolean(FCM_SERVER_KEY || FIREBASE_SERVICE_ACCOUNT)
				}
			}),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	}

	const record = payload?.record as Notificacion | undefined;
	if (!record?.destinatario_id || !record?.titulo) {
		return new Response('ok');
	}

	// Leer TODAS las suscripciones del destinatario (Web Push + nativas).
	const { data: subs, error } = await supabase
		.from('push_subscriptions')
		.select('id, endpoint, p256dh, auth, token, plataforma')
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
		data: { url: urlDe(record), pedidoId: record.pedido_id ?? '' }
	});

	const dataNativo: Record<string, string> = {
		url: urlDe(record),
		pedidoId: record.pedido_id ?? '',
		title: record.titulo,
		body: record.cuerpo ?? 'Tienes una nueva notificación de StarGo.'
	};

	let enviadas = 0;
	let fcmConfigurado = Boolean(FCM_SERVER_KEY || FIREBASE_SERVICE_ACCOUNT);
	if (!fcmConfigurado) {
		console.warn('FCM no configurado (falta FCM_SERVER_KEY o FIREBASE_SERVICE_ACCOUNT). Push nativos no se enviarán.');
	}

	for (const sub of subs) {
		// --- Token nativo (Capacitor) → FCM ---
		if (sub.token && sub.plataforma) {
			if (!fcmConfigurado) continue;

			const ok = await enviarFcm(sub.token, record.titulo, record.cuerpo ?? '', dataNativo);
			if (ok) {
				enviadas++;
			} else {
				// Token inválido/expirado → limpiar
				console.log('Limpiando token FCM inválido:', sub.id);
				await supabase.from('push_subscriptions').delete().eq('id', sub.id);
			}
			continue;
		}

		// --- Web Push (PWA) → VAPID ---
		if (!vapidListo()) {
			console.error('Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY para Web Push.');
			continue;
		}

		try {
			await webpush.sendNotification(
				{ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
				mensaje
			);
			enviadas++;
		} catch (e) {
			const status = (e as { statusCode?: number })?.statusCode;
			const cuerpo = String((e as { body?: unknown })?.body ?? '');
			if (
				status === 404 ||
				status === 410 ||
				(status === 403 && /VapidPkHashMismatch|ExpiredSubscription/i.test(cuerpo))
			) {
				await supabase.from('push_subscriptions').delete().eq('id', sub.id);
			} else {
				console.error('Web Push fallido para', sub.endpoint, (e as Error)?.message);
			}
		}
	}

	return new Response(JSON.stringify({ enviadas }), {
		headers: { 'Content-Type': 'application/json' }
	});
});
