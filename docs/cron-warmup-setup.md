# Warmup Cron — Configuración con cron-job.org

## Por qué un servicio externo

Vercel Hobby limita los crons internos a **una vez al día**. Para mantener
las funciones calientes (evitar cold starts de 500), necesitamos pingear
las rutas críticas cada 5 minutos. Un servicio externo hace HTTP requests
directos sin restricciones de plan.

## Paso 1: Crear cuenta

1. Ve a [cron-job.org](https://cron-job.org)
2. Crea una cuenta gratuita (no necesita tarjeta)

## Paso 2: Crear el cron job

1. Haz clic en **"Create"**
2. Configura:

| Campo | Valor |
|-------|-------|
| **URL** | `https://stargo-zeta.vercel.app/api/cron/warmup` |
| **Schedule** | Every 5 minutes |
| **Request method** | GET |
| **Request timeout** | 30 seconds |

3. En **"Notifications"** (opcional):
   - Configura email si quieres saber si falla
   - O déjalo sin notificaciones (es solo warmup, no crítico)

4. Haz clic en **"Save"**

## Paso 3: Verificar

1. En el dashboard de cron-job.org, haz clic en **"Run now"** para probar
2. Ve a [https://stargo-zeta.vercel.app/api/cron/warmup](https://stargo-zeta.vercel.app/api/cron/warmup) para ver la respuesta
3. Deberías ver algo como:

```json
{
  "ok": true,
  "rutas": [
    { "ruta": "/api/health", "status": 200, "ms": 386 },
    { "ruta": "/api/sesion", "status": 200, "ms": 70 },
    { "ruta": "/api/barrios", "status": 200, "ms": 45 },
    { "ruta": "/api/zonas", "status": 200, "ms": 38 }
  ],
  "total_ms": 400,
  "timestamp": "2026-08-27T00:00:00.000Z"
}
```

## Cómo funciona

```
cron-job.org (cada 5 min)
    ↓ HTTP GET
/api/cron/warmup
    ↓ fetch interno
/api/health → /api/sesion → /api/barrios → /api/zonas
    ↓
Cada fetch mantiene esa función serverless "caliente"
```

- **Sin el cron**: después de ~30 min sin tráfico, Vercel "congela" las
  funciones → cold start → 500 temporal
- **Con el cron**: cada 5 min las funciones se ejecutan → nunca se congelan

## Costo

- **cron-job.org**: gratis (plan gratuito permite hasta 50 cron jobs)
- **Vercel**: cada ejecución cuenta como 1 invocación de función
  - 1 invocación × 4 rutas = ~4 invocaciones por ping
  - 288 pings/día × 4 = ~1,152 invocaciones/día
  - Dentro del límite gratuito de Vercel (100K invocaciones/mes)
