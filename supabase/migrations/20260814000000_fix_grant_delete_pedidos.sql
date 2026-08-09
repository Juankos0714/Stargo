-- ============================================================
-- StarGo · Fix: DELETE /api/pedidos — GRANT faltante de la Fase 8
-- ============================================================
-- Síntoma: DELETE /api/pedidos devuelve
--   {"error":"permission denied for table pedidos"} (500)
-- Causa: el rol `authenticated` no tiene el privilegio DELETE a nivel
--   de tabla sobre public.pedidos en el remoto. Ese privilegio lo
--   otorgaba SOLO la Fase 8 (20260805000000_fase8_audit_rls.sql,
--   sección HARDENING) y esa migración no se aplicó completa al
--   proyecto remoto. No es un problema de RLS: la política
--   `pedidos_admin_delete` (es_admin()) ya existe desde la Fase 3 y
--   limita el borrado a los administradores.
--
-- Se incluye también el GRANT de domiciliarios de la misma sección
-- (el panel admin hace PUT/DELETE /api/domiciliarios por SQL directo)
-- para que el bloque quede igual que en la Fase 8.
--
-- Ejecutar en el SQL Editor del Dashboard de Supabase (rol POSTGRES).
-- Idempotente: GRANT es repetible sin error.
-- ============================================================

-- DELETE de pedidos: lo usa el endpoint DELETE /api/pedidos (admin).
GRANT DELETE ON public.pedidos TO authenticated;

-- Panel de domiciliarios: activar/eliminar por SQL directo.
GRANT UPDATE, DELETE ON public.domiciliarios TO authenticated;

-- ============================================================
-- Verificación (opcional): debe mostrar DELETE para `authenticated`
-- ============================================================
-- SELECT grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name IN ('pedidos', 'domiciliarios')
--   AND grantee = 'authenticated'
-- ORDER BY table_name, privilege_type;
