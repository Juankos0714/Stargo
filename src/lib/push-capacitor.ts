/**
 * Push notifications nativas para Capacitor (FCM unificado).
 *
 * Reemplaza Web Push/VAPID dentro de las apps nativas. FCM maneja
 * Android nativo y reenvía a APNs para iOS, así que el backend solo
 * necesita un cliente de FCM.
 *
 * Este módulo SOLO se usa cuando la app corre dentro de Capacitor.
 * En el navegador/PWA se usa push.ts (Web Push/VAPID).
 */

import { Capacitor } from '@capacitor/core';
import { PushNotifications, type Token } from '@capacitor/push-notifications';
import { api } from '$lib/api';

/** ¿Estamos corriendo dentro de Capacitor (app nativa)? */
export function esCapacitor(): boolean {
	return Capacitor.isNativePlatform();
}

/**
 * Registra el dispositivo para push notifications y guarda el token
 * en el backend vía POST /api/push/registrar-token.
 *
 * Debe llamarse desde un gesto del usuario (clic) o después del login.
 * Devuelve { ok, token?, error? }.
 */
export async function registrarPushCapacitor(): Promise<{
	ok: boolean;
	token?: string;
	error?: string;
}> {
	if (!esCapacitor()) {
		return { ok: false, error: 'Este método solo funciona en apps nativas.' };
	}

	try {
		// 1. Solicitar permiso
		const permiso = await PushNotifications.requestPermissions();
		if (permiso.receive !== 'granted') {
			return {
				ok: false,
				error: 'Permiso de notificaciones denegado. Actívalo desde ajustes del dispositivo.'
			};
		}

		// 2. Registrar para recibir tokens
		await PushNotifications.register();

		// 3. Esperar el token FCM
		const token = await new Promise<string>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Timeout esperando token FCM (15 s)')), 15_000);

			PushNotifications.addListener('registration', (t: Token) => {
				clearTimeout(timeout);
				resolve(t.value);
			});

			PushNotifications.addListener('registrationError', (err) => {
				clearTimeout(timeout);
				reject(new Error(`Error de registro FCM: ${JSON.stringify(err)}`));
			});
		});

		// 4. Guardar el token en el backend
		const plataforma = Capacitor.getPlatform() as 'android' | 'ios';
		const r = await api.post('/api/push/registrar-token', {
			token,
			plataforma
		});

		if (r.error) {
			return { ok: false, token, error: r.error };
		}

		return { ok: true, token };
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : 'No se pudo registrar push nativo.'
		};
	}
}

/**
 * Verifica si el dispositivo ya tiene un token registrado
 * consultando el backend.
 */
export async function estaSuscritoCapacitor(): Promise<boolean | null> {
	if (!esCapacitor()) return null;
	try {
		const r = await api.get<{ tiene_token: boolean }>('/api/push/estado');
		return r.data?.tiene_token ?? null;
	} catch {
		return null;
	}
}

/**
 * Configura los listeners para recibir notificaciones push
 * cuando la app está en foreground.
 *
 * Llamar una vez al inicio de la app (en el layout raíz o en el login).
 */
export function escucharPushForeground(): void {
	if (!esCapacitor()) return;

	PushNotifications.addListener('pushNotificationReceived', (notification) => {
		// La notificación se muestra nativamente por el sistema.
		// Aquí se puede agregar lógica adicional (actualizar badge, etc.).
		console.log('[Push] Recibida en foreground:', notification.title);
	});

	PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
		// El usuario tocó la notificación. Navegar a la pantalla relevante.
		const url = action.notification.data?.url;
		if (url && typeof window !== 'undefined') {
			window.location.href = url;
		}
	});
}
