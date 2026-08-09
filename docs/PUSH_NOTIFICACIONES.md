# Notificaciones push (Fase 15) — guía de despliegue

La parte de código está lista (migración, Edge Function, service worker, UI),
pero tres piezas se configuran a mano en el dashboard de Supabase y en el
entorno. Sigue este orden:

## 1. Aplicar las migraciones nuevas

En el SQL Editor del proyecto de Supabase (producción y el de pruebas si lo
tienes) ejecutar en orden:

1. `supabase/migrations/20260811000000_fase14_tipo_servicio_recargos.sql`
   (tipo de servicio + recargos obligatorios).
2. `supabase/migrations/20260812000000_fase15_push_notificaciones.sql`
   (tablas `notificaciones` y `push_subscriptions`, triggers y RLS).

> La suite de RLS/integración corre contra una base REAL: solo pasa las
> pruebas nuevas de Fase 14/15 después de aplicar estas migraciones al
> proyecto de pruebas (`supabase db push` o SQL Editor).

## 2. Claves VAPID

```bash
npx web-push generate-vapid-keys --json
# → { "publicKey": "...", "privateKey": "..." }
```

- **Cliente**: `PUBLIC_VAPID_PUBLIC_KEY` en el entorno de la app (Vercel) con
  el `publicKey`.
- **Edge Function** (Supabase → Edge Functions → Secrets de `send-push`):
  - `VAPID_PUBLIC_KEY` (el mismo `publicKey`)
  - `VAPID_PRIVATE_KEY` (el `privateKey` — NUNCA en el bundle del cliente)
  - `VAPID_SUBJECT` (p. ej. `mailto:admin@stargo.app`)

## 3. Database Webhook → send-push

Supabase → Database → Webhooks → Create:

- **Table**: `public.notificaciones`
- **Events**: `INSERT`
- **URL**: `https://<project-ref>.functions.supabase.co/send-push`
- **Method**: `POST`
- **Headers**: `Content-Type: application/json`

La Edge Function ya está desplegada con `verify_jwt = false`
(`supabase/config.toml`), que es lo que el webhook necesita (no lleva token).

## 4. Plantillas de correo (Auth)

Supabase → Authentication → Emails → Templates:

- **Confirm signup** y **Invite**: revisar que `Site URL` /
  `redirectTo` apunten al dominio real de producción (p. ej.
  `https://stargo.app/login`) para que el flujo de invitación y confirmación
  cierre correctamente.
- Confirmar que **Confirm email** esté activado si se usa el registro por
  `signUp`.

## 5. Cómo probar el flujo completo

1. El admin invita un domiciliario (panel → Domiciliarios → Correo de
   invitación). El repartidor recibe el correo, crea su contraseña y entra.
2. Desde el panel, el repartidor abre la campanita → «Activar notificaciones
   push» (permite el permiso del navegador).
3. El admin crea un pedido en `/nuevo-pedido` → al admin le llega push
   «Nuevo pedido».
4. El admin asigna el pedido al repartidor → al repartidor le llega push
   «Pedido X · Asignado». Con la PWA instalada y cerrada la notificación
   aparece igual (Web Push real).

## Notas

- `notificaciones.destinatario_id` es SIEMPRE un `auth.uid()` (la del admin
  o la del repartidor), no el id de la fila de `domiciliarios`: así RLS
  (`auth.uid()`) y `push_subscriptions.usuario_id` coinciden.
- La suscripción se limpia sola cuando el navegador la invalida (404/410
  desde la Edge Function).
- Si `PUBLIC_VAPID_PUBLIC_KEY` está vacío, el botón de activar push no
  aparece y el resto de la app funciona igual.

## Sonido por plataforma

El sonido de las notificaciones depende de la plataforma y de si la app está
abierta o no. Resumen de cómo funciona y de qué depende cada caso:

| Plataforma | App cerrada / segundo plano | App abierta (primer plano) |
|---|---|---|
| Android | Banner + sonido del sistema (lo dispara `vibrate` de `showNotification`) | Banner + campana local (Web Audio), vía Realtime o respaldo del SW |
| iPhone (iOS) | Banner + sonido del sistema — sujeto al interruptor de silencio y a que la PWA esté INSTALADA | Banner + campana local (Web Audio) |
| Computadora | Banner + sonido según el SO y la configuración de Chrome | Banner + campana local (Web Audio) |

