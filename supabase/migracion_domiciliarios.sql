-- ============================================================
-- StarGo · Fase 4 + 5 — Domiciliarios, asignación y Realtime
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase.
-- Requiere las tablas de Fases 2 y 3 (barrios, zonas, tarifas,
-- pedidos, historial_estados) y public.es_admin().
--
-- Resumen:
--  * Tabla domiciliarios (privada): cada domiciliario es un usuario
--    de Supabase Auth; el admin lo registra por email (RPC
--    registrar_domiciliario, SECURITY DEFINER).
--  * pedidos.domiciliario_id + estados 'asignado' y 'recogido'.
--  * La asignación y TODAS las transiciones de estado se hacen por
--    RPC SECURITY DEFINER (asignar_domiciliario / transicionar_pedido):
--    el rol y la máquina de estados se validan en la BD, nunca en el
--    cliente. Cada cambio se registra en historial_estados.
--  * Realtime (Fase 5):
--      - public.pedidos se publica para admin y domiciliarios (RLS
--        decide quién recibe cada evento).
--      - public.pedido_eventos (público, solo numero+estado) alimenta
--        el panel del cliente vía trigger sobre historial_estados.
-- ============================================================

-- ============================================================
-- 1) Tabla domiciliarios
-- ============================================================
CREATE TABLE IF NOT EXISTS public.domiciliarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE
        CONSTRAINT domiciliarios_user_fkey REFERENCES auth.users(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    email TEXT,
    telefono TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at automático (reutiliza la función de la Fase 3)
DROP TRIGGER IF EXISTS trg_domiciliarios_updated_at ON public.domiciliarios;
CREATE TRIGGER trg_domiciliarios_updated_at
    BEFORE UPDATE ON public.domiciliarios
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.domiciliarios ENABLE ROW LEVEL SECURITY;

-- Admin: acceso total. Domiciliario: solo su propia fila.
DROP POLICY IF EXISTS domiciliarios_admin_all ON public.domiciliarios;
CREATE POLICY domiciliarios_admin_all ON public.domiciliarios
    FOR ALL USING (public.es_admin()) WITH CHECK (public.es_admin());

DROP POLICY IF EXISTS domiciliarios_propio_select ON public.domiciliarios;
CREATE POLICY domiciliarios_propio_select ON public.domiciliarios
    FOR SELECT USING (user_id = auth.uid());

-- ============================================================
-- 2) Helpers de rol (SECURITY DEFINER: el owner lee sin RLS)
-- ============================================================
CREATE OR REPLACE FUNCTION public.es_domiciliario()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.domiciliarios WHERE user_id = auth.uid() AND activo
    );
$$;

-- Id del domiciliario activo actual (NULL si no lo es).
CREATE OR REPLACE FUNCTION public.mi_domiciliario_id()
RETURNS UUID
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
    SELECT id FROM public.domiciliarios WHERE user_id = auth.uid() AND activo;
$$;

-- ============================================================
-- 3) pedidos: columna domiciliario_id + nuevos estados
-- ============================================================
ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS domiciliario_id UUID
        REFERENCES public.domiciliarios(id) ON DELETE SET NULL;

-- Nuevos estados: asignado y recogido (se reemplaza el CHECK existente).
ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_estado_check;
ALTER TABLE public.pedidos
    ADD CONSTRAINT pedidos_estado_check
    CHECK (estado IN ('pendiente', 'asignado', 'aceptado', 'recogido', 'en_camino', 'entregado', 'cancelado'));

CREATE INDEX IF NOT EXISTS idx_pedidos_domiciliario ON public.pedidos (domiciliario_id, estado);

-- RLS: el domiciliario ve sus pedidos asignados (necesario para su panel
-- y para que Realtime le entregue los cambios de esas filas).
DROP POLICY IF EXISTS pedidos_domiciliario_select ON public.pedidos;
CREATE POLICY pedidos_domiciliario_select ON public.pedidos
    FOR SELECT USING (domiciliario_id = public.mi_domiciliario_id());

-- El domiciliario ve el historial de sus pedidos.
DROP POLICY IF EXISTS historial_domiciliario_select ON public.historial_estados;
CREATE POLICY historial_domiciliario_select ON public.historial_estados
    FOR SELECT USING (
        pedido_id IN (SELECT id FROM public.pedidos WHERE domiciliario_id = public.mi_domiciliario_id())
    );

