# Monitoreo, alertas y observabilidad (Parte 9)

La "red de seguridad": cómo detectar un fallo en minutos, no cuando un cliente
se queja. Esta guía cubre qué se implementó, cómo configurarlo (Sentry, webhook,
cron) y cómo **probar que las alertas llegan** (el entregable de la parte).

## Arquitectura

```
┌──────────────────────────────┐     ┌───────────────────────────────────────┐
│  Frontend (navegador)        │     │  Backend (SvelteKit en Vercel)        │
│  hooks.client.ts             │     │  hooks.server.ts                       │
│   ├─ Sentry (si DSN)         │     │   ├─ Sentry (si DSN)                  │
│   └─ POST /api/errores       │ ──► │   └─ registra 5xx/429 en errores_app  │
└──────────────────────────────┘     └──────────────┬────────────────────────┘
                                                     │
                     ┌───────────────────────────────┴──────────────────┐
                     ▼                                                  ▼
        ┌───────────────────────┐                        ┌───────────────────────────┐
        │  Supabase             │                        │  Cron de Vercel (5 min)   │
        │  errores_app          │◄── /api/errores        │  /api/cron/alertas        │
        │  alertas (bitácora)   │◄── RPC registrar_alerta│   ├─ pendientes vencidos   │
        │  historial_tarifas    │◄── trigger de auditoría│   ├─ tasa 5xx / rate limit │
        │                       │                        │   └─ Supabase caído       │
        └───────────────────────┘                        └───────────┬───────────────┘
                                                    webhook + Sentry ─┴─► Slack/Discord/Telegram
```

El dashboard **Admin → Métricas** (`/admin/metricas`) muestra pedidos activos,
tiempos promedio de asignación/entrega, errores por minuto, últimas alertas y la
auditoría de cambios de tarifas.

## 1. Migración de BD

```bash
supabase db reset        # local: aplica supabase/migrations/ (incluye la Fase 9)
# o en el dashboard: SQL Editor → pega supabase/migrations/20260806000000_fase9_monitoreo.sql
```

Crea:
- `errores_app` — registro de errores (solo el RPC `registrar_error` inserta; SELECT solo admin).
- `alertas` — bitácora de alertas (RPC `registrar_alerta`; SELECT solo admin).
- `historial_tarifas` — auditoría de la matriz de tarifas + trigger `trg_tarifas_audit`
  (INSERT/UPDATE/DELETE con valores antes/después y `auth.uid()` como autor).
- RPCs del cron: `pedidos_pendientes_para_alerta`, `errores_recientes_para_alerta`,
  `alerta_reciente` (ejecutables por anon — el cron corre con el cliente anónimo).

## 2. Sentry (error tracking centralizado)