### Sonido en iPhone (iOS)

Apple limita el sonido de las notificaciones web en iOS:

- **`sound` y `vibrate` de `showNotification()` se IGNORAN en iOS.** La app
  no puede reproducir un audio personalizado en la notificación del sistema
  (a diferencia de Android, donde `vibrate` dispara el tono del sistema).
  iOS toca el sonido del sistema por defecto — o nada si el iPhone está en
  silencio (interruptor lateral) o la app tiene las notificaciones en modo
  silencioso desde Ajustes → Notificaciones → StarGo.
- **Web Push en iOS solo funciona en la PWA INSTALADA** (agregada a pantalla
  de inicio), iOS 16.4+. En Safari normal no existe `PushManager`: el panel
  de notificaciones muestra un aviso («Notificaciones solo en la app
  instalada») explicando cómo instalar la app.
- **Con la app ABIERTA**, el sonido lo reproduce la propia app vía Web Audio
  (`src/lib/sonido.ts`): la campana ding-dong. iOS exige que el usuario toque
  la pantalla al menos una vez para desbloquear el AudioContext; si la app
  vuelve de segundo plano, el siguiente toque lo vuelve a desbloquear
  (los gestos se registran de forma persistente, no con `once`).

## Diagnóstico: «el push no llega con la app cerrada»

Si la notificación SOLO suena al entrar a la app (campana local vía Realtime),
pero NO llega con la app cerrada, el problema está en la cadena del Web Push
(webhook → Edge Function → suscripción). El diagnóstico prueba TODOS los
eslabones de una vez y dice cuál está roto.

### Antes de diagnosticar: aplicar la migración y redesplegar la función

Dos piezas del diagnóstico requieren actualizar el proyecto en Supabase
(no están desplegadas automáticamente):

1. **Ejecutar la migración fase 17** en el SQL Editor de Supabase:
   `supabase/migrations/20260816000000_fase17_diagnostico_push.sql`
   (permite que el endpoint de prueba inserte una notificación dirigida al
   propio usuario para ejercitar el webhook real).
