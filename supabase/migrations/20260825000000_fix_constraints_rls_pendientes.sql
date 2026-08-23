-- ============================================================
-- StarGo · Fix constraints y RLS pendientes (2026-08-25)
-- ============================================================
-- Corrige 3 issues detectados al correr la suite de RLS contra
-- producción:
--
--   1) recargos.valor: falta CHECK >= 0 (la migración base lo
--      declara pero no se aplicó a la BD de producción).
--   2) comision_historico.niveles: la columna tiene NOT NULL y
--      el CHECK de Fase 18 no se aplicó. Se hace nullable + CHECK.
--   3) push_subscriptions: la política RLS permite INSERT a
--      cualquier autenticado; se restringe a admin/domiciliario.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1) recargos.valor >= 0
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'recargos'::regclass
          AND conname = 'recargos_valor_no_negativo'
    ) THEN
        ALTER TABLE public.recargos
            ADD CONSTRAINT recargos_valor_no_negativo
            CHECK (valor >= 0);
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 2) comision_historico.niveles: nullable + CHECK array
-- ────────────────────────────────────────────────────────────

-- 2a) Quitar NOT NULL si existe (la migración base lo puso pero
--     la columna debe ser nullable para backfills y edge cases).
ALTER TABLE public.comision_historico
    ALTER COLUMN niveles DROP NOT NULL;

-- 2b) CHECK constraint: solo array o null.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'comision_historico'::regclass
          AND conname = 'chk_comision_historico_niveles_es_array'
    ) THEN
        ALTER TABLE public.comision_historico
            ADD CONSTRAINT chk_comision_historico_niveles_es_array
            CHECK (niveles IS NULL OR jsonb_typeof(niveles) = 'array');
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 3) push_subscriptions: solo admin o domiciliario puede INSERT
-- ────────────────────────────────────────────────────────────
-- La política actual (push_subs_propias_all) permite INSERT a
-- cualquier autenticado con usuario_id = auth.uid(). Se agrega
-- una política INSERT más restrictiva que exige rol.

DROP POLICY IF EXISTS push_subs_insert_restriccion ON public.push_subscriptions;
CREATE POLICY push_subs_insert_restriccion ON public.push_subscriptions
    FOR INSERT
    WITH CHECK (
        usuario_id = auth.uid()
        AND (
            public.es_admin()
            OR public.es_domiciliario()
        )
    );

-- ============================================================
-- Verificación (ejecutar en SQL Editor):
--
-- -- 1) recargos con valor negativo debe fallar:
-- INSERT INTO public.recargos (codigo, nombre, tipo, valor)
-- VALUES ('rc_test_neg', 'Test neg', 'otro', -1);
--
-- -- 2) comision_historico con niveles = object debe fallar:
-- INSERT INTO public.comision_historico (fecha, niveles)
-- VALUES ('2099-01-01', '{"no":"array"}');
--
-- -- 3) comision_historico con niveles = null debe funcionar:
-- INSERT INTO public.comision_historico (fecha, niveles)
-- VALUES ('2099-01-02', NULL);
--
-- -- 4) push_subscriptions: cliente sin rol no puede INSERT.
-- ============================================================
