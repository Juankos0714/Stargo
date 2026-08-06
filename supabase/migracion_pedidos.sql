-- ============================================================
-- StarGo · Fase 3 — Pedidos e historial de estados
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase.
-- Requiere que existan las tablas de la Fase 2 (barrios, zonas,
-- tarifas) y la función public.calcular_tarifa() y public.es_admin().
--
-- Diseño:
--  * Las tablas son PRIVADAS (RLS): solo admins las leen/editan.
--  * El cliente crea y consulta pedidos SOLO a través de las
--    funciones públicas crear_pedido() y consultar_pedido()
--    (SECURITY DEFINER), que recalculan la tarifa en la BD.
--  * Cada cambio de estado se registra en historial_estados.
-- ============================================================

-- ---------- Tabla pedidos ----------
CREATE TABLE IF NOT EXISTS public.pedidos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero TEXT NOT NULL UNIQUE,
    barrio_origen_id UUID NOT NULL
        CONSTRAINT pedidos_barrio_origen_fkey REFERENCES public.barrios(id) ON DELETE RESTRICT,
    direccion_origen TEXT NOT NULL,
    barrio_destino_id UUID NOT NULL
        CONSTRAINT pedidos_barrio_destino_fkey REFERENCES public.barrios(id) ON DELETE RESTRICT,
    direccion_destino TEXT NOT NULL,
    observaciones TEXT,
    tarifa_base INTEGER NOT NULL CHECK (tarifa_base >= 0),
    zona_origen_id TEXT,
    zona_destino_id TEXT,
    estado TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'aceptado', 'en_camino', 'entregado', 'cancelado')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pedidos_estado_creado ON public.pedidos (estado, created_at DESC);

