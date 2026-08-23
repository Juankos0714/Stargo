-- ============================================================
-- Hotfix: transicionar_pedido — buscar turno activo en cancelar/entregar
-- Bug: sin finalizado_en IS NULL, podía encontrar turno cerrado
-- y no liberar la base del turno activo.
-- ============================================================

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
    v_turno RECORD;
    v_base_necesaria INTEGER;
    v_ya_reservada BOOLEAN;
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

    IF p_estado = 'cancelado' THEN
        v_motivo_final := COALESCE(NULLIF(TRIM(p_motivo), ''), NULLIF(TRIM(p_nota), ''));
    ELSE
        v_motivo_final := NULLIF(TRIM(p_nota), '');
    END IF;

    v_base_necesaria := COALESCE(v_pedido.base_necesaria, 0);

    -- Al ACEPTAR (asignado → aceptado): reservar base si aplica
    IF v_pedido.estado = 'asignado' AND p_estado = 'aceptado' AND v_base_necesaria > 0 THEN
        SELECT t.id, t.base_disponible_actual INTO v_turno
        FROM public.turnos t
        WHERE t.domiciliario_id = v_pedido.domiciliario_id
          AND t.finalizado_en IS NULL
        FOR UPDATE;

        IF v_turno IS NULL THEN
            RAISE EXCEPTION 'El domiciliario no tiene un turno activo para reservar base';
        END IF;

        IF v_turno.base_disponible_actual < v_base_necesaria THEN
            RAISE EXCEPTION 'Base insuficiente al aceptar. Disponible: %, necesario: %',
                v_turno.base_disponible_actual, v_base_necesaria;
        END IF;

        SELECT EXISTS(
            SELECT 1 FROM public.base_movimientos
            WHERE turno_id = v_turno.id AND pedido_id = p_pedido_id AND tipo = 'reserva'
        ) INTO v_ya_reservada;

        IF NOT v_ya_reservada THEN
            INSERT INTO public.base_movimientos (turno_id, pedido_id, monto, tipo, notas)
            VALUES (v_turno.id, p_pedido_id, v_base_necesaria, 'reserva',
                    'Reserva de base al aceptar pedido ' || v_pedido.numero);
        END IF;
    END IF;

    -- Al ENTREGAR (en_camino → entregado): liberar base reservada
    IF v_pedido.estado = 'en_camino' AND p_estado = 'entregado' AND v_base_necesaria > 0 THEN
        SELECT t.id INTO v_turno
        FROM public.turnos t
        WHERE t.domiciliario_id = v_pedido.domiciliario_id
          AND t.finalizado_en IS NULL
        LIMIT 1;

        IF v_turno IS NOT NULL THEN
            SELECT EXISTS(
                SELECT 1 FROM public.base_movimientos
                WHERE turno_id = v_turno.id AND pedido_id = p_pedido_id AND tipo = 'reserva'
            ) INTO v_ya_reservada;

            IF v_ya_reservada THEN
                IF NOT EXISTS(
                    SELECT 1 FROM public.base_movimientos
                    WHERE turno_id = v_turno.id AND pedido_id = p_pedido_id
                      AND tipo IN ('liberacion', 'liquidacion')
                ) THEN
                    INSERT INTO public.base_movimientos (turno_id, pedido_id, monto, tipo, notas)
                    VALUES (v_turno.id, p_pedido_id, v_base_necesaria, 'liberacion',
                            'Base liberada al entregar pedido ' || v_pedido.numero);
                END IF;
            END IF;
        END IF;
    END IF;

    -- Al CANCELAR: liberar base reservada si existía
    IF p_estado = 'cancelado' AND v_base_necesaria > 0 THEN
        SELECT t.id INTO v_turno
        FROM public.turnos t
        WHERE t.domiciliario_id = v_pedido.domiciliario_id
          AND t.finalizado_en IS NULL
        LIMIT 1;

        IF v_turno IS NOT NULL THEN
            SELECT EXISTS(
                SELECT 1 FROM public.base_movimientos
                WHERE turno_id = v_turno.id AND pedido_id = p_pedido_id AND tipo = 'reserva'
            ) INTO v_ya_reservada;

            IF v_ya_reservada THEN
                IF NOT EXISTS(
                    SELECT 1 FROM public.base_movimientos
                    WHERE turno_id = v_turno.id AND pedido_id = p_pedido_id
                      AND tipo IN ('liberacion', 'liquidacion')
                ) THEN
                    INSERT INTO public.base_movimientos (turno_id, pedido_id, monto, tipo, notas)
                    VALUES (v_turno.id, p_pedido_id, v_base_necesaria, 'liberacion',
                            'Base liberada al cancelar pedido ' || v_pedido.numero);
                END IF;
            END IF;
        END IF;
    END IF;

    UPDATE public.pedidos
    SET estado = p_estado,
        motivo_cancelacion = CASE WHEN p_estado = 'cancelado' THEN v_motivo_final ELSE motivo_cancelacion END
    WHERE id = p_pedido_id;

    INSERT INTO public.historial_estados (pedido_id, estado, notas)
    VALUES (p_pedido_id, p_estado, v_motivo_final);

    RETURN JSONB_BUILD_OBJECT('pedido_id', p_pedido_id, 'estado', p_estado);
END;
$$;
