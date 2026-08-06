# Fase 8 — Seguridad, QA y PWA (lista para producción)

Documento de verificación y checklist de la Fase 8. Complementa los scripts
automáticos: `supabase/audit_rls.sql`, los tests unitarios (`bun test`) y el
typecheck (`bun run check`).

---

## 1. Seguridad — estado actual y checklist

### 1.1 Resultado del auditor

| Ítem | Estado | Cómo se verifica |
|---|---|---|
| **HTTPS** | ✅ Vercel fuerza HTTPS en producción | Header `strict-transport-security` en el dominio Vercel; cookies `secure` en prod (`auth.ts`) |
| **JWT en cookies httpOnly** | ✅ `stargo_access_token` / `stargo_refresh_token` con `httpOnly + sameSite:lax` | `src/lib/server/auth.ts` |
| **Sin tokens en localStorage** | ✅ El código de la app no guarda tokens en `localStorage` (solo comentarios) | `grep -rn localStorage src/` |
| **Sin service role key en frontend** | ✅ Solo se usan `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY` (públicos por diseño) | `grep -rniE 'service_role|sk_live|SECRET' src/` → 0 resultados |
| **CSP** | ✅ Configurada en `vite.config.ts` (solo producción, nonce automático, `connect-src` a `*.supabase.co` + `wss`) | Revisar directivas en `vite.config.ts` |
| **Headers de seguridad** | ✅ `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` | `src/hooks.server.ts` |
| **RLS** | ✅ Ver matriz en 1.3 + ejecutar `supabase/audit_rls.sql` | `pg_policies` / `role_table_grants` |
| **Escrituras de pedidos solo por RPC** | ✅ `crear_pedido`, `asignar_domiciliario`, `transicionar_pedido`, `cancelar_pedido_cliente` son `SECURITY DEFINER` y validan rol/estado en BD | Migraciones SQL |

### 1.2 Comandos de verificación

```bash
# Keys sensibles (debe salir vacío en src/):
grep -rniE 'service_role|sk_live|SUPABASE_SERVICE' src/

# Tokens en localStorage (solo comentarios):
grep -rn 'localStorage' src/

# CI: los secretos solo se referencian como ${{ secrets.* }} en GitHub Actions:
grep -rn 'secrets\.' .github/
```

### 1.3 Matriz RLS (lo que debe cumplirse)

| Tabla | anon | authenticated (sin RPC) | Escritura directa |
|---|---|---|---|
| `zonas` | SELECT | SELECT | solo admin (RLS) |
| `barrios` | SELECT | SELECT | solo admin (RLS) |
| `tarifas` | SELECT | SELECT | solo admin (RLS) |
| `recargos` | SELECT | SELECT | solo admin (RLS) |
| `pedido_eventos` | SELECT | SELECT | solo trigger |
| `pedidos` | ✗ sin grants | SELECT (RLS: admin todo / dom. solo suyos) | ✗ |
| `historial_estados` | ✗ sin grants | SELECT (RLS) | ✗ |
| `domiciliarios` | ✗ sin grants | SELECT (RLS) | ✗ |
| `admins` | ✗ sin grants | SELECT propio (RLS) | ✗ |

**Hardening aplicable**: `supabase/audit_rls.sql` revoca de `anon` cualquier
permiso sobre las tablas privadas y revoca escritura directa (`INSERT/UPDATE/
DELETE`) de `authenticated` sobre pedidos/historial/domiciliarios/admins.
El acceso anónimo a pedidos sigue funcionando SOLO vía las funciones públicas
(`crear_pedido`, `consultar_pedido`, `cancelar_pedido_cliente`).

---

## 2. Pruebas de flujo por rol (usuarios de prueba)

Prepara 3 usuarios en **Supabase → Authentication → Users → Add user**:
- `cliente@prueba.stargo` (sin rol; anónimo de todos modos hace el flujo público)
- `domiciliario@prueba.stargo` (registrarlo en Admin → Domiciliarios)
- `admin@prueba.stargo` (ejecutar `supabase/agregar_admin.sql` con su email)

### 2.1 Cliente (público, sin login)

| # | Flujo | Resultado esperado |
|---|---|---|
| 1 | `/nuevo-pedido` → seleccionar origen/destino | Tarifa base calculada al instante |
| 2 | Marcar recargos (compra, peso, pago…) | Desglose `base + recargos = total` + advertencia «estimado» |
| 3 | Dejar dirección vacía y confirmar | Errores por campo visibles |
| 4 | Confirmar con todo completo | Código de seguimiento + desglose en pantalla |
| 5 | `/consultar-estado` con el código | Timeline completo + desglose de recargos |
| 6 | Cancelar con motivo (pendiente) | Confirmación + badge «Cancelado» con motivo |
| 7 | Cancelar un pedido ya asignado | Error «Solo se puede cancelar un pedido pendiente» |
| 8 | `GET /api/pedidos` sin sesión | 401 (no autenticado) |