-- ============================================================
-- 4) RPC: registrar domiciliario (solo admin)
-- ============================================================
-- Busca el usuario en Supabase Auth por email; si el email no tiene
-- cuenta aún, devuelve un error pidiendo crearla primero.
CREATE OR REPLACE FUNCTION public.registrar_domiciliario(
    p_nombre TEXT,
    p_telefono TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_user_id UUID;
    v_fila public.domiciliarios%ROWTYPE;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede registrar domiciliarios';
    END IF;

    IF p_email IS NULL THEN
        RAISE EXCEPTION 'Debes indicar el email del domiciliario';
    END IF;

    SELECT id INTO v_user_id
    FROM auth.users
    WHERE LOWER(email) = LOWER(TRIM(p_email));

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No existe ningún usuario de Supabase con el email %', TRIM(p_email);
    END IF;

    INSERT INTO public.domiciliarios (user_id, nombre, email, telefono)
    VALUES (v_user_id, TRIM(p_nombre), TRIM(p_email), NULLIF(TRIM(p_telefono), ''))
    ON CONFLICT (user_id) DO UPDATE
        SET nombre = EXCLUDED.nombre,
            email = EXCLUDED.email,
            telefono = EXCLUDED.telefono,
            activo = TRUE
    RETURNING * INTO v_fila;

    RETURN JSONB_BUILD_OBJECT(
        'id', v_fila.id,
        'user_id', v_fila.user_id,
        'nombre', v_fila.nombre,
        'email', v_fila.email,
        'telefono', v_fila.telefono,
        'activo', v_fila.activo,
        'created_at', v_fila.created_at
    );
END;
$$;

-- ============================================================
-- 5) RPC: asignar domiciliario (solo admin, pedido pendiente)
-- ============================================================
CREATE OR REPLACE FUNCTION public.asignar_domiciliario(
    p_pedido_id UUID,
    p_domiciliario_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_pedido public.pedidos%ROWTYPE;
    v_dom public.domiciliarios%ROWTYPE;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede asignar domiciliarios';
    END IF;

    SELECT * INTO v_dom FROM public.domiciliarios WHERE id = p_domiciliario_id;
    IF v_dom.id IS NULL OR NOT v_dom.activo THEN
        RAISE EXCEPTION 'El domiciliario no existe o está inactivo';
    END IF;

    SELECT * INTO v_pedido FROM public.pedidos WHERE id = p_pedido_id;
    IF v_pedido.id IS NULL THEN
        RAISE EXCEPTION 'Pedido no encontrado';
    END IF;
    IF v_pedido.estado NOT IN ('pendiente', 'asignado') THEN
        RAISE EXCEPTION 'Solo se pueden asignar pedidos pendientes (o reasignar uno ya asignado)';
    END IF;

    UPDATE public.pedidos
    SET domiciliario_id = p_domiciliario_id, estado = 'asignado'
    WHERE id = p_pedido_id;

    INSERT INTO public.historial_estados (pedido_id, estado, notas)
    VALUES (p_pedido_id, 'asignado', 'Asignado a ' || v_dom.nombre);

    RETURN JSONB_BUILD_OBJECT(
        'pedido_id', p_pedido_id,
        'domiciliario_id', p_domiciliario_id,
        'estado', 'asignado'
    );
END;
$$;

-- ============================================================
-- 6) RPC: transicionar_pedido (admin o domiciliario asignado)
-- ============================================================
-- Máquina de estados validada EN LA BD:
--   Admin:  cancelar desde cualquier estado activo.
--   Domiciliario (solo de su pedido): asignado→aceptado→recogido→en_camino→entregado.
CREATE OR REPLACE FUNCTION public.transicionar_pedido(
    p_pedido_id UUID,
    p_estado TEXT,
    p_nota TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_pedido public.pedidos%ROWTYPE;
    v_mi_id UUID;
    v_permitidos TEXT[];
BEGIN
    v_mi_id := public.mi_domiciliario_id();

    SELECT * INTO v_pedido FROM public.pedidos WHERE id = p_pedido_id;
    IF v_pedido.id IS NULL THEN
        RAISE EXCEPTION 'Pedido no encontrado';
    END IF;

    IF public.es_admin() THEN
        v_permitidos := CASE v_pedido.estado
            WHEN 'pendiente' THEN ARRAY['cancelado']
            WHEN 'asignado' THEN ARRAY['cancelado']
            WHEN 'aceptado' THEN ARRAY['cancelado']
            WHEN 'recogido' THEN ARRAY['cancelado']
            WHEN 'en_camino' THEN ARRAY['cancelado']
            ELSE ARRAY[]::text[]
        END;
    ELSIF v_mi_id IS NOT NULL AND v_pedido.domiciliario_id = v_mi_id THEN
        v_permitidos := CASE v_pedido.estado
            WHEN 'asignado' THEN ARRAY['aceptado']
            WHEN 'aceptado' THEN ARRAY['recogido']
            WHEN 'recogido' THEN ARRAY['en_camino']
            WHEN 'en_camino' THEN ARRAY['entregado']
            ELSE ARRAY[]::text[]
        END;
    ELSE
        RAISE EXCEPTION 'No tienes permisos para cambiar este pedido';
    END IF;

    IF p_estado = v_pedido.estado THEN
        RAISE EXCEPTION 'El pedido ya está en «%»', p_estado;
    END IF;
    IF NOT (p_estado = ANY(v_permitidos)) THEN
        RAISE EXCEPTION 'No se puede pasar de «%» a «%»', v_pedido.estado, p_estado;
    END IF;

    -- Se conserva domiciliario_id al cancelar: así el domiciliario recibe el
    -- evento Realtime (el filtro/RLS se evalúa sobre la fila NUEVA) y el
    -- pedido aparece en su historial como cancelado.
    UPDATE public.pedidos
    SET estado = p_estado
    WHERE id = p_pedido_id;

    INSERT INTO public.historial_estados (pedido_id, estado, notas)
    VALUES (p_pedido_id, p_estado, NULLIF(p_nota, ''));

    RETURN JSONB_BUILD_OBJECT('pedido_id', p_pedido_id, 'estado', p_estado);
END;
$$;

-- ============================================================
-- 7) Realtime (Fase 5)
-- ============================================================
-- Publicar pedidos: admin recibe todo (RLS admin), el domiciliario solo
-- sus asignados (RLS domiciliario). REPLICA IDENTITY FULL para que los
-- eventos UPDATE/DELETE incluyan los valores previos.
ALTER TABLE public.pedidos REPLICA IDENTITY FULL;

DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.pedidos;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.domiciliarios;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;

-- Eventos públicos para el panel del cliente: solo numero + estado.
-- La fila completa del pedido sigue siendo privada; el cliente la
-- consulta por código con consultar_pedido().
CREATE TABLE IF NOT EXISTS public.pedido_eventos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pedido_id UUID NOT NULL
        CONSTRAINT pedido_eventos_pedido_fkey REFERENCES public.pedidos(id) ON DELETE CASCADE,
    numero TEXT NOT NULL,
    estado TEXT NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.domiciliarios REPLICA IDENTITY FULL;

ALTER TABLE public.pedido_eventos ENABLE ROW LEVEL SECURITY;

-- Público de solo-lectura (nunca expone direcciones ni teléfonos).
DROP POLICY IF EXISTS pedido_eventos_select ON public.pedido_eventos;
CREATE POLICY pedido_eventos_select ON public.pedido_eventos
    FOR SELECT USING (TRUE);

DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.pedido_eventos;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;

-- Trigger: cada entrada en historial_estados emite un evento público.
CREATE OR REPLACE FUNCTION public.emitir_pedido_evento()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_numero TEXT;
BEGIN
    SELECT numero INTO v_numero FROM public.pedidos WHERE id = NEW.pedido_id;
    INSERT INTO public.pedido_eventos (pedido_id, numero, estado)
    VALUES (NEW.pedido_id, v_numero, NEW.estado);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedido_evento ON public.historial_estados;
CREATE TRIGGER trg_pedido_evento
    AFTER INSERT ON public.historial_estados
    FOR EACH ROW EXECUTE FUNCTION public.emitir_pedido_evento();

-- ============================================================
-- 8) Permisos
-- ============================================================
GRANT EXECUTE ON FUNCTION public.es_domiciliario() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mi_domiciliario_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_domiciliario(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.asignar_domiciliario(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transicionar_pedido(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT public.es_domiciliario();
-- SELECT * FROM public.domiciliarios;
-- SELECT estado, COUNT(*) FROM public.pedidos GROUP BY estado;
-- SELECT * FROM public.pedido_eventos ORDER BY id DESC LIMIT 5;
