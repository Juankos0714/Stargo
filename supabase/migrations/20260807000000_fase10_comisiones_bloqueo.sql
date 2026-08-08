-- ============================================================
-- StarGo · Fase 10 — Comisiones, abonos y bloqueo por deuda
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase (POSTGRES).
-- Requiere las Fases 2-9 (domiciliarios, transicionar_pedido,
-- asignar_domiciliario, es_admin, mi_domiciliario_id).
--
-- Resumen:
--  * domiciliarios.comision  → precio fijo (COP) que paga el domiciliario
--    a la app por cada pedido entregado. Configurable por el admin por cada
--    domiciliario; cada cambio queda auditado en historial_comisiones.
--  * domiciliarios.bloqueado → bloqueo por falta de pago: el admin no puede
--    asignarle pedidos nuevos (solo el admin lo desbloquea).
--  * pedidos.comision        → snapshot de la comisión al momento de
--    ENTREGAR el pedido (si el admin cambia la comisión después, la deuda
--    de los pedidos ya entregados no cambia).
--  * pagos_domiciliarios     → abonos que el admin registra contra la deuda.
--    Deuda = Σ pedidos entregados.comision − Σ pagos.
-- ============================================================

-- ============================================================
-- 1) domiciliarios: comision + bloqueado
-- ============================================================
ALTER TABLE public.domiciliarios
    ADD COLUMN IF NOT EXISTS comision INTEGER NOT NULL DEFAULT 0
        CHECK (comision >= 0),
    ADD COLUMN IF NOT EXISTS bloqueado BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- 2) pedidos: snapshot de comisión al entregar
-- ============================================================
ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS comision INTEGER NOT NULL DEFAULT 0
        CHECK (comision >= 0);

-- ============================================================
-- 3) historial_comisiones (auditoría de cambios por domiciliario)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.historial_comisiones (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    domiciliario_id UUID NOT NULL
        CONSTRAINT hist_comisiones_dom_fkey
        REFERENCES public.domiciliarios(id) ON DELETE CASCADE,
    comision_anterior INTEGER NOT NULL,
    comision_nueva INTEGER NOT NULL,
    cambiado_por UUID REFERENCES auth.users(id),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hist_comisiones_dom
    ON public.historial_comisiones (domiciliario_id, creado_en DESC);

ALTER TABLE public.historial_comisiones ENABLE ROW LEVEL SECURITY;

-- Admin lee todo; el domiciliario solo su propio historial.
DROP POLICY IF EXISTS hist_comisiones_select ON public.historial_comisiones;
CREATE POLICY hist_comisiones_select ON public.historial_comisiones
    FOR SELECT USING (
        public.es_admin() OR domiciliario_id = public.mi_domiciliario_id()
    );

-- ============================================================
-- 4) pagos_domiciliarios (abonos registrados por el admin)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pagos_domiciliarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domiciliario_id UUID NOT NULL
        CONSTRAINT pagos_dom_fkey
        REFERENCES public.domiciliarios(id) ON DELETE CASCADE,
    valor INTEGER NOT NULL CHECK (valor > 0),
    nota TEXT,
    registrado_por UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pagos_dom
    ON public.pagos_domiciliarios (domiciliario_id, created_at DESC);

ALTER TABLE public.pagos_domiciliarios ENABLE ROW LEVEL SECURITY;

-- Admin lee todo; el domiciliario solo sus propios abonos.
DROP POLICY IF EXISTS pagos_dom_select ON public.pagos_domiciliarios;
CREATE POLICY pagos_dom_select ON public.pagos_domiciliarios
    FOR SELECT USING (
        public.es_admin() OR domiciliario_id = public.mi_domiciliario_id()
    );

