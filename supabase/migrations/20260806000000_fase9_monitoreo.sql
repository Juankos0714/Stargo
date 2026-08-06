-- ============================================================
-- StarGo · Fase 9 — Monitoreo, alertas y observabilidad
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase (POSTGRES).
-- Requiere public.es_admin() (Fase 8).
--
-- Resumen:
--  * errores_app: registro centralizado de errores de cliente y servidor
--    (alimenta el dashboard de métricas y el alert de tasa 5xx). El anon
--    SOLO puede ejecutar el RPC registrar_error(); nadie lee sin ser admin.
--  * alertas: bitácora de alertas emitidas (pedidos sin asignar, 5xx,
--    Supabase caído, prueba). El cron server-side la registra vía RPC.
--  * historial_tarifas: auditoría de cambios en tarifas (sección 14 del
--    documento funcional). Cada INSERT/UPDATE/DELETE de la matriz genera
--    una fila con valores antes/después y el usuario que lo hizo, para
--    investigar rápido si un cálculo salió mal.
-- ============================================================

-- ============================================================
-- 1) errores_app
-- ============================================================
CREATE TABLE IF NOT EXISTS public.errores_app (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    origen TEXT NOT NULL DEFAULT 'cliente'
        CONSTRAINT errores_app_origen_check CHECK (origen IN ('cliente', 'servidor')),
    tipo TEXT NOT NULL DEFAULT 'otro',
    mensaje TEXT NOT NULL,
    ruta TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_errores_app_created ON public.errores_app (created_at DESC);

ALTER TABLE public.errores_app ENABLE ROW LEVEL SECURITY;

-- Solo lectura de admin. Los inserts van por el RPC SECURITY DEFINER
-- (el anon/authenticated NUNCA inserta directo en la tabla).
DROP POLICY IF EXISTS errores_app_admin_select ON public.errores_app;
CREATE POLICY errores_app_admin_select ON public.errores_app
    FOR SELECT USING (public.es_admin());

-- RPC: registra un error con validación y límites de longitud.
CREATE OR REPLACE FUNCTION public.registrar_error(
    p_origen TEXT,
    p_tipo TEXT,
    p_mensaje TEXT,
    p_ruta TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    IF p_origen NOT IN ('cliente', 'servidor') THEN
        RAISE EXCEPTION 'origen inválido';
    END IF;
    IF p_tipo IS NULL OR LENGTH(p_tipo) > 40 THEN
        RAISE EXCEPTION 'tipo inválido';
    END IF;
    IF p_mensaje IS NULL OR LENGTH(p_mensaje) > 1000 THEN
        RAISE EXCEPTION 'mensaje inválido';
    END IF;

    INSERT INTO public.errores_app (origen, tipo, mensaje, ruta)
    VALUES (p_origen, p_tipo, p_mensaje, LEFT(p_ruta, 300))
    RETURNING id INTO v_id;

    RETURN JSONB_BUILD_OBJECT('id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_error(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ============================================================
-- 2) alertas
-- ============================================================
CREATE TABLE IF NOT EXISTS public.alertas (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    evento TEXT NOT NULL,
    nivel TEXT NOT NULL DEFAULT 'warning'
        CONSTRAINT alertas_nivel_check CHECK (nivel IN ('info', 'warning', 'critical')),
    detalle TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alertas_created ON public.alertas (created_at DESC);

ALTER TABLE public.alertas ENABLE ROW LEVEL SECURITY;

-- Solo lectura de admin; los inserts van por RPC (el cron usa el cliente anon).
DROP POLICY IF EXISTS alertas_admin_select ON public.alertas;
CREATE POLICY alertas_admin_select ON public.alertas
    FOR SELECT USING (public.es_admin());

-- RPC: registra una alerta emitida (para la bitácora del dashboard).
CREATE OR REPLACE FUNCTION public.registrar_alerta(
    p_evento TEXT,
    p_nivel TEXT,
    p_detalle TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    IF p_nivel NOT IN ('info', 'warning', 'critical') THEN
        RAISE EXCEPTION 'nivel inválido';
    END IF;
    IF p_evento IS NULL OR LENGTH(p_evento) > 100 THEN
        RAISE EXCEPTION 'evento inválido';
    END IF;

    INSERT INTO public.alertas (evento, nivel, detalle)
    VALUES (p_evento, p_nivel, LEFT(p_detalle, 500))
    RETURNING id INTO v_id;

    RETURN JSONB_BUILD_OBJECT('id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_alerta(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ============================================================
-- 3) historial_tarifas — auditoría de cambios en la matriz
-- ============================================================
CREATE TABLE IF NOT EXISTS public.historial_tarifas (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operacion TEXT NOT NULL
        CONSTRAINT historial_tarifas_operacion_check CHECK (operacion IN ('INSERT', 'UPDATE', 'DELETE')),
    zona_origen_id TEXT,
    zona_destino_id TEXT,
    valor_antes INTEGER,
    valor_despues INTEGER,
    usuario_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_historial_tarifas_created ON public.historial_tarifas (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_historial_tarifas_ruta ON public.historial_tarifas (zona_origen_id, zona_destino_id);

ALTER TABLE public.historial_tarifas ENABLE ROW LEVEL SECURITY;

-- Solo lectura de admin (investigar cálculos). El trigger es SECURITY
-- DEFINER: escribe aunque la tabla tenga RLS.
DROP POLICY IF EXISTS historial_tarifas_admin_select ON public.historial_tarifas;
CREATE POLICY historial_tarifas_admin_select ON public.historial_tarifas
    FOR SELECT USING (public.es_admin());

-- Trigger: audita todo cambio en la matriz de tarifas. Usa auth.uid()
-- como autor (el admin autenticado que editó); si el cambio viene del
-- service_role o un RPC interno, queda NULL (no se puede atribuir).
CREATE OR REPLACE FUNCTION public.auditar_cambio_tarifa()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID;
BEGIN
    BEGIN
        v_uid := auth.uid();
    EXCEPTION WHEN OTHERS THEN
        v_uid := NULL;
    END;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.historial_tarifas (operacion, zona_origen_id, zona_destino_id, valor_antes, valor_despues, usuario_id)
        VALUES ('INSERT', NEW.zona_origen_id, NEW.zona_destino_id, NULL, NEW.valor, v_uid);
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO public.historial_tarifas (operacion, zona_origen_id, zona_destino_id, valor_antes, valor_despues, usuario_id)
        VALUES ('UPDATE', NEW.zona_origen_id, NEW.zona_destino_id, OLD.valor, NEW.valor, v_uid);
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO public.historial_tarifas (operacion, zona_origen_id, zona_destino_id, valor_antes, valor_despues, usuario_id)
        VALUES ('DELETE', OLD.zona_origen_id, OLD.zona_destino_id, OLD.valor, NULL, v_uid);
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_tarifas_audit ON public.tarifas;
CREATE TRIGGER trg_tarifas_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.tarifas
    FOR EACH ROW EXECUTE FUNCTION public.auditar_cambio_tarifa();

-- ============================================================
-- 4) RPCs para el cron de alertas (SECURITY DEFINER)
-- ============================================================
-- El cron corre server-side con el cliente ANON (no tiene sesión de admin),
-- así que necesita funciones SECURITY DEFINER que expongan SOLO lo mínimo
-- para evaluar alertas: números de pedidos pendientes vencidos, conteo de
-- errores recientes y si ya se alertó del mismo evento (cooldown).

-- Pedidos pendientes con más de p_minutos sin asignar.
CREATE OR REPLACE FUNCTION public.pedidos_pendientes_para_alerta(p_minutos INTEGER DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_resultado JSONB;
BEGIN
    SELECT COALESCE(
        JSONB_AGG(JSONB_BUILD_OBJECT('numero', numero, 'created_at', created_at) ORDER BY created_at),
        '[]'::jsonb
    ) INTO v_resultado
    FROM public.pedidos
    WHERE estado = 'pendiente'
      AND created_at < NOW() - make_interval(mins => p_minutos);
    RETURN v_resultado;
END;
$$;

-- Conteo de errores recientes agrupado por tipo (para tasa 5xx / rate limits).
CREATE OR REPLACE FUNCTION public.errores_recientes_para_alerta(p_minutos INTEGER DEFAULT 10)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_resultado JSONB;
BEGIN
    SELECT COALESCE(
        JSONB_AGG(JSONB_BUILD_OBJECT('tipo', tipo, 'total', total) ORDER BY total DESC),
        '[]'::jsonb
    ) INTO v_resultado
    FROM (
        SELECT tipo, COUNT(*)::int AS total
        FROM public.errores_app
        WHERE created_at > NOW() - make_interval(mins => p_minutos)
        GROUP BY tipo
    ) t;
    RETURN v_resultado;
END;
$$;

-- ¿Ya se alertó del mismo evento en los últimos p_minutos? (cooldown del webhook)
CREATE OR REPLACE FUNCTION public.alerta_reciente(p_evento TEXT, p_minutos INTEGER DEFAULT 60)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.alertas
        WHERE evento = p_evento AND created_at > NOW() - make_interval(mins => p_minutos)
    );
END;
$$;

-- ============================================================
-- 5) Permisos
-- ============================================================
-- Solo lectura de admin sobre las tablas de monitoreo; los inserts
-- pasan por los RPCs SECURITY DEFINER de arriba.
GRANT SELECT ON public.errores_app, public.alertas, public.historial_tarifas TO authenticated;
REVOKE ALL ON public.errores_app, public.alertas, public.historial_tarifas FROM anon;

GRANT EXECUTE ON FUNCTION public.pedidos_pendientes_para_alerta(INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.errores_recientes_para_alerta(INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alerta_reciente(TEXT, INTEGER) TO anon, authenticated;

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT public.registrar_error('cliente', 'unhandled', 'Error de prueba');
-- SELECT * FROM public.errores_app ORDER BY id DESC LIMIT 5;
-- UPDATE public.tarifas SET valor = 7000 WHERE zona_origen_id = 'centro' AND zona_destino_id = 'norte_1_18';
-- SELECT * FROM public.historial_tarifas ORDER BY id DESC LIMIT 5;
