# StarGo — Plataforma de domicilios (Fases 2-5)

Plataforma de pedidos y tarifas de domicilios para **Armenia, Quindío**.
SvelteKit 5 (runes) + Supabase (Auth, Postgres/RLS, Realtime).

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
- **Auth completa**: Supabase Auth (email/password) + cookies httpOnly + roles `es_admin()` / `es_domiciliario()`.
  Los recargos (sección 13) quedan para una fase posterior.

## Estructura

```
src/
├── lib/
│   ├── api.ts                    # Cliente fetch del frontend
│   ├── types.ts                  # Tipos de dominio + máquina de estados + formateo COP
│   ├── supabase-browser.ts       # Cliente Supabase del navegador (Realtime)
│   ├── realtime.ts               # Helper de suscripción con estado/reconexión
│   ├── components/
│   │   ├── SearchSelect.svelte
│   │   └── IndicadorRealtime.svelte
│   └── server/
│       ├── supabase.ts           # Clientes Supabase (anon + as-user)
│       ├── auth.ts               # Sesión por cookies, refresh y guards por rol
│       ├── tarifas.ts            # Cálculo compartido de tarifas (barrio → zona → matriz)
│       └── crud.ts               # Handler CRUD genérico
└── routes/
    ├── +page.svelte              # Landing
    ├── login/                    # Login unificado (admin y domiciliario)
    ├── calculadora/              # Calculadora pública
    ├── nuevo-pedido/             # Formulario público de pedido (tarifa en vivo)
    ├── consultar-estado/         # Consulta pública + actualización en vivo
    ├── admin/
    │   ├── login/                # Redirige a /login
    │   └── (panel)/              # Resumen, Pedidos, Domiciliarios, Zonas, Tarifas, Barrios
    ├── domiciliario/             # Panel del repartidor (guard por rol)
    └── api/
        ├── login|sesion|salir/+server.ts
        ├── zonas|barrios|tarifas/+server.ts     # CRUD (GET público / escritura admin)
        ├── domiciliarios/+server.ts             # CRUD de repartidores (admin)
        ├── calcular_tarifa/+server.ts           # Cálculo público
        └── pedidos/
            ├── +server.ts                       # POST crear (público) / GET listar (admin|domiciliario)
            ├── consultar/+server.ts             # GET estado por código (público)
            ├── [id]/estado/+server.ts           # POST transición vía RPC (admin|domiciliario)
            └── [id]/asignar/+server.ts          # POST asignar domiciliario (admin)
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
| `/api/pedidos` | POST | público | crear pedido → `{data:{numero, tarifa_base, estado:'pendiente'}}` |
| `/api/pedidos/consultar?numero=X` | GET | público | pedido + historial de estados |
| `/api/pedidos` | GET | admin/doms. | lista con historial; el domiciliario ve solo los suyos |
| `/api/pedidos/:id/estado` | POST | admin/doms. | `{estado, notas?}` vía RPC (máquina de estados en BD) |
| `/api/pedidos/:id/asignar` | POST | admin | `{domiciliario_id}` → `pendiente → asignado` |
| `/api/domiciliarios` | GET | admin | lista de repartidores (`?activos=true`) |
| `/api/domiciliarios` | POST | admin | `{op:'registrar', nombre, email, telefono?}` |
| `/api/domiciliarios?id=x` | PUT/DELETE | admin | activar/desactivar o eliminar |
| `/api/login` | POST | — | `{email, password}` → cookies httpOnly + roles |
| `/api/sesion` | GET | — | valida/renueva; devuelve roles y tokens para Realtime |
| `/api/salir` | POST | — | cierra sesión |

**Roles**: un usuario puede ser admin y/o domiciliario. El login redirige según el rol;
`/api/sesion` además expone los tokens propios para hidratar el cliente de Realtime en el navegador.

**Calcular tarifa** acepta el id (UUID) o el nombre del barrio. Devuelve `data: null`
cuando el barrio no existe, la zona es no disponible o no hay tarifa definida.

## Scripts

```bash
bun run dev       # desarrollo
bun run check     # svelte-check
bun run build     # build de producción
bun run preview   # previsualizar el build
```

## Esquema de base de datos (Supabase)

Tablas `zonas`, `barrios`, `tarifas`, `recargos`, `admins` y funciones
`calcular_tarifa()`, `es_admin()` — ver detalle en [`docs/MIGRACION_SVELTEKIT.md`](docs/MIGRACION_SVELTEKIT.md).
