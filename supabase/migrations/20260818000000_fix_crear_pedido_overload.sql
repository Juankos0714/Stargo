-- ============================================================
-- StarGo · Fix — Sobrecargas obsoletas de crear_pedido
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase (POSTGRES).
-- Requiere las Fases 3, 7, 13 y 14 (crear_pedido).
--
-- PROBLEMA:
--   Las migraciones Fase 7/13 (6 args) y Fase 14 (8 args) re-emiten
--   crear_pedido con CREATE OR REPLACE pero con FIRMAS distintas. En
--   Postgres eso CREA una sobrecarga nueva sin borrar la anterior, así que
--   quedan hasta 3 versiones (5, 6 y 8 args) y PostgREST no puede elegir
--   candidata al llamar el RPC (PGRST203: "Could not choose the best
--   candidate function"). Rompe los flujos de creación de pedidos por RPC.
--
-- SOLUCIÓN:
--   Se eliminan las firmas obsoletas (5 y 6 args). Solo queda la de la
--   Fase 14 (8 args, TODOS con default), que se puede llamar con cualquier
--   subconjunto de parámetros: la app ya la llama con los 8 y los RPCs de
--   prueba con 6 (el resto va por default).
-- ============================================================

DROP FUNCTION IF EXISTS public.crear_pedido(UUID, TEXT, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.crear_pedido(UUID, TEXT, UUID, TEXT, TEXT, TEXT[]);

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid)
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'crear_pedido';
-- → 1 fila: (UUID, TEXT, UUID, TEXT, TEXT, TEXT[], TEXT, BOOLEAN)
--
-- SELECT public.crear_pedido(
--     p_barrio_origen_id => '<uuid>', p_direccion_origen => 'x',
--     p_barrio_destino_id => '<uuid>', p_direccion_destino => 'y',
--     p_observaciones => NULL, p_recargos => NULL
-- );  -- debe funcionar (defaults de la Fase 14), sin ambigüedad