1. Crea un proyecto **SvelteKit** en [sentry.io](https://sentry.io).
2. En Vercel → Settings → Environment Variables (y en `.env` local):

   | Variable | Qué hace |
   |---|---|
   | `PUBLIC_SENTRY_DSN` | Activa Sentry en cliente y servidor. Vacía = sin Sentry. |
   | `SENTRY_AUTH_TOKEN` | Habilita la subida de sourcemaps en el build (`@sentry/vite-plugin`). |
   | `SENTRY_ORG` / `SENTRY_PROJECT` | Org y proyecto para la subida de sourcemaps. |

3. Sin DSN la app funciona exactamente igual (cero envíos); el build sin
   `SENTRY_AUTH_TOKEN` es un build normal (sourcemaps locales no se suben).

Lo que captura:
- **Cliente**: errores no manejados, promesas rechazadas y errores de load/acción
  (`hooks.client.ts`) — además se reportan a `errores_app` vía `/api/errores`.
- **Servidor**: `sentryHandle()` + `handleErrorWithSentry` en `hooks.server.ts`; los
  5xx y rate limits (429) además se registran en `errores_app`.

**Alertas de 5xx en Sentry**: Dashboard → **Alerts → Create Alert → Metric Alert**:
condición `event.type = error` y `http.status_code` ≥ 500, umbral p. ej. 10 eventos
en 5 minutos, acción = email/Slack/PagerDuty.

## 3. Webhook de alertas (Slack / Discord / Telegram)

`ALERTAS_WEBHOOK_URL` recibe un JSON `{ text: "..." }`:

- **Slack**: Apps → Crear app → Incoming Webhooks → copia la URL del webhook.
- **Discord**: Ajustes del canal → Integraciones → Webhooks → Nueva URL.
- **Telegram**: `https://api.telegram.org/bot<TOKEN>/sendMessage` con `chat_id` (el
  motor envía `{text}`; Telegram lo acepta con `parse_mode` por defecto).

## 4. Cron de alertas (Vercel)

`vercel.json` declara el cron:

```json
{ "crons": [{ "path": "/api/cron/alertas", "schedule": "*/5 * * * *" }] }
```

- Vercel invoca el cron con `Authorization: Bearer <CRON_SECRET>` — define
  `CRON_SECRET` en las env vars del proyecto. El endpoint también acepta
  `x-cron-secret` o `?secret=` (útil para probar con curl).
- Sin `CRON_SECRET` el endpoint responde 503 (cron desactivado, la app sigue bien).
- ⚠️ **Plan de Vercel**: los crons con intervalo < 1 día (`*/5 * * * *`) requieren
  el plan **Pro**. En el plan Hobby Vercel solo permite un cron diario — en ese
  caso cambia la frecuencia en `vercel.json` a `0 * * * *` (cada hora) o
  `0 0 * * *` (diaria) según cuánta latencia de detección aceptes.
- Umbrales configurables: `ALERTAS_PENDIENTE_MINUTOS` (30), `ALERTAS_UMBRAL_5XX` (5),
  `ALERTAS_UMBRAL_RATE_LIMIT` (1), `ALERTAS_COOLDOWN_MIN` (60), `ALERTAS_ENTORNO` (local).

Prueba local sin esperar al cron:

```bash
curl -H "x-cron-secret: TU_SECRETO" "http://127.0.0.1:5173/api/cron/alertas?prueba=1"
```

## 5. Verificar el entregable: que la alerta llegue

Con la app desplegada (o el preview local con `ALERTAS_WEBHOOK_URL` configurado):

```bash
BASE_URL=https://tu-app.vercel.app \
CRON_SECRET=tu-secreto \
ADMIN_EMAIL=admin@tu-app.com ADMIN_PASSWORD=... \
bun run test:alertas
```

El script hace las dos comprobaciones del entregable:

1. `GET /api/cron/alertas?prueba=1` → registra `alerta_prueba` en la bitácora y la
   envía al webhook (debes verla en Slack/Discord/Telegram).
2. `POST /api/alertas/probar` (admin) → provoca un error 500 a propósito; debe
   aparecer en **Sentry → Issues** y subir los "errores por minuto" del dashboard.

También puedes provocar la alerta de negocio de verdad (sin `?prueba=1`): deja un
pedido pendiente más de `ALERTAS_PENDIENTE_MINUTOS` minutos sin asignar y espera el
siguiente tick del cron (o llámalo con curl) — recibirás `pedidos_pendientes_sin_asignar`.

## 6. RLS de las tablas nuevas (seguridad)

| Tabla | Lectura | Escritura |
|---|---|---|
| `errores_app` | solo admin | solo RPC `registrar_error` (anon/authenticated) |
| `alertas` | solo admin | solo RPC `registrar_alerta` (anon/authenticated) |
| `historial_tarifas` | solo admin | solo el trigger (SECURITY DEFINER) |

La suite `tests/rls/monitoreo.test.ts` verifica esta matriz contra la base real
(job `rls-tests` del CI) — cualquier cambio de políticas se mergea solo si pasa.

## 7. Costos y límites (plan actual)

- **Sentry**: plan gratuito (Developer) con 5k errores/mes y 1 usuario; suficiente
  para arrancar. Las alertas de 5xx usan el sistema de Alertas (incluido).
- **Realtime/errores_app**: `errores_app` es una tabla normal de Postgres; el cron
  consulta solo las últimas N filas (índice en `created_at`), no hay costo extra.
- **Webhook**: gratuito (Slack/Discord/Telegram).

## 8. Dashboard (Admin → Métricas)

- 4 tarjetas: pedidos activos, tiempo promedio de asignación, tiempo promedio de
  entrega, errores por minuto.
- Lista de últimas alertas (evento, nivel, detalle, fecha).
- Auditoría de tarifas: quién cambió qué y cuándo (`historial_tarifas`) — para
  investigar rápido si un cálculo salió mal (sección 14 del documento funcional).
- Refresco cada 30 s + Realtime (cambios de pedidos).
