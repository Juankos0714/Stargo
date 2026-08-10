import { env } from '$env/dynamic/public';
import { browser } from '$app/environment';
import { esClaveVapidValida, base64UrlABytes } from '$lib/push-vapid';

/**
 * Web Push (Fase 15).
 *
 * `suscribirPush()` pide permiso de notificaciones, registra el pushManager
 * (applicationServerKey = VAPID público) y guarda la suscripción en
 * `push_subscriptions` vía POST /api/push/suscribir. Con la PWA instalada,
 * las notificaciones llegan aunque la app esté cerrada.
 */

/**
 * ¿Es un iPhone/iPad (iOS)?
 *
 * iOS 16.4+ SOLO permite Web Push en la PWA INSTALADA (agregada a pantalla
 * de inicio): en Safari normal no existe PushManager, así que el botón de
 * activar no aparece. Este helper permite mostrar un aviso explicando que
 * hay que instalar la app primero (sin él el usuario cree que algo falla).
 */
export function esIOS(): boolean {
	if (!browser) return false;
	const ua = navigator.userAgent;
	// iPadOS se reporta como Mac con touch (maxTouchPoints > 1).
	return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** ¿El navegador soporta Web Push? (SW + PushManager + notificaciones). */
export function pushSoportado(): boolean {
	return (
		browser &&
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		'Notification' in window &&
		Boolean(env.PUBLIC_VAPID_PUBLIC_KEY)
	);
}

/**
 * ¿La suscripción se creó con la clave VAPID actual?
 *
 * Tras regenerar las claves VAPID, las suscripciones viejas siguen en el
 * navegador pero el servicio de push las rechaza siempre (403
 * VapidPkHashMismatch): la applicationServerKey embebida no coincide con la
 * pública que firma. Al activar, esto detecta el desajuste para poder
 * regenerar la suscripción. Si el navegador no expone `options` (navegadores
 * viejos) no se puede saber → se conserva la suscripción (no tocar).
 */
function suscripcionUsaLlaveActual(sub: PushSubscription, claveBase64Url: string): boolean {		try {
			const serverKey = (sub.options as { applicationServerKey?: ArrayBuffer | null } | null)
				?.applicationServerKey;
			if (!serverKey) return true;
			const actual = new Uint8Array(serverKey);
			const esperado = base64UrlABytes(claveBase64Url);
			return actual.length === esperado.length && actual.every((b, i) => b === esperado[i]);
		} catch {
			return true;
		}
}

/** ¿Ya está suscrito en este navegador? (null si no se puede saber). */
export async function estaSuscrito(): Promise<boolean | null> {
	if (!pushSoportado()) return null;
	try {
		const reg = await navigator.serviceWorker.ready;
		const sub = await reg.pushManager.getSubscription();
		return Boolean(sub);
	} catch {
		return null;
	}
}

/**
 * Pide permiso y suscribe el navegador. Devuelve { ok, error? }.
 * Debe llamarse desde un gesto del usuario (clic) o el navegador deniega.
 */
export async function suscribirPush(): Promise<{ ok: boolean; error?: string }> {
	if (!pushSoportado()) {
		return { ok: false, error: 'Este navegador no soporta notificaciones push (o falta PUBLIC_VAPID_PUBLIC_KEY).' };
	}
	try {
		const permiso = await Notification.requestPermission();
		if (permiso !== 'granted') {
			return { ok: false, error: 'Permiso de notificaciones denegado. Actívalo desde los ajustes del navegador.' };
		}

	// Validar el formato de la clave ANTES de suscribirse: un PEM o JWK pegado
	// en PUBLIC_VAPID_PUBLIC_KEY rompe la suscripción con un error confuso.
	const clave = env.PUBLIC_VAPID_PUBLIC_KEY ?? '';
	if (!esClaveVapidValida(clave)) {
		return {
			ok: false,
			error:
				'La clave VAPID (PUBLIC_VAPID_PUBLIC_KEY) no tiene formato válido: debe ser base64url (65 bytes), no un PEM ni JSON. Regenera el par con «npx web-push generate-vapid-keys --json».'
		};
	}

	const reg = await navigator.serviceWorker.ready;
	let sub = await reg.pushManager.getSubscription();
	// Si ya hay suscripción pero fue creada con OTRA clave VAPID (p. ej. después
	// de regenerar el par), reutilizarla es inútil: el push falla siempre con
	// 403 VapidPkHashMismatch. Se regenera la suscripción en ese caso.
	if (sub && !suscripcionUsaLlaveActual(sub, clave)) {
		await sub.unsubscribe().catch(() => undefined);
		sub = null;
	}
	if (!sub) {
		sub = await reg.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: clave
		});
	}
		const datos = sub.toJSON();
		const endpoint = datos.endpoint;
		const p256dh = datos.keys?.p256dh;
		const auth = datos.keys?.auth;
		if (!endpoint || !p256dh || !auth) {
			return { ok: false, error: 'La suscripción no trajo las claves necesarias.' };
		}

		const res = await fetch('/api/push/suscribir', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ endpoint, p256dh, auth })
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok) {
			return { ok: false, error: body?.error ?? 'No se pudo guardar la suscripción.' };
		}
		return { ok: true };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'No se pudo activar las notificaciones.' };
	}
}
