-- ============================================================
-- StarGo · Fase 18 (hardening) — CHECK de shape en comision_historico.niveles
-- ============================================================
-- Requiere la Fase 18 (comision_historico).
--
-- PROBLEMA QUE RESUELVE:
--   comision_historico.niveles es un JSONB que SOLO escribe hoy
--   congelar_comisiones_dia() (siempre un array de {nivel, hasta, valor}),
--   pero ninguna constraint garantiza la forma. Un CHECK barato evita que
--   cualquier futura vía de escritura meta un shape inválido.
--
-- ANTES de aplicar el constraint se valida que no haya filas existentes que
-- lo rompan. Si las hay, la migración ABORTA con un mensaje claro (no se
-- fuerza el constraint sobre datos inválidos).
-- ============================================================

DO $$
DECLARE
    v_invalidas INT;
BEGIN
    SELECT COUNT(*) INTO v_invalidas
    FROM public.comision_historico
    WHERE jsonb_typeof(niveles) IS DISTINCT FROM 'array';

    IF v_invalidas > 0 THEN
        RAISE EXCEPTION
            'No se aplica el CHECK de comision_historico: hay % fila(s) con niveles que no es un array. Revisar antes de forzarlo.',
            v_invalidas;
    END IF;
END $$;

ALTER TABLE public.comision_historico
    ADD CONSTRAINT chk_comision_historico_niveles_es_array
    CHECK (jsonb_typeof(niveles) = 'array');

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT conname FROM pg_constraint WHERE conrelid = 'comision_historico'::regclass;
-- INSERT INTO public.comision_historico (fecha, niveles) VALUES ('2030-01-01', '{"no":"array"}'); -- debe fallar
-- DELETE FROM public.comision_historico WHERE fecha = '2030-01-01';