2. **Redesplegar la Edge Function** con la CLI (aplica además
   `verify_jwt = false` del `config.toml`, que si la desplegaste desde el
   dashboard puede no haberse aplicado):

   ```bash
   supabase login
   supabase functions deploy send-push
   ```

   (Las secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` se
   conservan al redesplegar.)

### Cómo diagnosticar

**Opción A — desde el panel (recomendada):** abre la campanita → pulsa
«Enviar notificación de prueba». El servidor verifica las suscripciones,
comprueba el pareado VAPID, inserta una notificación de prueba (flujo real
webhook → send-push) y envía un push directo. Con la app CERRADA deberían
llegar DOS banners: «Prueba (directo)» y «Prueba (webhook)».

**Opción B — desde la terminal:**

```bash
BASE_URL=https://tu-app.vercel.app ADMIN_EMAIL=... ADMIN_PASSWORD=... bun run test:push
```

Hace login real, llama a `POST /api/push/probar` y reporta cada eslabón.

### Árbol de decisión

| Diagnóstico | Eslabón roto | Qué hacer |
|---|---|---|
| `SIN SUSCRIPCIÓN` | El navegador nunca guardó su suscripción | Activar el push desde la campanita; en iOS requiere la app instalada en pantalla de inicio |
| `EDGE FUNCTION INALCANZABLE` | send-push no está desplegada o no responde | `supabase functions deploy send-push`; si está desplegada, revisa la URL del proyecto (`PUBLIC_SUPABASE_URL`) |
| `VAPID SIN CONFIGURAR` | Faltan las secrets VAPID | Supabase → Edge Functions → Secrets de `send-push`: añade `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| `FALTA PUBLIC_VAPID_PUBLIC_KEY` | La variable no está en el entorno de la app | Vercel → Settings → Environment Variables: añadir `PUBLIC_VAPID_PUBLIC_KEY` con el `publicKey` del par |
| `CLAVE VAPID INVÁLIDA` | `PUBLIC_VAPID_PUBLIC_KEY` es un PEM/JWK o está truncada | Pegar el `publicKey` DESNUDO (base64url, 65 bytes) generado con `npx web-push generate-vapid-keys --json` |
| `VAPID DESPAREJADO` | La clave pública de Vercel y la privada de Supabase NO son la misma pareja (fallo silencioso 401/403: la causa nº 1) | Copia el MISMO `publicKey` a Vercel y a send-push, o regenera el par con `npx web-push generate-vapid-keys --json` y distribúyelo bien (privateKey SOLO en Supabase) |
| `MIGRACIÓN NO EJECUTADA` | El INSERT de prueba falló por permisos | Ejecutar `20260816000000_fase17_diagnostico_push.sql` en el SQL Editor |
| `EDGE INALCANZABLE EN ENVÍO` | El diagnóstico VAPID fue OK pero el envío directo falló por red/error | Reintentar; si persiste, revisar los logs de `send-push` en Supabase |
| `ENVÍO FALLIDO` | VAPID OK pero la Edge Function no envió (suscripciones expiradas) | Reabrir la campanita y pulsar «Activar notificaciones push» para regenerar la suscripción |
| `TODO OK` pero no llega el «(webhook)» | El WEBHOOK no dispara | Supabase → Database → Webhooks: evento `INSERT`, tabla `public.notificaciones`, URL `https://<ref>.functions.supabase.co/send-push`, método POST, `Content-Type: application/json` |
| `TODO OK` y llegan ambos | Cadena completa funcionando | El problema era la plataforma/dispositivo: revisa el sonido por plataforma (tabla de arriba) |

> El banner «(directo)» viaja por la Edge Function sin pasar por el webhook;
> el «(webhook)» pasa por el flujo real (INSERT → webhook → send-push). Si
> llega el primero pero no el segundo, el webhook del dashboard es el eslabón
> roto. Si el diagnóstico marca `VAPID DESPAREJADO`, ese es casi con
> seguridad el motivo por el que «no llega nada»: la clave pública con la que
> el navegador se suscribió no corresponde con la privada que firma.

### Volumen y silencio de la campana local

El panel de notificaciones (campanita) incluye un control de volumen de la
campana local (0-100 %) con botón de silencio. Se persiste en `localStorage`
(`stargo_volumen_sonido`), es por dispositivo/navegador y solo afecta al
sonido que reproduce la app con ella ABIERTA — el push del sistema (app
cerrada) sigue sonando según el SO, independientemente de este control.
Implementación: `obtenerVolumenSonido()`, `fijarVolumenSonido()` y
`previsualizarSonido()` en `src/lib/sonido.ts`; la campana usa
`MASTER × volumen` como ganancia y `sonarNotificacion()` no crea audio si el
volumen es 0.

### Respaldo del sonido en primer plano (service worker → app)

Con la app abierta, el sonido normalmente lo dispara Realtime (INSERT en
`notificaciones`). Pero si Realtime está desconectado (red, suspensión), el
push del sistema es la única señal que llega — y con la app en foco los
navegadores silencian la notificación del sistema. Por eso:

1. El SW, al recibir un push, busca la PRIMERA ventana visible controlada y
   le envía `postMessage({ tipo: 'sonar' })` (`src/service-worker.ts`).
2. `+layout.svelte` registra el listener (`registrarSonidoSW()` en
   `src/lib/sonido.ts`): el mensaje reproduce la campana local.
3. El cooldown de 2 s de `sonarNotificacion()` evita el doble sonido si
   Realtime también alcanzó a sonar.
4. El banner del sistema SIEMPRE se muestra (aunque haya ventana visible):
   es la vía que garantiza el aviso con la app cerrada o en segundo plano,
   que es donde la app no puede reproducir audio.

Para probar el sonido en un iPhone real:

1. Instala la PWA (Compartir → «Agregar a pantalla de inicio») y entra desde ahí.
2. Activa las notificaciones push desde la campanita (pide el permiso de iOS).
3. Crea un pedido de prueba con la app abierta: debe sonar la campana.
4. Cierra la app y crea otro pedido: la notificación del sistema debe
   aparecer (con el sonido del sistema, sujeto al interruptor de silencio).
