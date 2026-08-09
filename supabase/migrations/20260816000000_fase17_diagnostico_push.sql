-- ============================================================
-- StarGo · Fase 17 — Diagnóstico de Web Push
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase (POSTGRES).
--
-- Permite que el endpoint /api/push/probar inserte UNA notificación de
-- prueba dirigida al PROPIO usuario autenticado. Ese INSERT dispara el
-- Database Webhook (INSERT en public.notificaciones → send-push) y así se
-- prueba el flujo REAL de la cadena: pedido → trigger → notificaciones →
-- webhook → send-push → Web Push.
--
-- Seguridad: la política solo permite INSERT con destinatario_id = auth.uid()
-- (cada usuario solo puede notificarse a sí mismo; no puede crear
-- notificaciones para otros ni alterar las ajenas). El flujo real de la app
-- NO usa este INSERT (las notificaciones las crean los triggers SECURITY
-- DEFINER sobre pedidos): el grant es SOLO para el diagnóstico. Si algún día
-- se retira el botón de prueba, se puede revocar sin afectar a la app.
-- ============================================================

DROP POLICY IF EXISTS notificaciones_propias_insert ON public.notificaciones;
CREATE POLICY notificaciones_propias_insert ON public.notificaciones
    FOR INSERT WITH CHECK (destinatario_id = auth.uid());

-- Se añade INSERT al grant existente (SELECT, UPDATE ya estaban).
GRANT INSERT ON public.notificaciones TO authenticated;

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'notificaciones';
-- → debe listar notificaciones_propias_insert (INSERT).