### 2.2 Domiciliario (login)

| # | Flujo | Resultado esperado |
|---|---|---|
| 1 | `/login` con su cuenta | Redirige a `/domiciliario` |
| 2 | Ver pedidos asignados | Solo los suyos (no ve los de otros) |
| 3 | Transiciones `asignado → aceptado → recogido → en_camino → entregado` | Cada cambio registrado en historial |
| 4 | Intentar `GET /admin/*` | Redirige/login (guard por rol) |
| 5 | Intentar `POST /api/reportes` o `/api/reportes/csv` | 403 (solo admin) |
| 6 | Intentar cancelar un pedido | Error de la máquina de estados en BD |

### 2.3 Admin (login)

| # | Flujo | Resultado esperado |
|---|---|---|
| 1 | `/login` → `/admin` | Dashboard con stats de hoy |
| 2 | Asignar domiciliario a pedido pendiente | Estado `asignado` + historial |
| 3 | Cancelar con motivo (modal) | `motivo_cancelacion` visible en historial |
| 4 | CRUD de recargos (crear/editar/activar/eliminar) | Se refleja en `/nuevo-pedido` |
| 5 | `/admin/reportes` con rango + CSV | Descarga válida (Excel) |
| 6 | Eliminar zona con barrios | Error/bloqueo por FK (ON DELETE RESTRICT) |

---

## 3. PWA — instalación y offline

### 3.1 Instalación

- **Android (Chrome)**: abrir la URL → menú ⋮ → **Instalar app**. Requiere HTTPS.
- **iOS (Safari)**: **Compartir → Añadir a pantalla de inicio** (usa `apple-touch-icon.png`).
- **Desktop (Chrome/Edge)**: ícono de instalación en la barra de direcciones.
- Requisitos cubiertos: `manifest.webmanifest` (name, icons ≥192/512 + maskable,
  `display: standalone`, theme/background color, shortcuts) y service worker.

### 3.2 Offline básico

- **Service worker** (`src/service-worker.ts`): precachea JS/CSS del build y
  estáticos; navegaciones *network-first* con respaldo en caché; si no hay red
  ni copia → sirve **`/offline.html`** («Estás sin conexión», con reintento
  automático al volver la conexión).
- **Banner** `IndicadorOffline.svelte` en el layout raíz: aviso fijo cuando el
  navegador está sin conexión.
- La API (`/api/*`) nunca se cachea: sesión y pedidos siempre requieren red.

> Verificación: en producción, abrir la app → DevTools → Network → Offline →
> recargar → debe aparecer la pantalla «sin conexión» (si la página no se había
> visitado) o la versión cacheada.

---

## 4. Performance — build de producción

Medido con `bun run build` (vite 8, rolldown). Build completo: **~4.3 s**.

| Chunk (cliente) | Tamaño | gzip |
|---|---|---|
| `DAV-Kvwp.js` (supabase-js + FA + runtime compartido) | 207.6 kB | 53.7 kB |
| `CS-sVvTG.js` | 75.1 kB | 24.4 kB |
| `w1loOGbP.js` | 55.0 kB | 20.8 kB |
| `CbNGa6BK.js` | 34.6 kB | 13.0 kB |
| CSS (Tailwind) | 48.9 kB | 9.0 kB |
| **Service worker** | 2.9 kB | 1.1 kB |

**Carga inicial estimada de la landing**: ~100 kB gzip (JS+CSS), saludable para
una app SvelteKit. El service worker hace las visitas siguientes instantáneas.

**Recomendaciones (opcionales, no bloqueantes):**
- El chunk de 207 kB es compartido (supabase-js para Realtime + iconos FA).
  Los iconos ya están tree-shaken por el registro; si el tamaño preocupa, mover
  el cliente de Realtime a un `import()` dinámico (solo se usa en páginas que
  se suscriben).
- El CSS de Tailwind (9 kB gzip) ya está optimizado por la build.
- Imágenes grandes (`og-image.png`, `icon-1024.png`) quedan fuera del precache
  del service worker a propósito.

---

## 5. Checklist final antes de producción

- [ ] Ejecutar `supabase/audit_rls.sql` y confirmar la matriz del punto 1.3
- [ ] Crear los 3 usuarios de prueba y correr el plan del punto 2
- [ ] Deploy en Vercel con `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY`
- [ ] Verificar instalación PWA en Android/iOS/Desktop (punto 3.1)
- [ ] Probar offline (punto 3.2)
- [ ] Lighthouse (Performance/Accessibility/Best Practices ≥ 90)
- [ ] Confirmar que el repo no contiene `.env` ni keys (`.gitignore`)
