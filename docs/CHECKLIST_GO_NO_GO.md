# Checklist pre-lanzamiento — Go/No-Go (Parte 10)

Antes de cada **release importante a producción**, ejecuta el checklist
completo. No es una formalidad: cada punto existe porque un fallo en
producción en ese punto costó horas (o un cliente) a alguien.

Hay dos formas de correrlo:

```bash
bun run go-no-go                    # veredicto GO/NO-GO + gates locales
bun run go-no-go --e2e              # incluye la suite E2E (requiere Supabase/staging)
bun run go-no-go --reporte release-2026-08.json   # deja el reporte en el repo/PR
```

Los **items automatizados** se ejecutan solos. Los **items manuales** se
evalúan contra fechas registradas con ventana de validez:

```bash
bun run go-no-go --marcar realtime   # tras la prueba manual de Realtime
bun run go-no-go --marcar backup --nota "PITR activo, restauración de emergencia probada"
bun run go-no-go --marcar rollback --nota "rollback del 2.1.0 verificado en staging"
```

El veredicto es **GO solo si los 10 puntos pasan**. Cualquier fail, pendiente
o no ejecutable → **NO-GO** (exit 1), para que el pipeline de release no
avance. Las ventanas se ajustan con `GO_NO_GO_VENTANA_<CLAVE>_DIAS`
(p. ej. `GO_NO_GO_VENTANA_BACKUP_DIAS=1`).

---

## 1. Suite unitaria en verde + cobertura de lógica ≥ 90%

**Criterio**: `bun run test:coverage` pasa y la cobertura de `src/lib/logic`
no baja del 90% (el gate de Vitest ya falla el proceso; el runner lo lee
además de `coverage/coverage-summary.json`).

```bash
bun run test:coverage
```

**Si falla**: corregir antes de seguir. Es la base de la pirámide: si aquí
falla, nada de lo demás da confianza.

## 2. Suite de RLS en verde — sin excepciones

**Criterio**: `bun run test:rls` corre contra Supabase local y **pasa sin
tests omitidos ni "temporales" permisivas**. Ningún cambio de políticas se
mergea sin que pase (gate del job `rls-tests` del CI).

```bash
supabase start
cp .env.test.example .env.test
bun run test:rls
```

**Antes de cada release**, además, revisa manualmente:

```sql
-- No debe haber políticas sin rol acotado ni comandos sospechosos:
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies ORDER BY tablename;
```

## 3. Suite de integración en verde contra local/staging

**Criterio**: `bun run test:integration` (build + preview + HTTP real) en
verde contra Supabase local o un staging dedicado.

```bash
supabase start
cp .env.test.example .env.test
bun run test:integration
```

> En el CI lo cubre el job `integration-tests`. En staging de verdad
> (opcional previo a release): `TEST_BASE_URL=https://preview.stargo.app bun run test:integration`.

## 4. Suite E2E en verde contra staging/preview

**Criterio**: la matriz E2E (Chromium + WebKit × desktop + móvil) pasa
contra el ambiente de staging/preview, no solo contra local.

```bash
bun run test:e2e                # contra Supabase local
# Contra un preview de Vercel (con Supabase de staging):
TEST_BASE_URL=https://preview-xxxx.vercel.app bun run test:e2e
# E incluirla en el checklist:
bun run go-no-go --e2e
```

En cada PR lo cubre `.github/workflows/e2e-preview.yml` contra el preview.

## 5. Prueba manual de Realtime con dos sesiones

**Criterio**: la checklist manual de la Parte 6 completada hace ≤14 días
(ventana `realtime`), con los 4 casos ✅.

```bash
bun run go-no-go --marcar realtime --nota "casos 1-4 ✅"
```

Sigue los pasos de [`docs/CHECKLIST_REALTIME.md`](CHECKLIST_REALTIME.md):
reconexión tras caída de red, fugas de suscripciones, Realtime caído →
modo refresh manual, y aislamiento entre 3 sesiones.

## 6. Última prueba de carga no más vieja que el último cambio estructural

**Criterio**: `docs/REPORTE_CARGA.md` completado (con punto de quiebre por
encima del volumen real esperado × 3-5) y ejecutado hace ≤14 días, o después
de cualquier cambio estructural relevante (índices, queries de cálculo,
lógica de creación de pedidos).

```bash
# k6 (Parte 7): hora pico + path más transitado
k6 run scripts/k6/carga-crear-pedidos.js
k6 run scripts/k6/carga-calcular-tarifa.js
bun run go-no-go --marcar carga --nota "10.000 pedidos/h sin degradación; quiebre en X"
```

## 7. Smoke test post-deploy configurado y funcionando

**Criterio**: `.github/workflows/smoke-postdeploy.yml` configurado con los
secretos `SMOKE_*` y el último run fue exitoso hace ≤7 días (ventana `smoke`).
Verifica: login por rol → cálculo de tarifa → pedido de prueba cancelado.

```bash
# Local, contra producción:
SMOKE_URL=https://stargo.app SMOKE_ADMIN_EMAIL=... SMOKE_ADMIN_PASSWORD=... bun run test:smoke
```

## 8. Alertas verificadas con fallo forzado

**Criterio**: una prueba **real** de fallo forzado (no simulada en papel)
hace ≤14 días (ventana `alertas`): el error 500 a propósito llega al webhook
y a Sentry.