-- ---------- Tabla historial_estados ----------
CREATE TABLE IF NOT EXISTS public.historial_estados (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pedido_id UUID NOT NULL
        CONSTRAINT historial_estados_pedido_fkey REFERENCES public.pedidos(id) ON DELETE CASCADE,
    estado TEXT NOT NULL,
    notas TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_historial_pedido_creado ON public.historial_estados (pedido_id, created_at);

-- ---------- Trigger: updated_at automático ----------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_updated_at ON public.pedidos;
CREATE TRIGGER trg_pedidos_updated_at
    BEFORE UPDATE ON public.pedidos
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- RLS: tablas privadas ----------
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historial_estados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pedidos_admin_select ON public.pedidos;
CREATE POLICY pedidos_admin_select ON public.pedidos
    FOR SELECT USING (public.es_admin());

DROP POLICY IF EXISTS pedidos_admin_update ON public.pedidos;
CREATE POLICY pedidos_admin_update ON public.pedidos
    FOR UPDATE USING (public.es_admin());

DROP POLICY IF EXISTS pedidos_admin_delete ON public.pedidos;
CREATE POLICY pedidos_admin_delete ON public.pedidos
    FOR DELETE USING (public.es_admin());

DROP POLICY IF EXISTS historial_admin_select ON public.historial_estados;
CREATE POLICY historial_admin_select ON public.historial_estados
    FOR SELECT USING (public.es_admin());

DROP POLICY IF EXISTS historial_admin_insert ON public.historial_estados;
CREATE POLICY historial_admin_insert ON public.historial_estados
    FOR INSERT WITH CHECK (public.es_admin());

-- Nota: NO hay políticas de INSERT/UPDATE para anon/authenticated en
-- public.pedidos. La creación es exclusiva de public.crear_pedido().

-- ---------- Función pública: crear_pedido ----------
-- Recalcula la tarifa en la BD (nunca confía en el cliente), genera un
-- código de seguimiento único y crea el pedido en estado 'pendiente'.
-- Devuelve NULL si los barrios no existen o no hay tarifa disponible.
CREATE OR REPLACE FUNCTION public.crear_pedido(
    p_barrio_origen_id UUID,
    p_direccion_origen TEXT,
    p_barrio_destino_id UUID,
    p_direccion_destino TEXT,
    p_observaciones TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_zona_origen TEXT;
    v_zona_destino TEXT;
    v_tarifa INTEGER;
    v_numero TEXT;
    v_id UUID;
BEGIN
    -- Barrios deben existir
    SELECT zona_id INTO v_zona_origen FROM public.barrios WHERE id = p_barrio_origen_id;
    SELECT zona_id INTO v_zona_destino FROM public.barrios WHERE id = p_barrio_destino_id;
    IF v_zona_origen IS NULL OR v_zona_destino IS NULL THEN
        RETURN NULL;
    END IF;

    -- Tarifa (matriz simétrica incluida, reutiliza la Fase 2)
    v_tarifa := public.calcular_tarifa(p_barrio_origen_id::text, p_barrio_destino_id::text);
    IF v_tarifa IS NULL THEN
        RETURN NULL; -- trayecto sin tarifa o en zona no disponible
    END IF;

    -- Código de seguimiento único (reintenta ante colisión)
    LOOP
        v_numero := UPPER(SUBSTR(MD5(RANDOM()::text || CLOCK_TIMESTAMP()::text), 1, 6));
        BEGIN
            INSERT INTO public.pedidos (
                numero, barrio_origen_id, direccion_origen,
                barrio_destino_id, direccion_destino, observaciones,
                tarifa_base, zona_origen_id, zona_destino_id, estado
            ) VALUES (
                v_numero, p_barrio_origen_id, p_direccion_origen,
                p_barrio_destino_id, p_direccion_destino, p_observaciones,
                v_tarifa, v_zona_origen, v_zona_destino, 'pendiente'
            )
            RETURNING id INTO v_id;
            EXIT;
        EXCEPTION
            WHEN unique_violation THEN
                -- reintentar con otro código
        END;
    END LOOP;

    INSERT INTO public.historial_estados (pedido_id, estado, notas)
    VALUES (v_id, 'pendiente', 'Pedido creado por el cliente');

    RETURN JSONB_BUILD_OBJECT(
        'pedido_id', v_id,
        'numero', v_numero,
        'tarifa_base', v_tarifa,
        'estado', 'pendiente',
        'zona_origen', v_zona_origen,
        'zona_destino', v_zona_destino
    );
END;
$$;

-- ---------- Función pública: consultar_pedido ----------
-- Devuelve el pedido + su historial de estados para el código dado.
-- NULL si no existe.
CREATE OR REPLACE FUNCTION public.consultar_pedido(p_numero TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE
    v_id UUID;
    v_pedido JSONB;
    v_historial JSONB;
BEGIN
    SELECT id INTO v_id FROM public.pedidos WHERE numero = UPPER(TRIM(p_numero));
    IF v_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT JSONB_BUILD_OBJECT(
        'id', p.id,
        'numero', p.numero,
        'barrio_origen_id', p.barrio_origen_id,
        'direccion_origen', p.direccion_origen,
        'barrio_destino_id', p.barrio_destino_id,
        'direccion_destino', p.direccion_destino,
        'observaciones', p.observaciones,
        'tarifa_base', p.tarifa_base,
        'zona_origen', p.zona_origen_id,
        'zona_destino', p.zona_destino_id,
        'estado', p.estado,
        'created_at', p.created_at,
        'updated_at', p.updated_at
    ) INTO v_pedido
    FROM public.pedidos p WHERE p.id = v_id;

    SELECT COALESCE(
        JSONB_AGG(
            JSONB_BUILD_OBJECT('estado', h.estado, 'notas', h.notas, 'created_at', h.created_at)
            ORDER BY h.created_at
        ),
        '[]'::jsonb
    ) INTO v_historial
    FROM public.historial_estados h WHERE h.pedido_id = v_id;

    RETURN JSONB_BUILD_OBJECT('pedido', v_pedido, 'historial', v_historial);
END;
$$;

-- ---------- Permisos ----------
GRANT EXECUTE ON FUNCTION public.crear_pedido(UUID, TEXT, UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultar_pedido(TEXT) TO anon, authenticated;

-- ---------- Verificación ----------
-- SELECT * FROM public.pedidos LIMIT 5;
-- SELECT * FROM public.historial_estados LIMIT 5;
-- SELECT public.crear_pedido(...);  -- se probará desde la app
