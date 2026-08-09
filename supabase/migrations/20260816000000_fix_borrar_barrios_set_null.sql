-- ============================================================
-- StarGo · Fix — Permitir borrar barrios con pedidos asociados
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase (POSTGRES).
-- Requiere las Fases 2-16 (especialmente la Fase 14, que ya hizo
-- barrio_origen_id nullable).
--
-- PROBLEMA:
--   Al borrar un barrio con pedidos asociados, la BD bloqueaba la
--   operación con:
--     update or delete on table "barrios" violates foreign key
--     constraint "pedidos_barrio_origen_fkey" on table "pedidos"
--   porque las FK usaban ON DELETE RESTRICT.
--
-- SOLUCIÓN (SET NULL):
--   Al borrar un barrio, los pedidos que lo referenciaban quedan con
--   barrio_origen_id / barrio_destino_id = NULL. La UI y los reportes
--   ya muestran '—' cuando no hay barrio (Fase 14).
--
--   Nota: crear_pedido() sigue exigiendo que el barrio de destino
--   EXISTA al crear pedidos nuevos, así que el SET NULL solo afecta a
--   pedidos históricos cuyo barrio se elimine después.
-- ============================================================

-- 1) barrio_destino_id pasa a ser nullable (el origen ya lo es desde
--    la Fase 14). Sin este cambio, ON DELETE SET NULL fallaría con
--    "null value in column barrio_destino_id violates not-null constraint".
ALTER TABLE public.pedidos ALTER COLUMN barrio_destino_id DROP NOT NULL;

-- 2) FK origen: RESTRICT → SET NULL.
ALTER TABLE public.pedidos
    DROP CONSTRAINT IF EXISTS pedidos_barrio_origen_fkey,
    ADD CONSTRAINT pedidos_barrio_origen_fkey
        FOREIGN KEY (barrio_origen_id)
        REFERENCES public.barrios(id)
        ON DELETE SET NULL;

-- 3) FK destino: RESTRICT → SET NULL.
ALTER TABLE public.pedidos
    DROP CONSTRAINT IF EXISTS pedidos_barrio_destino_fkey,
    ADD CONSTRAINT pedidos_barrio_destino_fkey
        FOREIGN KEY (barrio_destino_id)
        REFERENCES public.barrios(id)
        ON DELETE SET NULL;

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT conname, confdeltype
-- FROM pg_constraint
-- WHERE conname IN ('pedidos_barrio_origen_fkey', 'pedidos_barrio_destino_fkey');
-- confdeltype = 'n' significa ON DELETE SET NULL.