-- ============================================================
-- 5) asignar_domiciliario: rechazar domiciliarios bloqueados
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
    -- Mensaje combinado histórico (la suite RLS lo verifica): si no existe o
    -- está inactivo, no se distingue el motivo.
    IF v_dom.id IS NULL OR NOT v_dom.activo THEN
        RAISE EXCEPTION 'El domiciliario no existe o está inactivo';
    END IF;
    IF v_dom.bloqueado THEN
        RAISE EXCEPTION 'El domiciliario está bloqueado por falta de pago. Regístralo al día antes de asignarle pedidos';
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
-- 6) transicionar_pedido: snapshot de comisión al entregar
-- ============================================================
-- Al pasar a 'entregado' se congela la comisión vigente del domiciliario
-- (la de ese momento), para que la deuda quede calculada aunque después
-- el admin cambie el valor.
CREATE OR REPLACE FUNCTION public.transicionar_pedido(
    p_pedido_id UUID,
    p_estado TEXT,
    p_nota TEXT DEFAULT NULL,
    p_motivo TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_pedido public.pedidos%ROWTYPE;
    v_mi_id UUID;
    v_permitidos TEXT[];
    v_motivo_final TEXT;
    v_comision INTEGER;
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

    -- Al cancelar se guarda el motivo (p_motivo con respaldo en p_nota).
    IF p_estado = 'cancelado' THEN
        v_motivo_final := COALESCE(NULLIF(TRIM(p_motivo), ''), NULLIF(TRIM(p_nota), ''));
    ELSE
        v_motivo_final := NULLIF(TRIM(p_nota), '');
    END IF;

    -- Comisión vigente del domiciliario al entregar (0 si no tiene o no hay domi).
    v_comision := 0;
    IF p_estado = 'entregado' AND v_pedido.domiciliario_id IS NOT NULL THEN
        SELECT d.comision INTO v_comision
        FROM public.domiciliarios d
        WHERE d.id = v_pedido.domiciliario_id;
        v_comision := COALESCE(v_comision, 0);
    END IF;

    UPDATE public.pedidos
    SET estado = p_estado,
        motivo_cancelacion = CASE WHEN p_estado = 'cancelado' THEN v_motivo_final ELSE motivo_cancelacion END,
        comision = CASE WHEN p_estado = 'entregado' THEN v_comision ELSE comision END
    WHERE id = p_pedido_id;

    INSERT INTO public.historial_estados (pedido_id, estado, notas)
    VALUES (p_pedido_id, p_estado, v_motivo_final);

    RETURN JSONB_BUILD_OBJECT('pedido_id', p_pedido_id, 'estado', p_estado);
END;
$$;

-- ============================================================
-- 7) RPCs admin: comisión, abonos y bloqueo
-- ============================================================
-- 7a) actualizar_comision_domiciliario: cambia el valor y audita el cambio.
CREATE OR REPLACE FUNCTION public.actualizar_comision_domiciliario(
    p_domiciliario_id UUID,
    p_comision INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_anterior INTEGER;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede cambiar comisiones';
    END IF;
    IF p_comision < 0 THEN
        RAISE EXCEPTION 'La comisión no puede ser negativa';
    END IF;

    SELECT comision INTO v_anterior
    FROM public.domiciliarios WHERE id = p_domiciliario_id;
    IF v_anterior IS NULL THEN
        RAISE EXCEPTION 'Domiciliario no encontrado';
    END IF;

    IF v_anterior = p_comision THEN
        RETURN JSONB_BUILD_OBJECT(
            'domiciliario_id', p_domiciliario_id,
            'comision', p_comision,
            'cambiado', false
        );
    END IF;

    UPDATE public.domiciliarios
    SET comision = p_comision
    WHERE id = p_domiciliario_id;

    INSERT INTO public.historial_comisiones
        (domiciliario_id, comision_anterior, comision_nueva, cambiado_por)
    VALUES (p_domiciliario_id, v_anterior, p_comision, auth.uid());

    RETURN JSONB_BUILD_OBJECT(
        'domiciliario_id', p_domiciliario_id,
        'comision', p_comision,
        'comision_anterior', v_anterior,
        'cambiado', true
    );
END;
$$;

-- 7b) registrar_pago_domiciliario: registra un abono contra la deuda.
CREATE OR REPLACE FUNCTION public.registrar_pago_domiciliario(
    p_domiciliario_id UUID,
    p_valor INTEGER,
    p_nota TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_existe BOOLEAN;
    v_pago public.pagos_domiciliarios%ROWTYPE;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede registrar abonos';
    END IF;
    IF p_valor <= 0 THEN
        RAISE EXCEPTION 'El abono debe ser mayor que cero';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.domiciliarios WHERE id = p_domiciliario_id
    ) INTO v_existe;
    IF NOT v_existe THEN
        RAISE EXCEPTION 'Domiciliario no encontrado';
    END IF;

    INSERT INTO public.pagos_domiciliarios
        (domiciliario_id, valor, nota, registrado_por)
    VALUES (p_domiciliario_id, p_valor, NULLIF(TRIM(p_nota), ''), auth.uid())
    RETURNING * INTO v_pago;

    RETURN JSONB_BUILD_OBJECT(
        'id', v_pago.id,
        'domiciliario_id', v_pago.domiciliario_id,
        'valor', v_pago.valor,
        'nota', v_pago.nota,
        'created_at', v_pago.created_at
    );
END;
$$;

-- 7c) bloquear_domiciliario: bloquea/desbloquea por deuda (solo admin).
CREATE OR REPLACE FUNCTION public.bloquear_domiciliario(
    p_domiciliario_id UUID,
    p_bloqueado BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_existe BOOLEAN;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede bloquear domiciliarios';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.domiciliarios WHERE id = p_domiciliario_id
    ) INTO v_existe;
    IF NOT v_existe THEN
        RAISE EXCEPTION 'Domiciliario no encontrado';
    END IF;

    UPDATE public.domiciliarios
    SET bloqueado = p_bloqueado
    WHERE id = p_domiciliario_id;

    RETURN JSONB_BUILD_OBJECT(
        'domiciliario_id', p_domiciliario_id,
        'bloqueado', p_bloqueado
    );
END;
$$;

-- ============================================================
-- 8) Realtime: pagos e historial para refresco en vivo
-- ============================================================
-- El panel admin ya escucha 'domiciliarios' (los cambios de comisión/bloqueo
-- emiten UPDATE); se publica también pagos_domiciliarios para que los abonos
-- se reflejen sin recargar.
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.pagos_domiciliarios;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.historial_comisiones;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;

ALTER TABLE public.pagos_domiciliarios REPLICA IDENTITY FULL;
ALTER TABLE public.historial_comisiones REPLICA IDENTITY FULL;

-- ============================================================
-- 9) Permisos
-- ============================================================
-- Tablas nuevas privadas: solo SELECT autenticado (RLS filtra por rol);
-- las escrituras pasan por los RPCs SECURITY DEFINER de la sección 7.
GRANT SELECT ON public.pagos_domiciliarios, public.historial_comisiones
    TO authenticated;

GRANT EXECUTE ON FUNCTION public.actualizar_comision_domiciliario(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_pago_domiciliario(UUID, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bloquear_domiciliario(UUID, BOOLEAN) TO authenticated;

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT id, nombre, comision, bloqueado FROM public.domiciliarios ORDER BY nombre;
-- SELECT public.actualizar_comision_domiciliario('<domi>', 2000);
-- SELECT public.registrar_pago_domiciliario('<domi>', 2000, 'Abono en efectivo');
-- SELECT domiciliario_id, SUM(valor) FROM public.pagos_domiciliarios GROUP BY domiciliario_id;
-- SELECT numero, estado, comision FROM public.pedidos WHERE estado = 'entregado' ORDER BY created_at DESC LIMIT 10;
