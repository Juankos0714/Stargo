import { env } from '$env/dynamic/public';
import { browser } from '$app/environment';

/**
 * Web Push (Fase 15).
 *
 * `suscribirPush()` pide permiso de notificaciones, registra el pushManager
 * (applicationServerKey = VAPID público) y guarda la suscripción en
 * `push_subscriptions` vía POST /api/push/suscribir. Con la PWA instalada,
 * las notificaciones llegan aunque la app esté cerrada.
 */

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

		const reg = await navigator.serviceWorker.ready;
		let sub = await reg.pushManager.getSubscription();
		if (!sub) {
			sub = await reg.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: env.PUBLIC_VAPID_PUBLIC_KEY
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
