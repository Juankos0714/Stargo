# StarGo — Plataforma de domicilios

Plataforma de pedidos y tarifas de domicilios para **Armenia, Quindío**.
SvelteKit 5 (runes) + Supabase (Auth, Postgres/RLS, Realtime) + Capacitor (app nativa).

---

## 📱 Descargar la app

StarGo está disponible en tres formatos: web (PWA), Android (APK) e iOS (TestFlight).

### Opción 1 — App web (PWA) ⚡

La forma más rápida. Funciona desde cualquier navegador moderno.

1. Abre **[stargo.vercel.app](https://stargo.vercel.app)** en tu navegador.
2. **Android**: toca el menú ⋮ → *Agregar a pantalla de inicio*.
3. **iPhone**: toca el botón de compartir ↗ → *Agregar a pantalla de inicio*.
4. **Computador**: haz clic en el ícono de instalar en la barra de direcciones.

> La PWA se instala como una app, abre en pantalla completa y recibe
> notificaciones push (desde iOS 16.4+ solo funciona si la instalaste
> desde la pantalla de inicio).

### Opción 2 — Android (APK) 🤖

Para instalar directamente sin pasar por Google Play.

1. Descarga el archivo APK desde el enlace de tu administrador.
2. Abre el archivo en tu teléfono (es posible que debas habilitar
   *Instalar apps de fuentes desconocidas* en Ajustes → Seguridad).
3. Sigue las instrucciones en pantalla.
4. Abre StarGo desde el ícono en tu pantalla de inicio.

> **Push nativo**: las notificaciones funcionan aunque la app esté cerrada.
> Requiere que el administrador haya configurado Firebase Cloud Messaging.

### Opción 3 — iOS (TestFlight) 🍎

Para probar la versión beta en iPhone.

1. Instala la app **[TestFlight](https://apps.apple.com/app/testflight/id899247664)** desde la App Store (es gratis).
2. Abre el enlace de invitación que te comparta el administrador.
3. Toca *Aceptar* en TestFlight y luego *Instalar*.
4. Abre StarGo desde tu pantalla de inicio.

> **Push nativo**: las notificaciones push nativas funcionan con la app
> en segundo plano y cuando está cerrada.

### Comparación rápida

| Característica | PWA (Web) | Android (APK) | iOS (TestFlight) |
|---|---|---|---|
| **Requiere instalación** | Sí (desde el navegador) | Sí (descarga APK) | Sí (TestFlight + app) |
| **Funciona sin conexión** | Básico (offline) | Sí | Sí |
| **Notificaciones push** | Sí (Web Push) | Sí (FCM nativo) | Sí (APNs nativo) |
| **Tiempo de carga** | Rápido | Instantáneo | Instantáneo |
| **Actualizaciones** | Automáticas | Requiere nuevo APK | Automáticas vía TestFlight |
| **Compatibilidad** | Cualquier navegador | Android 8+ | iOS 16.4+ |

> **Recomendación**: si solo necesitas hacer pedidos y consultar estados,
> la **PWA** es suficiente. Si quieres notificaciones push confiables en
> segundo plano o la usas a diario, instala la **app nativa**.

---

## Qué incluye

- **Tarifas (Fase 2)**: CRUD de Zonas, Barrios y matriz de Tarifas (admin) + cálculo automático
  `POST /api/calcular_tarifa` con fallback simétrico (misma lógica en SQL `public.calcular_tarifa()`).
- **Pedidos (Fase 3)**: creación pública (`/nuevo-pedido`) con tarifa recalculada en la BD, código
  de seguimiento, consulta de estado (`/consultar-estado`) y panel admin con `historial_estados`.
- **Domiciliarios (Fase 4)**: CRUD de repartidores (admin), asignación de pedidos
  (`pendiente → asignado`), máquina de estados del domiciliario (`aceptado → recogido → en_camino → entregado`)
  validada en la BD (RPC `transicionar_pedido`), botón de navegación a Google Maps y panel `/domiciliario`.
- **Tiempo real (Fase 5)**: Supabase Realtime en los tres paneles (admin, domiciliario y cliente)
  con indicador de conexión y reconexión automática.
- **Reportes (Fase 6)**: dashboard admin con estadísticas de operación (pendientes, en proceso,
  entregados/cancelados del día, ingresos, domiciliarios disponibles) y módulo `/admin/reportes`
  con filtros por rango de fechas, series diarias, desglose por domiciliario y exportación a CSV
  (`/api/reportes` y `/api/reportes/csv`). No requiere migración de BD: agrega sobre las tablas existentes.
- **Recargos y cancelaciones (Fase 7)**: recargos configurables (compra, tiempo de espera, paradas,
  peso, pagos) con CRUD en `/admin/recargos`; el cliente los elige en `/nuevo-pedido` y ve el desglose
  «base + recargos = total» con la advertencia de que es un **estimado** (la última palabra la tiene el
  domiciliario). Cancelación con motivo desde el cliente (`/consultar-estado`, solo pedidos pendientes)
  y desde el admin, con `motivo_cancelacion` en el historial. Los reportes ya suman el total (con recargos).
- **Auth completa**: Supabase Auth (email/password) + cookies httpOnly + roles `es_admin()` / `es_domiciliario()`.
- **PWA y seguridad (Fase 8)**: service worker con offline básico (pantalla «sin conexión» + banner),
  manifest instalable (Android/iOS/Desktop), CSP + headers de seguridad, auditoría RLS
  (`supabase/audit_rls.sql`) y plan de QA por rol (`docs/QA_SEGURIDAD_FASE8.md`).
- **Pruebas unitarias (Parte 1)**: lógica de negocio pura extraída a `src/lib/logic` (tarifas,
  recargos, máquina de estados por rol, validadores de formularios y formateo) con suite Vitest
  de cobertura ≥90% que corre en cada commit (el CI falla si baja).
- **Pruebas de RLS (Parte 2)**: suite `tests/rls` con el cliente de Supabase JS contra **Supabase
  local** (CLI + Docker): matriz de acceso por tabla y rol, aislamiento entre clientes/domiciliarios,
  constraints, triggers y RPCs contra la base real. La corre el job `rls-tests` del CI en cada
  push/PR — ningún cambio de políticas RLS se mergea sin que pase.
- **Pruebas de integración (Parte 3)**: suite `tests/integration` que compila la app apuntando al
  Supabase local, levanta `vite preview` y prueba el flujo completo **request → Supabase → response**
  por HTTP real: login y cookies httpOnly, sincronización de sesión SSR (refresco automático con
  access corrupto), guards de `load` (redirect a `/login` con sesión inválida, nunca 500), endpoints
  de pedidos con validación antes de tocar la BD, visibilidad por rol con RLS real y el contrato de
  errores del cliente (`api.ts`) que protege la UI. La corre el job `integration-tests` del CI.
- **Pruebas de componentes (Parte 4)**: suite `tests/ui` con **jsdom + @testing-library/svelte** para
  los componentes críticos (los que tocan dinero o cambian estado): `SearchSelect`, `BadgeEstado`
  (los 7 estados), `HistorialTimeline`, el formulario de pedido (`nuevo-pedido`: cálculo de tarifa al
  elegir ambos barrios, estado de carga, error sin tarifa, validación al confirmar, recargos) y la
  tabla de pedidos del admin (filtro por pestañas, contadores, orden, estado vacío). Se extrajeron
  `BadgeEstado` y `HistorialTimeline` como componentes para un único punto de verdad. La corre el
  job de typecheck+tests del CI (`bun run test:ui`), sin necesitar Supabase.
- **Pruebas E2E (Parte 5)**: suite `tests/e2e` con **Playwright** (navegador real) contra la app
  compilada y Supabase local: flujos completos de cliente (crear pedido → tarifa → confirmar),
  admin (asignar domiciliario), domiciliario (aceptar → recogido → en camino → entregado),
  configuración del catálogo (crear zona → barrio → tarifa → el cliente calcula con la tarifa
  nueva), cancelaciones con motivo e historial, y flujo de error sin tarifa. Corre en **Chromium +
  WebKit** y en **viewports desktop + móvil** (la spec: el público usa mucho móvil).
- **Pruebas de Realtime (Parte 6)**: en `tests/e2e/realtime.spec.ts` — propagación de un cambio
  de estado entre dos sesiones de navegador abiertas simultáneamente, aislamiento (RLS de Realtime:
  un domiciliario sin el pedido asignado no lo recibe) y refresh manual. La **checklist manual**
  (reconexión tras caída de red, fugas de suscripciones, Realtime caído → modo "solo refresh manual")
  está en [`docs/CHECKLIST_REALTIME.md`](docs/CHECKLIST_REALTIME.md).
- **Carga y rendimiento (Parte 7)**: scripts `k6` (creación de pedidos en hora pico y cálculo de
  tarifa bajo carga), presupuesto de bundle en CI (`bun run bundle:budget`: JS/CSS/chunk mayor) y
  auditoría Lighthouse de Core Web Vitals (`bun run perf:lighthouse`). Plantilla del reporte con el
  punto de quiebre en [`docs/REPORTE_CARGA.md`](docs/REPORTE_CARGA.md).
- **Post-deploy y smoke (Parte 8)**: endpoint `/api/health` (verifica conexión a Supabase y latencia),
  smoke test post-deploy (`bun run test:smoke` — login por rol, tarifa, pedido de prueba cancelado)
  que corre automáticamente tras cada deploy a producción, E2E crítico contra los previews de Vercel
  en cada PR y feature flags server-side (`src/lib/server/flags.ts`).
- **Monitoreo y alertas (Parte 9)**: Sentry (error tracking de frontend y backend, activo solo con
  `PUBLIC_SENTRY_DSN`), registro centralizado de errores (`errores_app` + `POST /api/errores`),
  cron de alertas (`GET /api/cron/alertas` vía Vercel cron diario `0 0 * * *`, compatible con el plan Hobby) que vigila pedidos sin
  asignar, tasa de 5xx, rate limits y caída de Supabase, notificando por webhook
  (Slack/Discord/Telegram) + Sentry + bitácora `alertas`; dashboard `/admin/metricas` en tiempo
  real (pedidos activos, tiempos promedio de asignación/entrega, errores por minuto) y auditoría
  de cambios de tarifas (`historial_tarifas` + trigger). Verificación del entregable con
  `bun run test:alertas` (provoca un error a propósito y confirma que la alerta llega).
- **Checklist pre-lanzamiento (Parte 10)**: runner go/no-go (`bun run go-no-go`) que ejecuta los
  gates verificables (typecheck, unitarios + cobertura ≥90%, RLS, integración, E2E, bundle) y
  evalúa las verificaciones manuales (Realtime, carga, smoke, alertas, backup, rollback) contra
  fechas registradas con ventana de validez → veredicto **GO/NO-GO** con reporte JSON. Checklist
  completo con criterios, backup de Supabase y plan de rollback de Vercel en
  [`docs/CHECKLIST_GO_NO_GO.md`](docs/CHECKLIST_GO_NO_GO.md), y workflow de release
  `.github/workflows/release-gate.yml` (dispatch manual, corre todo contra Supabase local y sube
  el reporte).

## Estructura

```
src/
├── lib/
│   ├── api.ts                    # Cliente fetch del frontend (resuelve URLs para Capacitor)
│   ├── types.ts                  # Tipos de dominio + máquina de estados (re-exporta formateo)
│   ├── supabase-browser.ts       # Cliente Supabase del navegador (Realtime)
│   ├── realtime.ts               # Helper de suscripción con estado/reconexión
│   ├── push-capacitor.ts       # Push nativo para Capacitor (FCM)
│   ├── logic/                    # Lógica de negocio pura (cobertura ≥90% con Vitest)
│   │   ├── tarifa.ts             # Matriz de tarifas + fallback simétrico
│   │   ├── recargos.ts           # Recargos aplicables + tope de selección
│   │   ├── estado-pedido.ts      # Máquina de estados por rol (espejo de la BD)
│   │   ├── validacion.ts         # Validadores de formularios
│   │   ├── formato.ts            # Moneda, fechas, tiempo relativo
│   │   ├── metricas.ts           # Promedios de tiempos y tasa de errores (Parte 9)
│   │   └── alertas.ts            # Pedidos vencidos, cooldown y texto de webhook (Parte 9)
│   ├── components/
│   │   ├── SearchSelect.svelte
│   │   ├── BadgeEstado.svelte    # Badge canónico de los 7 estados (Parte 4)
│   │   ├── HistorialTimeline.svelte
│   │   ├── IndicadorRealtime.svelte
│   │   └── IndicadorOffline.svelte
│   └── server/
│       ├── supabase.ts           # Clientes Supabase (anon + as-user)
│       ├── auth.ts               # Sesión por cookies, refresh y guards por rol
│       ├── tarifas.ts            # Cálculo compartido de tarifas (barrio → zona → matriz)
│       ├── reportes.ts           # Agregación de reportes (resumen, series, por domiciliario, CSV)
│       ├── crud.ts               # Handler CRUD genérico
│       ├── flags.ts              # Feature flags server-side (Parte 8)
│       ├── errores.ts            # Registro best-effort en errores_app (Parte 9)
│       ├── metricas.ts           # Consultas del dashboard de métricas (Parte 9)
│       └── alertas.ts            # Motor de alertas del cron: chequeos + webhook (Parte 9)
└── routes/
    ├── +page.svelte              # Landing
    ├── service-worker.ts         # PWA: precache + offline básico
    ├── login/                    # Login unificado (admin y domiciliario)
    ├── calculadora/              # Calculadora pública
    ├── nuevo-pedido/             # Formulario público de pedido (tarifa en vivo)
    ├── consultar-estado/         # Consulta pública + actualización en vivo
    ├── admin/
    │   ├── login/                # Redirige a /login
    │   └── (panel)/              # Resumen, Pedidos, Reportes, Métricas, Domiciliarios, Zonas, Tarifas, Recargos, Barrios
    ├── domiciliario/             # Panel del repartidor (guard por rol)
    └── api/
        ├── health/+server.ts    # Health check (Parte 8): Supabase + latencia
        ├── metricas/+server.ts   # Métricas en tiempo real (Parte 9, admin)
        ├── errores/+server.ts    # Reporte de errores del frontend (Parte 9, público)
        ├── cron/alertas/+server.ts   # Cron de alertas (Parte 9, CRON_SECRET)
        ├── alertas/probar/+server.ts # Provoca un 500 a propósito (Parte 9, admin)
        ├── login|sesion|salir/+server.ts
        ├── zonas|barrios|tarifas/+server.ts     # CRUD (GET público / escritura admin)
        ├── domiciliarios/+server.ts             # CRUD de repartidores (admin)
        ├── calcular_tarifa/+server.ts           # Cálculo público
        ├── reportes/+server.ts                   # GET resumen por rango (admin)
        ├── reportes/csv/+server.ts               # GET descarga CSV (admin)
        ├── recargos/+server.ts                    # CRUD de recargos (GET público / escritura admin)
        └── pedidos/
            ├── +server.ts                       # POST crear (público, con recargos) / GET listar (admin|domiciliario)
            ├── cancelar/+server.ts              # POST cancelar pendiente por código (público)
            ├── consultar/+server.ts             # GET estado por código (público)
            ├── [id]/estado/+server.ts           # POST transición vía RPC (admin|domiciliario)
            └── [id]/asignar/+server.ts          # POST asignar domiciliario (admin)
```

```
tests/
├── logic/                        # Parte 1: lógica pura (cobertura ≥90%)
├── rls/                          # Parte 2: RLS contra Supabase local (67 casos) + monitoreo (Parte 9)
├── integration/                  # Parte 3: HTTP real contra la app + Supabase local + monitoreo (Parte 9)
├── ui/                           # Parte 4: componentes con jsdom + @testing-library/svelte
└── e2e/                          # Partes 5 y 6: Playwright (flujos completos + Realtime)
```

## Setup

```bash
bun install
cp .env.example .env   # pega tus credenciales de Supabase
bun run dev            # http://localhost:5173
```

`.env` (las variables públicas las usa el cliente):

```
PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

> El **service role key** nunca va en la app: el panel valida admin por RLS
> (`es_admin()`), así que solo se necesitan credenciales públicas.

### Deploy en Vercel

La app está configurada con `@sveltejs/adapter-vercel` y el repo raíz ES la app
(no hay subcarpeta). Pasos:

1. Sube el repo a GitHub (`git push -u origin main`).
2. En Vercel: **Add New → Project** → importa el repo (detecta SvelteKit solo,
   root directory = `./`).
3. Añade las variables de entorno en **Settings → Environment Variables**:
   `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY` (las mismas del `.env`).
4. Deploy. El runtime Node + HTTPS ya están listos para las cookies httpOnly.

### Build de app nativa (Capacitor)

StarGo también se puede compilar como app nativa para Android e iOS usando
[Capacitor](https://capacitorjs.com/). La app web se empaqueta dentro de un
WebView nativo, y los push notifications se envían vía FCM (Android) o APNs (iOS).

**Prerrequisitos**: Node.js ≥ 22.18, Bun, Android Studio o Xcode.

```bash
# 1. Configurar variables de entorno para Capacitor
cp .env.capacitor.example .env.capacitor   # completa las URLs

# 2. Build estático + sync con las plataformas nativas
bun run cap:sync

# 3. Abrir en el IDE nativo
bun run cap:android    # abre Android Studio
bun run cap:ios        # abre Xcode (solo macOS)
```

**Archivos importantes**:
- `capacitor.config.ts` — configuración de Capacitor
- `scripts/build-capacitor.mjs` — build script que maneja Sentry y adapter-static
- `src/lib/push-capacitor.ts` — módulo de push nativo (FCM)
- `docs/capacitor-build.md` — guía completa de builds y configuración de Firebase/FCM

Para Builds de release (APK/AAB para Android o IPA para iOS), consulta
[`docs/capacitor-build.md`](docs/capacitor-build.md).

### Primer administrador

1. Crea tu usuario: Supabase → **Authentication → Users → Add user**.
2. Ejecuta [`supabase/agregar_admin.sql`](supabase/agregar_admin.sql) (reemplaza tu email).
3. Ingresa en `/admin/login`.

### Fase 3 — Migración de pedidos

Antes de usar los pedidos, ejecuta en el SQL Editor:

```bash
supabase/migracion_pedidos.sql
```

Crea las tablas `pedidos` y `historial_estados` (privadas, RLS solo admin) y las
funciones públicas `crear_pedido()` y `consultar_pedido()` (SECURITY DEFINER).
La tarifa de cada pedido se recalcula en la BD; el cliente nunca la envía.

### Fase 4 + 5 — Migración de domiciliarios y tiempo real

```bash
supabase/migracion_domiciliarios.sql
```

Crea:
- **`domiciliarios`** (privada): un repartidor por usuario de Supabase Auth; el admin lo
  registra por email con el RPC `registrar_domiciliario()`.
- **`pedidos.domiciliario_id`** y los estados `asignado` y `recogido`.
- RPCs SECURITY DEFINER `asignar_domiciliario()` y `transicionar_pedido()`: la asignación y
  **toda** transición se validan en la BD (rol + máquina de estados) y se registran en el historial.
- **Realtime**: `pedidos` y `domiciliarios` publicados (RLS decide quién recibe cada evento)
  y `pedido_eventos` (público, solo `numero` + `estado`) para el panel del cliente.

### Fase 7 — Recargos, cancelaciones y pulido

```bash
supabase/migracion_fase7.sql
```

Añade:
- **`recargos`**: columnas `descripcion` y `activo` (lectura pública / escritura admin).
- **`pedidos`**: columnas `recargos` (snapshot JSONB), `recargo_total`, `total` y `motivo_cancelacion`
  (con backfill de `total` para pedidos existentes).
- **`crear_pedido()`**: nueva sobrecarga con `p_recargos TEXT[]`; la BD valida los recargos activos,
  recalcula el total y guarda el snapshot (nunca confía en el cliente).
- **`transicionar_pedido()`**: nueva sobrecarga con `p_motivo` que registra `motivo_cancelacion`.
- **`cancelar_pedido_cliente()`**: RPC público por código; solo cancela pedidos `pendiente`.
- **`consultar_pedido()`**: ahora devuelve recargos, recargo_total, total y motivo_cancelacion.

> Tras ejecutarla, crea los recargos que quieras desde **Admin → Recargos**. Los clientes los verán
> en `/nuevo-pedido` y podrán cancelar pedidos pendientes desde `/consultar-estado`.

### Parte 2 — Pruebas de RLS (Supabase local)

Prerequisitos: **Docker** y el **Supabase CLI** (`brew install supabase/tap/supabase`
o descarga desde [supabase.com/docs/guides/local-development](https://supabase.com/docs/guides/local-development)).

```bash
supabase start                 # levanta Postgres+PostgREST+Auth y aplica supabase/migrations/
cp .env.test.example .env.test  # credenciales del proyecto local
bun run test:rls               # suite de RLS (67 casos)
```

> **JWT_SECRET**: las suites no lo necesitan (el Auth local firma los tokens de
> los usuarios de prueba con el secret de tu instancia). Si alguna vez fallan
> con errores de JWT (`Expected 3 parts in JWT`, 401 en el seeding), es que los
> keys de `.env.test` no coinciden con los de tu instancia: sácalos con
> `supabase status` (o `supabase status -o env`) y actualiza `SUPABASE_URL`/
> `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`. El secret vive en
> `supabase/config.toml → [auth] jwt_secret` (default del CLI); cambiarlo
> invalida los keys por defecto del `.env.test.example`.

La suite cubre, por cada tabla y cada rol (anon / cliente / admin / domiciliario):
qué filas puede SELECT y qué puede INSERT/UPDATE/DELETE; que un cliente NO lea
pedidos (ni los suyos por SQL directo), que un domiciliario NO vea pedidos ajenos
ni modifique la tarifa ni el estado por SQL (solo vía RPC), que un usuario no
autenticado no lea ninguna tabla sensible; constraints (precios ≥ 0, FKs,
CHECK de estado, tope de 15 recargos); triggers (`set_updated_at`,
`emitir_pedido_evento`) y los RPCs (`calcular_tarifa`, `crear_pedido`,
`consultar_pedido`, `cancelar_pedido_cliente`, `transicionar_pedido`,
`asignar_domiciliario`) contra la base real.

> ⚠️ La suite crea usuarios y datos de prueba: NUNCA la apuntes a producción
> (`.env.test` está en `.gitignore`; solo se commitea la plantilla). Sin
> credenciales, los tests se auto-saltan para no romper el desarrollo.

### Parte 3 — Pruebas de integración (SvelteKit ↔ Supabase)

Mismos prerequisitos que la Parte 2 (Docker + Supabase CLI):

```bash
supabase start                  # aplica supabase/migrations/ y levanta el Supabase local
cp .env.test.example .env.test   # credenciales del proyecto local
bun run test:integration         # compila la app, levanta preview y corre la suite
```

El runner (`scripts/integration-run.mjs`) compila la app con `PUBLIC_SUPABASE_URL` apuntando
**al Supabase local**, levanta `vite preview` en el puerto 4175 y corre Vitest contra
`http://127.0.0.1:4175`. Al terminar (pase o falle) apaga el preview. Esto prueba el código real
que corre en producción — hooks, cookies, SSR y endpoints — sin mocks de Supabase.

Cubre los casos críticos de la Parte 3:
- **load functions**: `/admin` y `/domiciliario` devuelven el email correcto según el rol y, con
  sesión ausente/expirada o rol equivocado, redirigen a `/login` (303) en vez de fallar con 500.
- **endpoints (equivalentes a form actions)**: crear pedido (la BD recalcula tarifa+recargos), asignar
  domiciliario, cambiar estado — cada uno **valida los datos de entrada antes de tocar la base**
  (los 400 no crean filas) y los errores de la BD llegan como mensajes legibles, no como 500.
- **manejo de errores de Supabase**: `api.ts` nunca lanza (red, timeout, 429, 500) y la UI muestra
  el mensaje y permite reintentar.
- **sincronización de sesión cliente-servidor**: login → cookies httpOnly → cada request autenticado;
  refresco automático cuando el access token está vencido/corrupto (el servidor renueva y re-emite
  cookies); sesión inválida → `data:null` sin 500; y los tokens que el servidor expone hidratan un
  cliente supabase-js válido (la misma sesión en ambos lados).

Opciones útiles:
- `TEST_BASE_URL=http://…` — apunta a un servidor ya levantado (no compila ni levanta preview).
- `TEST_SKIP_BUILD=1` — reutiliza el último build sin recompilar.
- `TEST_PREVIEW_PORT=XXXX` — puerto del preview (default 4175).

> ⚠️ Igual que la Parte 2: la suite crea usuarios y datos; jamás la apuntes a producción.
> Sin credenciales (o sin servidor), se auto-salta sin romper nada.

### Parte 4 — Pruebas de componentes (UI)

No requiere Supabase: corre en **jsdom** con `@testing-library/svelte`, mockeando la capa de red
(`api`) y Realtime.

```bash
bun run test:ui             # suite de componentes
bun run test:ui:coverage    # con reporte de cobertura (sin umbral duro)
```

Cubre los componentes críticos (los que tocan dinero o cambian estado):
- **`SearchSelect`**: filtrado al escribir, elección, limpiar selección, sin resultados, disabled.
- **`BadgeEstado`** y **`HistorialTimeline`**: extraídos como componentes (antes eran spans/`ol`
  repetidos); el badge se testea para los **7 estados** (texto + colores del Design System) y el
  timeline para orden/notas/fechas.
- **Formulario de pedido** (`nuevo-pedido`): la tarifa se dispara al seleccionar ambos barrios
  (con estado «Calculando…»), muestra error si la ruta no tiene tarifa (y bloquea el envío),
  valida los campos **al confirmar** (así está implementado el formulario; el test verifica que
  con campos inválidos no se toca la red), confirma y muestra el código, y suma los recargos
  activos al total estimado.
- **Tabla de pedidos del admin**: filtro por pestañas de estado, contadores, orden de filas (el
  orden lo trae la API; la página lo respeta), estado vacío («No hay pedidos … por ahora») y la
  UI de asignar/cancelar.

> La cobertura se reporta (`bun run test:ui:coverage`) pero NO tiene umbral duro: el gate de %
> del proyecto sigue siendo la lógica pura de `src/lib/logic` (Parte 1).

### Parte 5 — Pruebas E2E (Playwright)

Los flujos completos de negocio en un navegador real. Prerequisitos: Docker + Supabase CLI
(como las Partes 2-3) y los navegadores de Playwright:

```bash
bunx playwright install chromium webkit   # una sola vez
supabase start
cp .env.test.example .env.test
bun run test:e2e          # toda la matriz (Chromium + WebKit × desktop + móvil)
bun run test:e2e:headed   # con ventana visible (debug)
```

El runner (`scripts/e2e-run.mjs`) compila la app contra el Supabase local, levanta `vite preview`
en el puerto 4176 y corre Playwright. El global-setup siembra usuarios (admin, domiciliario,
cliente) y catálogo con un prefijo único por corrida, y el teardown los limpia automáticamente.

Cubre los **flujos obligatorios** de la spec:
- **Cliente**: crear pedido → ver tarifa calculada → confirmar → ver el estado inicial.
- **Admin**: login → ver pedido pendiente → asignar domiciliario → verlo en "Asignados".
- **Domiciliario**: login → ver pedido asignado → aceptar → recogido → en camino → entregado.
- **Configuración**: el admin crea zona → barrio → tarifa y el cliente calcula con la tarifa nueva.
- **Cancelación**: con motivo, desde el cliente y desde el admin, con historial correcto.
- **Error**: pedir entre barrios sin tarifa → mensaje claro, sin crash.

Opciones: `TEST_BASE_URL=http://…` (servidor ya levantado, p. ej. un preview de Vercel),
`E2E_PROJECTS=chromium-desktop,webkit-desktop` (subset), `TEST_SKIP_BUILD=1`.

> ⚠️ Igual que las demás suites: NUNCA contra un Supabase de producción. Sin credenciales se omite.

### Parte 6 — Pruebas de Realtime

Los tests automatizados viven en `tests/e2e/realtime.spec.ts` (se corren con `bun run test:e2e`):
- **Propagación**: el cambio de estado del admin llega al cliente **en tiempo real** (dos
  navegadores abiertos a la vez) hasta "Entregado".
- **Aislamiento**: un domiciliario que no tiene el pedido asignado no lo ve — RLS también aplica
  a las suscripciones de Realtime.
- **Refresh manual**: sin depender de Realtime, el botón "Buscar" actualiza el estado
  (la app sigue siendo usable si Realtime está caído).

Los casos que no se pueden automatizar de forma fiable en CI (reconexión tras caída de red, fugas
 de suscripciones, Realtime caído) están en la **checklist manual**
[`docs/CHECKLIST_REALTIME.md`](docs/CHECKLIST_REALTIME.md).

### Parte 7 — Carga y rendimiento

- **k6**: `scripts/k6/carga-crear-pedidos.js` (hora pico) y `scripts/k6/carga-calcular-tarifa.js`
  (el path más transitado). Se corren contra la app (preview local o desplegada) con
  `k6 run --vus 20 --duration 1m scripts/k6/carga-crear-pedidos.js` (y `K6_BASE_URL` si no es el 4175).
  El objetivo es identificar el **punto de quiebre** y confirmar que está por encima del uso real
  esperado × 3-5 — plantilla en [`docs/REPORTE_CARGA.md`](docs/REPORTE_CARGA.md).
- **Presupuesto de bundle (gate en CI)**: `bun run build && bun run bundle:budget`. Falla si los
  assets del cliente superan JS 450 KB / CSS 120 KB / chunk mayor 250 KB (gzip, configurables por
  env `BUNDLE_JS_KB`/`BUNDLE_CSS_KB`/`BUNDLE_CHUNK_KB`).
- **Lighthouse (Core Web Vitals)**: `bun run preview` en otra terminal y luego
  `LH_URL=http://127.0.0.1:4175 bun run perf:lighthouse` (LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms).

### Parte 8 — Post-deploy y smoke tests en producción

- **`GET /api/health`**: la app responde y verifica Supabase con latencia; nunca 500 (503 con
  `ok:false` si Supabase está caído). Es la base del monitor externo de uptime.
- **Smoke test post-deploy** (`bun run test:smoke`): login de usuarios de prueba por rol, cálculo
  de tarifa, creación y cancelación de un pedido de prueba. El workflow
  `.github/workflows/smoke-postdeploy.yml` lo corre automáticamente tras cada deploy a producción
  (webhook `deploy-complete` de Vercel o manual). Configura los secretos `SMOKE_URL`,
  `SMOKE_ADMIN_EMAIL/PASSWORD` y `SMOKE_DOM_EMAIL/PASSWORD` con **usuarios de prueba dedicados**.
- **E2E contra previews de Vercel** (`.github/workflows/e2e-preview.yml`): cada preview de un PR
  recibe la suite E2E crítica (subset `chromium-desktop`) contra su URL, usando un Supabase de
  staging (secretos `E2E_STAGING_*`). Sin los secretos, ambos workflows se omiten sin fallar.
- **Feature flags**: `src/lib/server/flags.ts` — `flagActiva('TARIFAS_V2')` lee `FLAG_TARIFAS_V2`
  del entorno del servidor (Vercel), para activar/desactivar cambios riesgosos sin rollback.

### Parte 9 — Monitoreo, alertas y observabilidad

Ejecuta primero la migración [`supabase/migrations/20260806000000_fase9_monitoreo.sql`](supabase/migrations/20260806000000_fase9_monitoreo.sql)
(en Supabase local: `supabase db reset` o `supabase db push`; en el dashboard: SQL Editor).

Guía completa (Sentry, webhook, alertas en el dashboard) en [`docs/MONITOREO.md`](docs/MONITOREO.md).

- **Sentry**: se activa con `PUBLIC_SENTRY_DSN` (client + server en `hooks.client.ts` /
  `hooks.server.ts`); captura errores no manejados y promesas rechazadas en el frontend y los
  5xx/errores de Supabase en el backend. Sourcemaps: `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT`
  activan `sentryVitePlugin` en el build (sin ellas, el build es normal).
- **Registro de errores (`errores_app`)**: `POST /api/errores` (público) lo alimenta desde el
  frontend; `hooks.server` registra 5xx y rate limits (429) desde el backend. Alimenta el dashboard
  y las alertas de tasa.
- **Dashboard `/admin/metricas`**: pedidos activos, tiempo promedio de asignación y de entrega
  (últimas 24 h), errores por minuto, últimas alertas y **auditoría de tarifas** (`historial_tarifas`,
  sección 14: quién y cuándo cambió la matriz). Se refresca cada 30 s y con Realtime.
- **Cron de alertas**: `GET /api/cron/alertas` protegido por `CRON_SECRET` (Vercel lo invoca a diario
  con `0 0 * * *` según [`vercel.json`](vercel.json) con `Authorization: Bearer`; también acepta
  `x-cron-secret` o `?secret=`). Vigila: pedidos pendientes sin asignar por más de
  `ALERTAS_PENDIENTE_MINUTOS`, tasa de 5xx ≥ `ALERTAS_UMBRAL_5XX`, rate limits y caída de Supabase.
  Cada alerta va al webhook (`ALERTAS_WEBHOOK_URL`, formato `{text}` Slack/Discord/Telegram), a
  Sentry y a la bitácora `alertas` (con cooldown por evento).
- **Verificación del entregable**: `bun run test:alertas` (con `BASE_URL`/`CRON_SECRET` y opcionalmente
  `ADMIN_EMAIL`/`ADMIN_PASSWORD`) dispara una alerta de prueba vía `?prueba=1` y un error 500
  a propósito vía `POST /api/alertas/probar`; confirma que llegan al webhook y a Sentry.

### Parte 10 — Checklist pre-lanzamiento (go/no-go)

Checklist completo y plan de rollback en [`docs/CHECKLIST_GO_NO_GO.md`](docs/CHECKLIST_GO_NO_GO.md).
Resumen operativo:

```bash
bun run go-no-go                     # veredicto GO/NO-GO + gates locales
bun run go-no-go --e2e               # incluye la suite E2E (requiere Supabase/staging)
bun run go-no-go --reporte release.json   # deja el reporte para adjuntar al release
bun run go-no-go --marcar realtime   # registra una verificación manual con su fecha
bun run go-no-go --marcar backup --nota "PITR activo + restauración probada"
```

Los items **automatizados** (typecheck, unitarios + cobertura ≥90%, RLS, integración, E2E con
`--e2e`, bundle, smoke y alertas si están configurados) se ejecutan solos. Los **manuales**
(realtime, carga, smoke, alertas, backup, rollback) se evalúan contra fechas registradas con
ventana de validez configurable (`GO_NO_GO_VENTANA_<CLAVE>_DIAS`). El veredicto es **GO solo si
los 10 puntos pasan**; cualquier fail/pendiente/no-ejecutable → **NO-GO** (exit 1).

Antes de un release importante, el workflow `.github/workflows/release-gate.yml`
(**Actions → Run workflow**) ejecuta todo en CI contra Supabase local, corre el runner y sube el
reporte como artefacto; falla el job si el veredicto fue NO-GO.

### Fase 8 — Seguridad, QA y PWA

- **Auditoría RLS**: ejecuta [`supabase/audit_rls.sql`](supabase/audit_rls.sql) (verificación + hardening
  de permisos: anon sin acceso a datos privados, sin escritura directa sobre pedidos).
- **QA**: plan de pruebas por rol (cliente/domiciliario/admin) en
  [`docs/QA_SEGURIDAD_FASE8.md`](docs/QA_SEGURIDAD_FASE8.md), junto con el checklist de seguridad
  (HTTPS, JWT en cookies httpOnly, sin keys sensibles en el frontend, CSP) y la revisión de performance.
- **PWA**: el service worker (`src/service-worker.ts`) se genera automáticamente en el build;
  `/offline.html` es la pantalla «sin conexión» y el manifest es instalable en Android/iOS/Desktop.
  El service worker SOLO se activa en producción (`bun run build` → `bun run preview`).

### Registrar un domiciliario

1. Crea su usuario: Supabase → **Authentication → Users → Add user** (usa su email real).
2. En el panel admin → **Domiciliarios** → regístralo con ese mismo email.
3. El repartidor entra en `/login` y será redirigido a `/domiciliario`.

> Al desactivar un domiciliario pierde el acceso al instante (RLS + guard);
> si está a mitad de una entrega, el admin puede cancelar o reasignar el pedido.

### Verificación rápida de la BD (si las escrituras fallan con 403/400)

```sql
-- Políticas RLS de escritura (deben listar INSERT/UPDATE/DELETE para admin):
SELECT tablename, policyname, cmd FROM pg_policies
WHERE tablename IN ('zonas', 'barrios', 'tarifas');

-- Índice único de tarifas (necesario para el upsert de la matriz):
SELECT conname FROM pg_constraint
WHERE conrelid = 'tarifas'::regclass;
```

## API

| Endpoint | Método | Acceso | Descripción |
|---|---|---|---|
| `/api/zonas` | GET | público | `?select=`, `?orden=`, `?filtro=col=val` (repetible) |
| `/api/zonas` | POST/PUT/DELETE | admin | `{op:'insert',filas:[...]}` · `{datos:{...}}` · `?filtro=id=x` |
| `/api/barrios` | igual | admin | inserciones deduplicadas por nombre |
| `/api/tarifas` | igual | admin | `POST {op:'upsert', onConflict:'zona_origen_id,zona_destino_id', filas:[...]}` |
| `/api/calcular_tarifa` | POST | público | `{barrio_origen, barrio_destino}` → `{data: 7000, meta:{...}}` |
| `/api/recargos` | GET | público | lista de recargos (`?select=`, `?filtro=`) |
| `/api/recargos` | POST/PUT/DELETE | admin | `{op:'insert',filas:[...]}` · `?filtro=codigo=x` |
| `/api/pedidos` | POST | público | crear pedido (con `recargos: [códigos]`) → `{data:{numero, tarifa_base, recargos, recargo_total, total}}` |
| `/api/pedidos/cancelar` | POST | público | `{numero, motivo}` → cancela solo si sigue pendiente |
| `/api/pedidos/consultar?numero=X` | GET | público | pedido + historial + desglose de recargos + motivo de cancelación |
| `/api/pedidos` | GET | admin/doms. | lista con historial; el domiciliario ve solo los suyos |
| `/api/pedidos/:id/estado` | POST | admin/doms. | `{estado, notas?, motivo?}` vía RPC (máquina de estados en BD) |
| `/api/pedidos/:id/asignar` | POST | admin | `{domiciliario_id}` → `pendiente → asignado` |
| `/api/domiciliarios` | GET | admin | lista de repartidores (`?activos=true`) |
| `/api/domiciliarios` | POST | admin | `{op:'registrar', nombre, email, telefono?}` |
| `/api/domiciliarios?id=x` | PUT/DELETE | admin | activar/desactivar o eliminar |
| `/api/reportes?desde&hasta` | GET | admin | resumen, series diarias, por domiciliario y pedidos del rango (fechas en hora de Bogotá) |
| `/api/reportes/csv?desde&hasta` | GET | admin | descarga CSV de los pedidos del rango (BOM UTF-8 para Excel) |
| `/api/metricas` | GET | admin | métricas en tiempo real: pedidos activos, tiempos promedio, errores/min, alertas y auditoría de tarifas |
| `/api/errores` | POST | público | reporta un error del frontend a `errores_app` (best-effort) |
| `/api/cron/alertas` | GET | cron | chequeos de alertas (pedidos sin asignar, 5xx, rate limits, Supabase) → webhook + bitácora |
| `/api/cron/alertas?prueba=1` | GET | cron | fuerza una alerta de prueba (verificación) |
| `/api/alertas/probar` | POST | admin | provoca un error 500 a propósito (verificación de Sentry/5xx) |
| `/api/push/registrar-token` | POST | admin/dom | `{token, plataforma}` → guarda token FCM nativo (Capacitor) |
| `/api/push/estado` | GET | admin/dom | `{tiene_token: boolean}` → verifica si tiene token registrado |
| `/api/health` | GET | — | health check: `{ok, supabase, latencia_ms}` (200/503, sin cache) |
| `/api/login` | POST | — | `{email, password}` → cookies httpOnly + roles |
| `/api/sesion` | GET | — | valida/renueva; devuelve roles y tokens para Realtime |
| `/api/salir` | POST | — | cierra sesión |

**Roles**: un usuario puede ser admin y/o domiciliario. El login redirige según el rol;
`/api/sesion` además expone los tokens propios para hidratar el cliente de Realtime en el navegador.

**Calcular tarifa** acepta el id (UUID) o el nombre del barrio. Devuelve `data: null`
cuando el barrio no existe, la zona es no disponible o no hay tarifa definida.

## Scripts

```bash
bun run dev            # desarrollo
bun run check          # svelte-check
bun run test           # tests unitarios (Vitest)
bun run test:watch     # Vitest en modo watch
bun run test:coverage  # tests + cobertura (gate ≥90% en src/lib/logic)
bun run test:ui        # componentes de UI (Parte 4) en jsdom
bun run test:rls       # suite de RLS (Parte 2) contra Supabase local
bun run test:integration  # suite de integración (Parte 3): build + preview + HTTP real
bun run test:e2e       # suite E2E (Partes 5 y 6): Playwright, Chromium+WebKit, desktop+móvil
bun run test:e2e:headed  # E2E con ventana visible (debug)
bun run test:smoke     # smoke test post-deploy (Parte 8) contra SMOKE_URL
bun run test:alertas   # verificación de alertas (Parte 9): prueba webhook + error 500 provocado
bun run bundle:budget  # presupuesto de bundle (Parte 7) tras bun run build
bun run perf:lighthouse  # auditoría Lighthouse de Core Web Vitals (Parte 7, requiere Chrome)
bun run go-no-go       # checklist pre-lanzamiento (Parte 10): veredicto GO/NO-GO + gates locales
bun run build          # build de producción (Vercel)
bun run build:capacitor # build estático para Capacitor (app nativa)
bun run cap:sync       # build + sync con Android/iOS
bun run cap:android    # abrir en Android Studio
bun run cap:ios        # abrir en Xcode (solo macOS)
```

> Nota: usa `bun run test`, no `bun test` (este último es el runner nativo de
> Bun y no usa la config de Vitest).

## CI (GitHub Actions)

`.github/workflows/ci.yml` corre en cada push y pull request:

- **Typecheck y tests** (siempre): `bun install --frozen-lockfile`, `bun run check`
  (genera un `.env` temporal desde `.env.example` para el typecheck) y
  `bun run test:coverage` (Vitest: el CI falla si la cobertura de `src/lib/logic` baja del 90%).
- **RLS (Parte 2)**: el job `rls-tests` levanta **Supabase local** (Docker + CLI, aplica
  `supabase/migrations/`) y corre `bun run test:rls`. Es el gate de cambios de políticas RLS;
  requiere Docker en el runner. Si no quieres correrlo en cada push, borra el job (el comando
  sigue disponible localmente).
- **Integración (Parte 3)**: el job `integration-tests` levanta Supabase local y corre
  `bun run test:integration` (el runner compila la app contra esa instancia y levanta `vite preview`
  para probar el flujo completo por HTTP real). Requiere Docker; mismo criterio que `rls-tests`
  si prefieres no correrlo en cada push.
- **E2E (Partes 5 y 6)**: el job `e2e-tests` levanta Supabase local, instala los browsers de
  Playwright (Chromium + WebKit) y corre `bun run test:e2e` (la matriz completa de viewports).
  Es el gate más lento: se reserva a los flujos críticos y se puede limitar con `E2E_PROJECTS`.
- **Build de producción** (opcional): se ejecuta solo si el repo tiene los secretos
  `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY` configurados en
  *Settings → Secrets and variables → Actions*; hasta entonces queda en "skipped"
  y no bloquea los push. Además corre `bun run bundle:budget` (Parte 7) sobre el build.

Workflows extra (Parte 8, ambos se omiten sin secretos):
- `.github/workflows/smoke-postdeploy.yml` — smoke test en producción tras cada deploy
  (`deploy-complete` de Vercel o manual).
- `.github/workflows/e2e-preview.yml` — E2E crítico contra el preview de cada PR de Vercel.

Workflow de release (Parte 10):
- `.github/workflows/release-gate.yml` — **dispatch manual** antes de un release importante:
  levanta Supabase local, corre el runner go/no-go completo (con E2E opcional), sube el reporte
  como artefacto y falla el job si el veredicto fue NO-GO.

## Esquema de base de datos (Supabase)

Tablas `zonas`, `barrios`, `tarifas`, `recargos`, `admins` y funciones
`calcular_tarifa()`, `es_admin()` — ver detalle en [`docs/MIGRACION_SVELTEKIT.md`](docs/MIGRACION_SVELTEKIT.md).
