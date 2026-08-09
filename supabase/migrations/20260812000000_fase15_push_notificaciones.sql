-- ============================================================
-- StarGo · Fase 15 — Notificaciones en la app + Web Push
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase (POSTGRES).
-- Requiere las Fases 2-14 (pedidos, admins, domiciliarios, es_admin).
--
-- ARQUITECTURA (según el diagrama):
--
--   pedidos → trigger → notificaciones → Database Webhook (INSERT)
--            → Edge Function send-push → push_subscriptions → Web Push
--
--   1) `notificaciones`: registro por destinatario. Los triggers sobre
--      pedidos la llenan (nuevo_pedido → ADMINES, cambio_estado →
--      domiciliario asignado). Cada usuario lee/marca SOLO las suyas (RLS).
--   2) `push_subscriptions`: suscripciones Web Push por usuario
--      (usuario_id = auth.uid()); el usuario solo gestiona las suyas.
--   3) Webhook MANUAL en el dashboard (Database → Webhooks):
--      sobre INSERT en public.notificaciones → https://<ref>.functions.supabase.co/send-push
--      (headers: Content-Type application/json). La Edge Function lee las
--      suscripciones del destinatario y envía el push con VAPID.
--   4) VAPID: public en PUBLIC_VAPID_PUBLIC_KEY (cliente); VAPID_PRIVATE_KEY
--      y VAPID_SUBJECT solo como secrets de la Edge Function.
--
-- NOTA: destinatario_id es SIEMPRE un auth.uid() (admins.user_id o
-- domiciliarios.user_id), nunca el id de la fila del domiciliario: así RLS
-- (auth.uid()) y push_subscriptions.usuario_id coinciden.
-- ============================================================

-- ============================================================
-- 1) Tabla notificaciones
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notificaciones (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- 'admin' o 'domiciliario': decide la RLS y la URL del push.
    destinatario_tipo TEXT NOT NULL CHECK (destinatario_tipo IN ('admin', 'domiciliario')),
    -- auth.uid() del destinatario (admins.user_id / domiciliarios.user_id).
    destinatario_id UUID NOT NULL,
    pedido_id UUID REFERENCES public.pedidos(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('nuevo_pedido', 'cambio_estado')),
    titulo TEXT NOT NULL,
    cuerpo TEXT,
    leida BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notificaciones_destinatario
    ON public.notificaciones (destinatario_tipo, destinatario_id, leida, created_at DESC);

ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;

-- Cada destinatario lee solo sus notificaciones.
DROP POLICY IF EXISTS notificaciones_propias_select ON public.notificaciones;
CREATE POLICY notificaciones_propias_select ON public.notificaciones
    FOR SELECT USING (destinatario_id = auth.uid());

-- Cada destinatario marca como leídas solo las suyas.
DROP POLICY IF EXISTS notificaciones_propias_update ON public.notificaciones;
CREATE POLICY notificaciones_propias_update ON public.notificaciones
    FOR UPDATE USING (destinatario_id = auth.uid())
    WITH CHECK (destinatario_id = auth.uid());

-- ============================================================
-- 2) Tabla push_subscriptions (Web Push)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT push_subs_unico UNIQUE (usuario_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- El usuario gestiona SOLO sus propias suscripciones.
DROP POLICY IF EXISTS push_subs_propias_all ON public.push_subscriptions;
CREATE POLICY push_subs_propias_all ON public.push_subscriptions
    FOR ALL USING (usuario_id = auth.uid()) WITH CHECK (usuario_id = auth.uid());

-- ============================================================
-- 3) Triggers sobre pedidos → notificaciones
-- ============================================================

-- nuevo_pedido → una notificación por cada admin.
CREATE OR REPLACE FUNCTION public.notificar_nuevo_pedido()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    INSERT INTO public.notificaciones (destinatario_tipo, destinatario_id, pedido_id, tipo, titulo, cuerpo)
    SELECT
        'admin',
        a.user_id,
        NEW.id,
        'nuevo_pedido',
        'Nuevo pedido ' || NEW.numero,
        CASE WHEN NEW.tipo_servicio = 'compra_diligencia'
             THEN 'Pedido de compra/diligencia pendiente por asignar.'
             ELSE 'Hay un pedido pendiente por asignar.' END
    FROM public.admins a;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificar_nuevo_pedido ON public.pedidos;
CREATE TRIGGER trg_notificar_nuevo_pedido
    AFTER INSERT ON public.pedidos
    FOR EACH ROW EXECUTE FUNCTION public.notificar_nuevo_pedido();

-- cambio_estado → notificación al domiciliario asignado (auth.uid del repartidor).
CREATE OR REPLACE FUNCTION public.notificar_cambio_estado()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_etiqueta TEXT;
BEGIN
    IF NEW.estado = OLD.estado OR NEW.domiciliario_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT user_id INTO v_user_id FROM public.domiciliarios WHERE id = NEW.domiciliario_id;
    IF v_user_id IS NULL THEN
        RETURN NEW;
    END IF;
    v_etiqueta := CASE NEW.estado
        WHEN 'asignado' THEN 'Asignado'
        WHEN 'aceptado' THEN 'Aceptado'
        WHEN 'recogido' THEN 'Recogido'
        WHEN 'en_camino' THEN 'En camino'
        WHEN 'entregado' THEN 'Entregado'
        WHEN 'cancelado' THEN 'Cancelado'
        ELSE NEW.estado
    END;
    INSERT INTO public.notificaciones (destinatario_tipo, destinatario_id, pedido_id, tipo, titulo, cuerpo)
    VALUES (
        'domiciliario',
        v_user_id,
        NEW.id,
        'cambio_estado',
        'Pedido ' || NEW.numero || ' · ' || v_etiqueta,
        'Tu pedido pasó a «' || v_etiqueta || '».'
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificar_cambio_estado ON public.pedidos;
CREATE TRIGGER trg_notificar_cambio_estado
    AFTER UPDATE OF estado ON public.pedidos
    FOR EACH ROW EXECUTE FUNCTION public.notificar_cambio_estado();

-- ============================================================
-- 4) Realtime: el centro de notificaciones se actualiza en vivo
-- ============================================================
ALTER TABLE public.notificaciones REPLICA IDENTITY FULL;

DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notificaciones;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;

-- ============================================================
-- 5) Permisos
-- ============================================================
-- Las tablas nuevas reciben ALL para anon por defecto: se revoca TODO y se
-- deja SOLO lo que RLS permite (usuario autenticado). Los triggers y la Edge
-- Function (service role) escriben por fuera de RLS.
REVOKE ALL ON public.notificaciones, public.push_subscriptions FROM anon;

GRANT SELECT, UPDATE ON public.notificaciones TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT * FROM public.notificaciones ORDER BY id DESC LIMIT 5;
-- SELECT * FROM public.push_subscriptions LIMIT 5;
-- INSERT INTO public.pedidos (...) → debe crear una notificación por admin;
-- UPDATE pedidos SET estado = 'entregado' → notificación al domiciliario.