```bash
BASE_URL=https://stargo.app CRON_SECRET=... bun run test:alertas
# → ?prueba=1 (alerta de prueba) + POST /api/alertas/probar (500 provocado)
bun run go-no-go --marcar alertas --nota "500 provocado llegó al webhook en <1 min"
```

Guía: [`docs/MONITOREO.md`](MONITOREO.md).

## 9. Backup de base de datos reciente confirmado

**Criterio**: un backup restaurable de la BD de producción **confirmado**
hace ≤7 días (ventana `backup`). Confirmar ≠ asumir.

**Supabase (planes pagos)**: los backups automáticos están activos y sabes
restaurar.

1. Dashboard → **Database → Backups**:
   - Verifica que **Continuous backups / PITR** esté **ON** (habilita
     point-in-time a cualquier segundo de los últimos ~28 días).
   - Verifica que el **último backup** (cron diario) sea de las últimas 24 h.
   - En el plan **Free/Pro sin PITR**: activa el **backup manual** antes del
     release: *Database → Backups → Create a backup* → descárgalo.
2. **Sabe restaurar (de verdad)**:
   - PITR: *Database → Backups → Restore* → elige el punto (antes del
     release). Crea un proyecto temporal en vez de pisar producción si no
     estás seguro.
   - Backup manual: restaura con `supabase db restore` (CLI) o creando un
     proyecto nuevo y subiendo el dump.
3. **Prueba la restauración** al menos una vez en un proyecto desechable:
   resta el backup en un proyecto temporal y verifica que las tablas
   (`zonas`, `barrios`, `tarifas`, `recargos`, `pedidos`, `domiciliarios`,
   `admins`) y las RPCs responden. Una restauración que nunca se probó es
   una restauración rota.

```bash
bun run go-no-go --marcar backup --nota "PITR activo + restauración probada en temporal"
```

## 10. Plan de rollback documentado y probado al menos una vez

**Criterio**: el plan de rollback se ejecutó de verdad al menos una vez
(hace ≤90 días, ventana `rollback`) y está documentado abajo.

---

## Plan de rollback (Vercel + Supabase)

### Escenario 1 — El código nuevo rompe (bugs, 5xx, UI rota)

1. **Vercel**: **Deployments → [deploy roto] → ⋯ → Rollback** (o
   `vercel rollback` en CLI). Vuelve al último deploy estable.
   - Los **preview deployments** de cada PR no afectan producción.
   - El rollback de Vercel es instantáneo (el artefacto anterior ya está
     desplegado).
2. **Verifica** el smoke test (Parte 8) contra la versión restaurada:
   `.github/workflows/smoke-postdeploy.yml` o `bun run test:smoke`.
3. El **código roto sigue en `main`**: revierte el commit o corrige; el
   próximo deploy vuelve a avanzar.

### Escenario 2 — El esquema de BD cambió (migración nueva)

Aquí el rollback de Vercel **no basta**: la migración ya se aplicó.

- **Migración aditiva** (crea tablas/columnas, no borra nada — el patrón de
  este proyecto): rollback de código es seguro. La BD nueva convive con el
  código viejo. Ejemplo: la columna `recargos` de la Fase 7 no rompe el
  código previo.
- **Migración destructiva o con cambio de contrato** (renombra/borra/agrega
  NOT NULL): decide antes del deploy cómo revertir la BD:
  - `supabase db diff` para generar la migración inversa y tenerla a mano, o
  - restaurar el backup PITR al punto previo al release (punto 9) — esto
    pierde los datos posteriores; si el release lleva minutos, es aceptable.
- **Nunca** fuerces un deploy nuevo sobre una BD a medio migrar sin probar
  la migración inversa en staging antes.

### Escenario 3 — Feature flag en vez de rollback

Para cambios riesgosos, usa el **feature flag** de la Parte 8
(`src/lib/server/flags.ts`): apagar el flag es más rápido y menos traumático
que un rollback. Solo aplica cuando el código nuevo convive con el viejo
(cambio tras un flag, no un cambio de esquema incompatible).

### Orden de operación (resumen)

1. Apagar feature flags del cambio (si aplican).
2. `vercel rollback` al último deploy estable.
3. Verificar `/api/health` + smoke test.
4. Si el problema es de datos: restaurar PITR al punto previo al release
   (con ojo al rango de pérdida) o aplicar la migración inversa probada.
5. Revisar Sentry/errores_app para confirmar que los 5xx cesaron.
6. Documentar la causa y el post-mortem antes de reintentar el deploy.

---

## Registrar verificaciones manuales

```bash
bun run go-no-go --marcar realtime --nota "…"
bun run go-no-go --marcar carga --nota "…"
bun run go-no-go --marcar smoke --nota "…"
bun run go-no-go --marcar alertas --nota "…"
bun run go-no-go --marcar backup --nota "…"
bun run go-no-go --marcar rollback --nota "…"
```

El estado vive en `.go-no-go-estado.json` (gitignored, local). En un release
**importante**, además: ejecuta `bun run go-no-go --reporte <archivo>` y
adjunta el reporte al PR/commit del release, o corre el workflow
`.github/workflows/release-gate.yml` (dispatch manual) que ejecuta todo en
CI contra Supabase local y sube el reporte como artefacto.

---

## Registro de releases

| Versión | Fecha | Veredicto | Notas (fallos encontrados y corregidos) |
|---|---|---|---|
| 1.0.0 | __/__/____ | GO / NO-GO | |
| | | | |
