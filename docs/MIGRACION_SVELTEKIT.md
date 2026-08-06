# Guía de Migración: StarGo → SvelteKit

> **Fecha:** Agosto 2026  
> **Proyecto actual:** HTML + JavaScript vanilla + Vercel Serverless Functions  
> **Objetivo:** Migrar a SvelteKit con server-side rendering y API routes

---

## Tabla de Contenidos

1. [Resumen del Proyecto](#1-resumen-del-proyecto)
2. [Arquitectura Actual](#2-arquitectura-actual)
3. [Esquema de Base de Datos](#3-esquema-de-base-de-datos)
4. [Endpoints de API](#4-endpoints-de-api)
5. [Cliente API (stargo.js)](#5-cliente-api-stargojs)
6. [Variables de Entorno](#6-variables-de-entorno)
7. [Páginas Frontend](#7-páginas-frontend)
8. [Lógica de Negocio](#8-lógica-de-negocio)
9. [Notas de Migración](#9-notas-de-migración)

---

## 1. Resumen del Proyecto

**StarGo** es una aplicación de cálculo de tarifas de domicilios para la ciudad de Armenia, Quindío, Colombia. Permite:

- **Calculadora pública:** Consultar tarifas entre barrios sin autenticación
- **Panel de administración:** Gestionar zonas, tarifas, barrios y recargos (requiere login)
- **Cálculo automático:** La función SQL `calcular_tarifa()` resuelve barrio → zona → tarifa

### Stack Actual

| Capa | Tecnología |
|------|------------|
| Frontend | HTML + JavaScript vanilla (ES6+) |
| Estilos | CSS custom properties (variables) |
| Backend | Vercel Serverless Functions (Node.js) |
| Base de datos | Supabase (PostgreSQL) |
| Autenticación | Supabase Auth (email/password) |
| Hosting | Vercel |

---

## 2. Arquitectura Actual

### 2.1 Estructura de Archivos

```
stargo-domicilios/
├── index.html                    # Redirect → calculadora_tarifas.html
├── calculadora_tarifas.html      # Calculadora pública
├── admin.html                    # Panel de administración
├── admin_barrios.html            # Redirect → admin.html
├── stargo.js                     # Cliente JS para la API
├── barrios.json                  # Datos de barrios por zona
│
├── api/                          # Serverless Functions
│   ├── _lib.js                   # Utilidades compartidas (NO se despliega como endpoint)
│   ├── login.js                  # POST /api/login
│   ├── sesion.js                 # GET /api/sesion
│   ├── zonas.js                  # CRUD /api/zonas
│   ├── tarifas.js                # CRUD /api/tarifas
│   ├── barrios.js                # CRUD /api/barrios
│   ├── recargos.js               # CRUD /api/recargos
│   └── calcular_tarifa.js        # POST /api/calcular_tarifa
│
├── migracion_panel_barrios.sql   # Migración inicial de barrios
├── migracion_admin_zonas_tarifas.sql  # Migración de admin + zonas + tarifas
│
├── package.json
├── vercel.json
├── .env.example
└── .gitignore
```

### 2.2 Flujo de Autenticación

```
┌─────────────────┐    POST /api/login     ┌─────────────────┐
│                 │  ───────────────────▶  │                 │
│    Navegador    │  { email, password }   │  api/login.js   │
│    (stargo.js)  │  ◀───────────────────  │                 │
│                 │  { token, refresh_     │  → Supabase Auth│
│  Guarda tokens  │    token, email }      │  → Verifica     │
│  en localStorage│                        │    admin en DB  │
└─────────────────┘                        └─────────────────┘

┌─────────────────┐   GET /api/sesion      ┌─────────────────┐
│                 │  ───────────────────▶  │                 │
│    Navegador    │  Authorization: Bearer │  api/sesion.js  │
│    (stargo.js)  │  X-Refresh-Token: ...  │                 │
│                 │  ◀───────────────────  │  → Valida token │
│  Actualiza      │  { email, esAdmin,     │  → Renueva si   │
│  tokens si      │    token (opc),        │    expiró       │
│  renovados      │    refresh_token (opc)}│                 │
└─────────────────┘                        └─────────────────┘
```

### 2.3 Flujo de Datos (CRUD genérico)

```
┌─────────────────┐                        ┌─────────────────┐
│    Navegador    │   api.from('zonas')    │   Vercel API    │
│                 │     .eq('id', x)       │                 │
│  Consulta       │     .update({...})     │  api/zonas.js   │
│  builder        │  ───────────────────▶  │       │         │
│  (stargo.js)    │  PUT /api/zonas?       │       ▼         │
│                 │    filtro=id=x         │  api/_lib.js    │
│                 │  { datos: {...} }      │  manejadorTabla │
│                 │  ◀───────────────────  │       │         │
│                 │  { data: {...} }       │       ▼         │
│                 │                        │  Supabase       │
└─────────────────┘                        └─────────────────┘
```

---

## 3. Esquema de Base de Datos

### 3.1 Tablas Principales

#### `admins` — Administradores del sistema

```sql
CREATE TABLE public.admins (
    user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**RLS:** Solo lectura autenticada (cada usuario ve su propio registro).

---

#### `zonas` — Zonas tarifarias

```sql
CREATE TABLE public.zonas (
    id          TEXT PRIMARY KEY,           -- slug: 'centro', 'norte_1_18', etc.
    nombre      TEXT NOT NULL,              -- Nombre legible
    tipo        TEXT NOT NULL CHECK (tipo IN ('urbana', 'destino_solo', 'no_disponible')),
    descripcion TEXT
);
```

**RLS:** Lectura pública / Escritura solo admin.

**Zonas existentes:**

| ID | Nombre | Tipo |
|----|--------|------|
| `centro` | Centro | urbana |
| `norte_1_18` | Norte (1-18) | urbana |
| `norte_19_37` | Norte (19-37) | urbana |
| `norte_38_50` | Norte (38-50) | urbana |
| `sur_27_50` | Sur (calle 27-50) | urbana |
| `sur_despues_naranjos` | Sur (después de Naranjos) | urbana |
| `sur_despues_puerto_espejo` | Sur (después de Pto Espejo) | urbana |
| `villa_inglesa` | Villa Inglesa | urbana |
| `cano_cristales` | Caño Cristales | urbana |
| `setta_departamental` | Setta Departamental | urbana |
| `zona_roja` | No disponible — Zona Roja | no_disponible |

---

#### `barrios` — Barrios de la ciudad

```sql
CREATE TABLE public.barrios (
    id        TEXT PRIMARY KEY,            -- Nombre del barrio (slug)
    nombre    TEXT NOT NULL,               -- Nombre legible
    zona_id   TEXT REFERENCES public.zonas(id),
    revisado  BOOLEAN NOT NULL DEFAULT FALSE  -- Para el wizard de revisión
);
```

**RLS:** Lectura pública / Escritura solo admin.

**Total:** ~311 barrios distribuidos en 7 zonas principales.

---

#### `tarifas` — Matriz de tarifas zona × zona

```sql
CREATE TABLE public.tarifas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zona_origen_id  TEXT NOT NULL REFERENCES public.zonas(id) ON DELETE CASCADE,
    zona_destino_id TEXT NOT NULL REFERENCES public.zonas(id) ON DELETE CASCADE,
    valor           INTEGER NOT NULL CHECK (valor >= 0),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (zona_origen_id, zona_destino_id)
);
```

**RLS:** Lectura pública / Escritura solo admin.

**Ejemplo:** `(centro, villa_inglesa) → 7000` (pesos colombianos)

---

#### `recargos` — Recargos adicionales

```sql
CREATE TABLE public.recargos (
    codigo  TEXT PRIMARY KEY,
    nombre  TEXT NOT NULL,
    tipo    TEXT,
    valor   INTEGER NOT NULL DEFAULT 0
);
```

**RLS:** Lectura pública / Escritura solo admin.

**Ejemplo de recargos:**

| Código | Nombre | Tipo | Valor |
|--------|--------|------|-------|
| `peso_20` | Más de 20 kilos | peso | 3000 |
| `fragil` | Artículo frágil | condicion | 2000 |

---

### 3.2 Funciones SQL

#### `calcular_tarifa(p_barrio_origen TEXT, p_barrio_destino TEXT)`

```sql
CREATE FUNCTION public.calcular_tarifa(
    p_barrio_origen TEXT,
    p_barrio_destino TEXT
) RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
    v_zona_origen  TEXT;
    v_zona_destino TEXT;
    v_valor        INTEGER;
BEGIN
    -- Buscar zona del barrio origen
    SELECT zona_id INTO v_zona_origen
    FROM barrios WHERE id = p_barrio_origen;

    -- Buscar zona del barrio destino
    SELECT zona_id INTO v_zona_destino
    FROM barrios WHERE id = p_barrio_destino;

    -- Si algún barrio no existe o está en zona roja, retornar NULL
    IF v_zona_origen IS NULL OR v_zona_destino IS NULL THEN
        RETURN NULL;
    END IF;
    IF v_zona_origen = 'zona_roja' OR v_zona_destino = 'zona_roja' THEN
        RETURN NULL;
    END IF;

    -- Buscar tarifa en la matriz (directa)
    SELECT valor INTO v_valor
    FROM tarifas
    WHERE zona_origen_id = v_zona_origen AND zona_destino_id = v_zona_destino;

    -- Si no existe, intentar sentido inverso (matriz simétrica)
    IF v_valor IS NULL THEN
        SELECT valor INTO v_valor
        FROM tarifas
        WHERE zona_origen_id = v_zona_destino AND zona_destino_id = v_zona_origen;
    END IF;

    RETURN v_valor;
END;
$$;
```

#### `es_admin()`

```sql
CREATE FUNCTION public.es_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.admins WHERE user_id = auth.uid()
    );
$$;
```

---

### 3.3 Políticas RLS (Row Level Security)

| Tabla | SELECT | INSERT/UPDATE/DELETE |
|-------|--------|---------------------|
| `admins` | Solo el propio usuario | Solo SQL (no desde cliente) |
| `zonas` | Público | Solo admin (`es_admin()`) |
| `tarifas` | Público | Solo admin (`es_admin()`) |
| `barrios` | Público | Solo admin (`es_admin()`) |
| `recargos` | Público | Solo admin (`es_admin()`) |

---

## 4. Endpoints de API

### 4.1 Autenticación

#### `POST /api/login`

**Request:**
```json
{
  "email": "admin@tudominio.com",
  "password": "contraseña"
}
```

**Response (200):**
```json
{
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "refresh_token": "v1.MHh8...",
    "email": "admin@tudominio.com",
    "esAdmin": true
  }
}
```

**Errores:**
- `400`: Faltan email o password
- `401`: Credenciales incorrectas
- `403`: Usuario no es administrador

---

#### `GET /api/sesion`

**Headers:**
```
Authorization: Bearer <access_token>
X-Refresh-Token: <refresh_token>  (opcional, para renovar si expiró)
```

**Response (200):**
```json
{
  "data": {
    "email": "admin@tudominio.com",
    "esAdmin": true,
    "token": null,              // Nuevo token si se renovó
    "refresh_token": null       // Nuevo refresh si se renovó
  }
}
```

**Errores:**
- `401`: Sesión inválida o expirada
- `403`: No es administrador

---

### 4.2 CRUD Genérico

Los endpoints `zonas`, `tarifas`, `barrios` y `recargos` usan el handler genérico `manejadorTabla()`.

#### Lectura (GET) — Pública

```
GET /api/zonas
GET /api/zonas?select=id,nombre,tipo
GET /api/zonas?orden=nombre
GET /api/barrios?filtro=zona_id=centro
GET /api/tarifas?filtro=zona_origen_id=centro&filtro=zona_destino_id=norte_1_18
```

**Response:**
```json
{
  "data": [
    { "id": "centro", "nombre": "Centro", "tipo": "urbana" },
    ...
  ]
}
```

---

#### Insert (POST) — Solo admin

**Headers:** `Authorization: Bearer <token>`

```
POST /api/zonas
Content-Type: application/json

{
  "op": "insert",
  "filas": [
    { "id": "nueva_zona", "nombre": "Nueva Zona", "tipo": "urbana" }
  ]
}
```

---

#### Upsert (POST) — Solo admin

```
POST /api/tarifas
Content-Type: application/json

{
  "op": "upsert",
  "filas": [
    { "zona_origen_id": "centro", "zona_destino_id": "norte_1_18", "valor": 6000 }
  ],
  "onConflict": "zona_origen_id,zona_destino_id"
}
```

**Caso especial para barrios** (sin índice único en `nombre`):
- El endpoint deduplica por nombre antes de insertar

---

#### Update (PUT) — Solo admin

```
PUT /api/zonas?filtro=id=nueva_zona
Content-Type: application/json

{
  "datos": { "nombre": "Nombre Actualizado", "tipo": "destino_solo" }
}
```

---

#### Delete (DELETE) — Solo admin

```
DELETE /api/zonas?filtro=id=nueva_zona
DELETE /api/tarifas?filtro=zona_origen_id=centro&filtro=zona_destino_id=norte_1_18
DELETE /api/barrios?filtro=id=nombre_del_barrio
DELETE /api/recargos?filtro=codigo=peso_20
```

---

### 4.3 Cálculo de Tarifa (RPC)

#### `POST /api/calcular_tarifa`

**Request:**
```json
{
  "p_barrio_origen": "barrio_7_de_agosto",
  "p_barrio_destino": "nueva_cecilia"
}
```

**Response:**
```json
{
  "data": 7000
}
```

**Nota:** Retorna `null` si el barrio no existe o está en zona roja.

---

## 5. Cliente API (stargo.js)

### 5.1 Descripción

El archivo `stargo.js` es una librería cliente que encapsula todas las llamadas a la API. Se carga como `<script src="stargo.js">` y expone `window.api`.

### 5.2 Métodos Disponibles

```javascript
// Autenticación
api.login(email, password)        // → Promise<{data, error}>
api.sesion()                       // → Promise<{data, error}>
api.salir()                        // → void (limpia localStorage)

// Consultas (patrón Supabase-like)
api.from('tabla')                  // → Consulta builder
  .select('col1, col2')           // GET con select
  .eq('columna', valor)           // Filtro WHERE
  .order('columna')               // ORDER BY
  .insert(filas)                  // POST insert
  .upsert(filas, opts)            // POST upsert
  .update(datos)                  // PUT update
  .delete()                       // DELETE

// RPC (llamadas a funciones SQL)
api.rpc('nombre_funcion', params)  // → Promise<{data, error}>
```

### 5.3 Ejemplos de Uso

```javascript
// Cargar zonas
const { data: zonas, error } = await api.from('zonas').select('id, nombre, tipo');

// Crear zona
const { error } = await api.from('zonas').insert({ 
  id: 'nueva', nombre: 'Nueva Zona', tipo: 'urbana' 
});

// Actualizar tarifa
const { error } = await api.from('tarifas')
  .eq('zona_origen_id', 'centro')
  .eq('zona_destino_id', 'norte_1_18')
  .update({ valor: 7000 });

// Eliminar barrio
const { error } = await api.from('barrios').eq('id', 'nombre_barrio').delete();

// Calcular tarifa
const { data: valor } = await api.rpc('calcular_tarifa', {
  p_barrio_origen: 'barrio_a',
  p_barrio_destino: 'barrio_b'
});
```

### 5.4 Almacenamiento de Tokens

| Clave localStorage | Descripción |
|-------------------|-------------|
| `stargo_token` | Access token JWT |
| `stargo_refresh_token` | Refresh token para renovar sesión |

---

## 6. Variables de Entorno

### 6.1 Requeridas

```bash
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...

# ⚠️ NUNCA exponer SUPABASE_SERVICE_ROLE_KEY al cliente
# Solo se usa en las Serverless Functions
```

### 6.2 Configuración en Vercel

1. Ir a **Project → Settings → Environment Variables**
2. Agregar `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`
3. El archivo `.env.example` sirve como plantilla de referencia

### 6.3 Variables para SvelteKit

En SvelteKit, estas variables se acceden como:
- `PRIVATE_SUPABASE_URL` (server-only)
- `PRIVATE_SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `PUBLIC_SUPABASE_URL` (si necesitas exponerla al cliente)

---

## 7. Páginas Frontend

### 7.1 Calculadora de Tarifas (`calculadora_tarifas.html`)

**Funcionalidad:**
- Selección de barrio origen y destino (autocomplete)
- Cálculo automático de tarifa base
- Selección de recargos aplicables
- Muestra desglose: base + recargos = total

**Conexión con API:**
- Carga barrios al iniciar: `api.from('barrios').select(...)`
- Carga recargos al iniciar: `api.from('recargos').select(...)`
- Calcula tarifa: `api.rpc('calcular_tarifa', {...})`

---

### 7.2 Panel de Administración (`admin.html`)

**Secciones:**

1. **Login** — Formulario email/contraseña
2. **Resumen** — Estadísticas (zonas, tarifas, barrios, zona roja)
3. **Pestañas:**
   - **Zonas** — CRUD de zonas tarifarias
   - **Tarifas** — Matriz editable origen × destino
   - **Barrios** — Wizard de revisión + lista general
   - **Recargos** — CRUD de recargos

**Funcionalidades especiales:**
- **Wizard de barrios:** Formulario paso a paso para revisar/asignar zonas
- **Matriz de tarifas:** Edición inline con indicador de cambios pendientes
- **Sincronizar barrios.json:** Importa barrios desde el archivo JSON
- **Deshacer:** Revierte el último cambio de zona (hasta 50 en historial)

---

## 8. Lógica de Negocio

### 8.1 Cálculo de Tarifa

```
Barrio Origen → Zona Origen → [Matriz Tarifas] ← Zona Destino ← Barrio Destino
```

1. Buscar `zona_id` del barrio origen en tabla `barrios`
2. Buscar `zona_id` del barrio destino en tabla `barrios`
3. Si alguna zona es `zona_roja` → retornar `null` (no disponible)
4. Buscar valor en `tarifas` donde `zona_origen_id = X AND zona_destino_id = Y`
5. Si no existe, intentar sentido inverso (matriz simétrica)

### 8.2 Matriz de Tarifas

La matriz es **simétrica** excepto para la diagonal:

| Origen ↓ / Destino → | Centro | Norte 1-18 | Norte 19-37 | ... |
|----------------------|--------|------------|-------------|-----|
| **Centro** | $5.000 | $6.000 | $7.000 | ... |
| **Norte 1-18** | $6.000 | $5.000 | $6.000 | ... |
| **Norte 19-37** | $7.000 | $6.000 | $5.000 | ... |

- **Diagonal (mismo sector):** $5.000
- **Fuera de diagonal:** Variable según distancia

### 8.3 Tarifas Ejemplo (2026)

| Origen | Destino | Valor |
|--------|---------|-------|
| Centro | Norte 1-18 | $6.000 |
| Centro | Norte 19-37 | $7.000 |
| Centro | Norte 38-50 | $8.000 |
| Centro | Sur 27-50 | $6.000 |
| Centro | Villa Inglesa | $7.000 |
| Centro | Caño Cristales | $9.000 |

### 8.4 Orden de Zonas en UI

```javascript
const ORDEN_ZONAS = [
  'centro',
  'norte_1_18',
  'norte_19_37',
  'norte_38_50',
  'sur_27_50',
  'sur_despues_naranjos',
  'sur_despues_puerto_espejo',
  'villa_inglesa',
  'cano_cristales',
  'setta_departamental'
];
```

### 8.5 Mapeo JSON → Zona

```javascript
const MAPA_JSON_ZONA = {
  'Centro': 'centro',
  'Norte (38-50)': 'norte_38_50',
  'Norte (19-37)': 'norte_19_37',
  'Norte (1-18)': 'norte_1_18',
  'Sur (calle 27 - calle 50)': 'sur_27_50',
  'Sur (después de Los Naranjos y Platinos)': 'sur_despues_naranjos',
  'Sur (después de Puerto Espejo y Cementerio)': 'sur_despues_puerto_espejo'
};
```

---

## 9. Notas de Migración a SvelteKit

### 9.1 Estructura Propuesta

```
stargo-sveltekit/
├── src/
│   ├── lib/
│   │   ├── server/
│   │   │   └── supabase.ts          # Cliente Supabase (server-only)
│   │   ├── supabase.ts              # Cliente Supabase (browser)
│   │   └── components/
│   │       ├── Login.svelte
│   │       ├── MatrizTarifas.svelte
│   │       ├── WizardBarrios.svelte
│   │       └── ...
│   ├── routes/
│   │   ├── +page.svelte             # Redirect → /calculadora
│   │   ├── calculadora/
│   │   │   └── +page.svelte         # Calculadora pública
│   │   ├── admin/
│   │   │   ├── +page.svelte         # Panel admin (requiere auth)
│   │   │   └── +layout.server.ts    # Verificar sesión
│   │   └── api/
│   │       ├── login/+server.ts     # POST login
│   │       ├── sesion/+server.ts    # GET sesión
│   │       ├── zonas/+server.ts     # CRUD zonas
│   │       ├── tarifas/+server.ts   # CRUD tarifas
│   │       ├── barrios/+server.ts   # CRUD barrios
│   │       ├── recargos/+server.ts  # CRUD recargos
│   │       └── calcular_tarifa/+server.ts
│   └── app.html
├── static/
│   └── barrios.json
├── .env
├── package.json
├── svelte.config.js
└── vite.config.ts
```

### 9.2 Conversiones Clave

| Actual (Vanilla JS) | SvelteKit |
|---------------------|-----------|
| `window.api.from(...)` | `fetch('/api/...', ...)` o client-side API |
| `<script src="stargo.js">` | Importar módulo o usar fetch directo |
| `localStorage` para tokens | Cookies httpOnly (más seguro) |
| `api/_lib.js` functions | `src/lib/server/supabase.ts` |
| `vercel.json` functions | `svelte.config.js` adapter |
| Variables `process.env` | `$env/static/private` |

### 9.3 Ventajas de SvelteKit

1. **SSR/SSG:** La calculadora puede pre-renderizarse
2. **Cookies httpOnly:** Tokens más seguros que localStorage
3. **Form actions:** Manejo nativo de formularios
4. **Load functions:** Carga de datos server-side
5. **Type safety:** TypeScript integrado
6. **Hot module replacement:** Desarrollo más rápido

### 9.4 Datos Estáticos

El archivo `barrios.json` contiene ~311 barrios. Puede ser:
- Importado estáticamente en SvelteKit
- Servido desde `/static/barrios.json`
- Cargado desde la API al iniciar

### 9.5 Próximos Pasos

1. [ ] Inicializar proyecto SvelteKit
2. [ ] Configurar Supabase client (server + browser)
3. [ ] Migrar esquema de BD (los SQL ya están listos)
4. [ ] Crear API routes equivalentes
5. [ ] Migrar componentes UI a Svelte
6. [ ] Implementar autenticación con cookies
7. [ ] Testing y deployment

---

## Archivos SQL para Migración

Los archivos SQL están listos para ejecutar en Supabase:

1. **`migracion_panel_barrios.sql`** — Tabla barrios + zona roja
2. **`migracion_admin_zonas_tarifas.sql`** — Admin + zonas + tarifas + RLS

Ejecutar en orden: primero `panel_barrios`, luego `admin_zonas_tarifas`.

---

## Contacto y Soporte

- **Ciudad:** Armenia, Quindío, Colombia
- **Año:** 2026
- **Stack:** StarGo — Calculadora de domicilios
