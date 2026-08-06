# Reporte de carga y rendimiento — StarGo (Parte 7)

> 🏁 **Estado**: ⏳ pendiente de ejecutar (requiere k6 y un entorno con datos sembrados).
> Este documento es la plantilla y el procedimiento; los resultados se completan
> tras correr las pruebas contra el preview local o el deploy.

## Objetivo

Confirmar que el sistema aguanta el **uso real esperado** con margen (3-5×) y
documentar el **punto de quiebre** de cada path crítico.

## Escenario de uso esperado (referencia)

> Completar con datos reales del negocio. Referencia: un pueblo/ciudad pequeña
> con 2-5 domiciliarios activos.

| Métrica | Valor esperado |
| --- | --- |
| Pedidos por hora (hora pico) | ~30 |
| Pedidos por minuto (hora pico) | ~0.5 |
| Consultas de tarifa por minuto | ~1-2 |
| Domiciliarios simultáneos | 2-5 |
| Conexiones Realtime concurrentes | ~10 (clientes viendo estado + paneles) |

## Ejecución

```bash
# 1. Supabase local + catálogo sembrado
supabase start
bun run test:rls   # siembra datos (o usa el catálogo de producción/staging)

# 2. App en preview (o URL desplegada)
bun run build && bun run preview

# 3. Carga — creación de pedidos (hora pico)
k6 run scripts/k6/carga-crear-pedidos.js

# 4. Carga — cálculo de tarifa (path más transitado)
k6 run scripts/k6/carga-calcular-tarifa.js

# 5. Frontend — Lighthouse de las vistas críticas (en tu máquina, con Chrome)
bun run preview   # en otra terminal
LH_URL=http://127.0.0.1:4175 bun run perf:lighthouse
```

Para encontrar el **punto de quiebre**, subir VUs/duration progresivamente
(`--vus 50 --duration 2m`, luego 100, 200…) hasta que el p95 de latencia crece
de forma no lineal o `http_req_failed` supera el umbral.

## Resultados — k6 (crear pedidos)

| VUs | RPS | p50 | p95 | Errores | Observación |
| --- | --- | --- | --- | --- | --- |
| 20 |  |  |  |  | hora pico × 40 |
| 50 |  |  |  |  |  |
| 100 |  |  |  |  |  |

**Punto de quiebre (crear pedidos):** ______ VUs ≈ ______ pedidos/min.

## Resultados — k6 (cálculo de tarifa)

| VUs | RPS | p50 | p95 | Errores | Observación |
| --- | --- | --- | --- | --- | --- |
| 50 |  |  |  |  | path más transitado |
| 100 |  |  |  |  |  |
| 200 |  |  |  |  |  |

**Punto de quiebre (tarifa):** ______ VUs.

## Resultados — Realtime

- Conexiones Realtime simultáneas probadas: ______
- Límite del plan actual de Supabase: ______
- Comportamiento al acercarse al límite: ______

## Resultados — Lighthouse (mobile/desktop simulado)

| Vista | LCP (≤2.5s) | CLS (≤0.1) | TBT (≤200ms) | FCP (≤2s) |
| --- | --- | --- | --- | --- |
| `/nuevo-pedido` |  |  |  |  |
| `/` |  |  |  |  |
| `/admin` |  |  |  |  |

## Bundle (gate automático en CI)

- Presupuesto: JS ≤ 450 KB gzip · CSS ≤ 120 KB gzip · chunk mayor ≤ 250 KB.
- Último resultado de `bun run bundle:budget`: ______ KB JS / ______ KB CSS.

## Conclusión

- ¿El punto de quiebre está por encima del uso real esperado × 3-5? ______
- ¿Alguna recomendación (índices, caché, code splitting, límites Realtime)? ______
