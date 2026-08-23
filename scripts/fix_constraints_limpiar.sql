-- ============================================================
-- StarGo · Limpiar datos corruptos + aplicar constraints pendientes
-- ============================================================
-- Ejecutar en el SQL Editor de Supabase (producción):
-- https://supabase.com/dashboard/project/uwfjfkcytohrjnyspkkt/sql/new
--
-- PASO 1: Verificar qué recargos corruptos existen
-- PASO 2: Eliminar recargos con valor negativo o nombre vacío
-- PASO 3: Aplicar CHECK constraint recargos.valor >= 0
-- PASO 4: Fix comision_historico.niveles
-- PASO 5: Fix push_subscriptions RLS
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1) Verificar qué recargos corruptos existen
-- ────────────────────────────────────────────────────────────
SELECT codigo, nombre, tipo, valor, activo
FROM public.recargos
WHERE valor < 0 OR nombre IS NULL OR TRIM(nombre) = ''
ORDER BY valor;

-- ────────────────────────────────────────────────────────────
-- 2) Eliminar recargos con valor negativo o nombre vacío
-- ────────────────────────────────────────────────────────────
DELETE FROM public.recargos
WHERE valor < 0 OR nombre IS NULL OR TRIM(nombre) = '';

-- Verificar que no quedan
SELECT COUNT(*) AS recargos_invalidos_restantes
FROM public.recargos
WHERE valor < 0 OR nombre IS NULL OR TRIM(nombre) = '';

-- ────────────────────────────────────────────────────────────
-- 3) CHECK constraint: recargos.valor >= 0
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
        RAISE NOTICE 'Constraint recargos_valor_no_negativo creado';
    ELSE
        RAISE NOTICE 'Constraint recargos_valor_no_negativo ya existe';
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 4) comision_historico.niveles: nullable + CHECK array
-- ────────────────────────────────────────────────────────────
-- 4a) Quitar NOT NULL si existe
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'comision_historico'::regclass
          AND attname = 'niveles'
          AND NOT attnotnull
    ) = FALSE THEN
        ALTER TABLE public.comision_historico
            ALTER COLUMN niveles DROP NOT NULL;
        RAISE NOTICE 'NOT NULL removido de comision_historico.niveles';
    ELSE
        RAISE NOTICE 'comision_historico.niveles ya es nullable';
    END IF;
END $$;

-- 4b) CHECK constraint: solo array o null
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
        RAISE NOTICE 'Constraint chk_comision_historico_niveles_es_array creado';
    ELSE
        RAISE NOTICE 'Constraint chk_comision_historico_niveles_es_array ya existe';
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 5) push_subscriptions: solo admin o domiciliario puede INSERT
-- ────────────────────────────────────────────────────────────
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
-- Verificación final:
-- 1) Probar CHECK de recargos (debería fallar):
--    INSERT INTO public.recargos (codigo, nombre, tipo, valor)
--    VALUES ('rc_test_neg', 'Test neg', 'otro', -1);
--
-- 2) Probar CHECK de comision_historico (debería fallar):
--    INSERT INTO public.comision_historico (fecha, niveles)
--    VALUES ('2099-01-01', '{"no":"array"}');
--
-- 3) Verificar recargos limpios:
--    SELECT COUNT(*) FROM public.recargos WHERE valor < 0;
-- ============================================================
