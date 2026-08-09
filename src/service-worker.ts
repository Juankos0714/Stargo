/// <reference types="@sveltejs/kit" />
import { build, files, version } from '$service-worker';

/**
 * Service worker (Fase 8): instalación PWA + offline básico.
 *
 * Estrategia:
 *  - Precarga en el instal: JS/CSS del build + estáticos + /offline.html.
 *  - Navegaciones: network-first con respaldo en caché y, si no hay nada,
 *    se sirve /offline.html (pantalla «sin conexión»).
 *  - Assets estáticos: cache-first.
 *  - /api/*: solo red (nunca se cachean datos de sesión ni de pedidos).
 */

const CACHE = `stargo-${version}`;
const OFFLINE_URL = '/offline.html';

// Archivos grandes que no aportan al offline básico (se omiten del precache).
const EXCLUIDOS = new Set(['/icons/og-image.png', '/icons/icon-1024.png']);

// OJO: `files` (de $service-worker) YA incluye /offline.html porque vive en
// static/. Agregarlo de nuevo duplicaba la URL y cache.addAll() fallaba con
// InvalidStateError (duplicate requests), abortando el install del SW.
// El Set elimina cualquier duplicado (build + files + offline) sin perder nada.
const PRECACHE: string[] = [
	...new Set([...build, ...files.filter((f) => !EXCLUIDOS.has(f)), OFFLINE_URL])
];

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

async function cacheFirst(req: Request): Promise<Response> {
	const cache = await caches.open(CACHE);
	const cached = await cache.match(req);
	if (cached) return cached;
	// Sin try/catch un fetch que falle (sin red, asset roto, 5xx) rechaza la
	// promesa de respondWith y Chrome logra «Uncaught (in promise) Failed to
	// fetch» sin dejar que la app sirva el fallback.
	try {
		const res = await fetch(req);
		if (res.ok) cache.put(req, res.clone());
		return res;
	} catch {
		return Response.error();
	}
}

async function navegacion(req: Request): Promise<Response> {
	const cache = await caches.open(CACHE);
	try {
		const res = await fetch(req);
		if (res.ok) cache.put(req, res.clone());
		return res;
	} catch {
		// Sin red: primero la copia cacheada de la página; si nunca se visitó,
		// se muestra la pantalla «sin conexión».
		const cached = await cache.match(req);
		if (cached) return cached;
		return (await cache.match(OFFLINE_URL)) ?? Response.error();
	}
}

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;

	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return;

	// Datos de la API: solo red (auth, pedidos, recargos, reportes).
	if (url.pathname.startsWith('/api/')) return;

	if (req.mode === 'navigate') {
		event.respondWith(navegacion(req));
		return;
	}

	event.respondWith(cacheFirst(req));
});

// ---------- Web Push (Fase 15) ----------
// La Edge Function send-push envía { title, body, icon, badge, data:{url} }.
// iOS Safari (16.4+) IGNORA `sound` y `vibrate` de showNotification: Apple no
// permite sonido personalizado en web push, solo toca el sonido del sistema
// (o nada si el iPhone está en silencio). El sonido personalizado con la app
// ABIERTA lo reproduce la propia app vía Web Audio (src/lib/sonido.ts).
// Estas opciones se mantienen para los navegadores que sí las soportan
// (Android usa `vibrate` para el tono del sistema; Firefox soporta `sound`).
interface DatosPush {
	title?: string;
	body?: string;
	icon?: string;
	badge?: string;
	data?: { url?: string; pedidoId?: string | null };
}

self.addEventListener('push', (event) => {
	let datos: DatosPush = {};
	try {
		datos = event.data ? (event.data.json() as DatosPush) : {};
	} catch {
		datos = { body: event.data?.text() };
	}

	event.waitUntil(
		(async () => {
			// Con la app ABIERTA en una pestaña visible, el sistema silencia la
			// notificación (Chrome/Android/iOS) y el sonido lo pone la app
			// (src/lib/sonido.ts). Normalmente lo dispara Realtime; si Realtime
			// está desconectado (red, suspensión), este mensaje es el respaldo:
			// la página reproduce la campana local. sonarNotificacion() tiene
			// cooldown de 2 s, así que si Realtime ya sonó, esto se descarta
			// (nunca hay doble campana).
			//
			// Solo se avisa a la PRIMERA ventana visible controlada por este SW:
			//  - sin includeUncontrolled: los clientes no controlados NO reciben
			//    postMessage (un mensaje a ellos se pierde sin más).
			//  - un solo destino evita que dos ventanas visibles (multi-monitor)
			//    suenen a la vez (el cooldown de la campana es por pestaña).
			const ventanas = await self.clients.matchAll({ type: 'window' });
			const visible = ventanas.find((cliente) => cliente.visibilityState === 'visible');
			if (visible) visible.postMessage({ tipo: 'sonar', datos });

			// El banner del sistema SIEMPRE se muestra: es la vía que garantiza
			// el aviso cuando la app está cerrada o en segundo plano (ahí la app
			// no puede reproducir audio). En Android `vibrate` dispara el tono
			// del sistema; en iOS se ignoran vibrate/sound (limitación de Apple:
			// el iPhone toca su sonido del sistema o nada si está en silencio);
			// en desktop el sonido lo pone el sistema operativo.
			await self.registration.showNotification(datos.title ?? 'StarGo', {
				body: datos.body ?? 'Tienes una nueva notificación de StarGo.',
				icon: datos.icon ?? '/icons/icon-192.png',
				badge: datos.badge ?? '/icons/icon-192.png',
				vibrate: [150, 80, 150],
				sound: new URL('/sonidos/notificacion.wav', self.location.origin).href,
				data: datos.data ?? {}
			});
		})()
	);
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = event.notification.data?.url ?? '/';

	event.waitUntil(
		(async () => {
			const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			for (const win of wins) {
				try {
					await win.navigate(url);
					await win.focus();
					return;
				} catch {
					// La ventana pudo no estar controlada por este SW: seguir.
				}
			}
			await self.clients.openWindow(url);
		})()
	);
});
