-- ============================================================
-- StarGo · Fase 18 (hardening) — es_backfill en comision_historico
-- ============================================================
-- Requiere la Fase 18 (comision_historico).
--
-- PROBLEMA QUE RESUELVE:
--   El backfill de la Fase 18 congeló los días previos a la migración con la
--   escalera ACTUAL porque las escaleras históricas reales son incognoscibles.
--   Esa aproximación ya estaba documentada, pero no había forma de distinguir
--   (de forma auditable) esos registros aproximados de los que se congelan en
--   tiempo real con la escalera vigente de su día.
--
-- SOLUCIÓN:
--   Columna booleana es_backfill (default FALSE) en comision_historico:
--     * Las filas creadas por el backfill de la Fase 18 quedan marcadas TRUE.
--     * Las filas que crea congelar_comisiones_dia() en tiempo real nacen
--       con FALSE (el RPC no las inserta con este campo → default).
--   Es un flag de auditoría, no cambia ningún cálculo.
-- ============================================================

ALTER TABLE public.comision_historico
    ADD COLUMN IF NOT EXISTS es_backfill BOOLEAN NOT NULL DEFAULT FALSE;

-- Marca las filas que existían al aplicar esta migración: en esta release la
-- migración de la Fase 18 corre ANTES y su backfill es la ÚNICA fuente de
-- filas hasta aquí (los congelamientos en tiempo real empiezan después, con
-- la app ya desplegada). Por eso todas las filas actuales son de backfill.
UPDATE public.comision_historico SET es_backfill = TRUE WHERE NOT es_backfill;

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT fecha, es_backfill, niveles FROM public.comision_historico
--   ORDER BY fecha DESC LIMIT 5;
-- (El backfill → es_backfill = true; los congelados en tiempo real → false.)
