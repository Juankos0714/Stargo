-- ============================================================
-- StarGo · Fase 20 — Push nativo (Capacitor + FCM/APNs)
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase.
-- Extiende push_subscriptions para soportar tokens nativos (FCM)
-- además de Web Push (VAPID). FCM unificado: Android recibe
-- directo, iOS recibe vía FCM → APNs.
--
-- CAMBIOS:
--   1) Columna `token` (nullable): almacena el device token FCM
--      para push nativo. NULL en suscripciones Web Push existentes.
--   2) Columna `plataforma` (nullable): 'android' | 'ios' para
--      tokens nativos. NULL en suscripciones Web Push.
--   3) El endpoint para tokens nativos tiene formato
--      `native://<plataforma>/<prefijo_token>`.
--   4) La Edge Function send-push se actualiza para enviar vía FCM
--      cuando detecta un token nativo, y vía Web Push (VAPID)
--      cuando detecta un endpoint de fcm.googleapis.com.
-- ============================================================

-- 1) Columnas nuevas (idempotente)
ALTER TABLE public.push_subscriptions
    ADD COLUMN IF NOT EXISTS token TEXT,
    ADD COLUMN IF NOT EXISTS plataforma TEXT CHECK (plataforma IN ('android', 'ios'));

-- 2) Índice para buscar por token (diagnóstico y limpieza)
CREATE INDEX IF NOT EXISTS idx_push_subs_token
    ON public.push_subscriptions (token) WHERE token IS NOT NULL;

-- 3) Comentario de documentación
COMMENT ON COLUMN public.push_subscriptions.token IS
    'Device token FCM para push nativo (Capacitor). NULL en suscripciones Web Push.';
COMMENT ON COLUMN public.push_subscriptions.plataforma IS
    'android | ios para tokens nativos. NULL en suscripciones Web Push.';

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT id, usuario_id, plataforma, token IS NOT NULL AS tiene_token,
--        endpoint LIKE 'native://%' AS es_nativo
-- FROM public.push_subscriptions
-- ORDER BY created_at DESC LIMIT 10;
