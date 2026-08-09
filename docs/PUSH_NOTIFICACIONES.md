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
