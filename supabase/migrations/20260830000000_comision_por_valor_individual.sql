-- ============================================================
-- StarGo · Comisión por valor individual del servicio
-- ============================================================
-- Cada entrega se clasifica con el total de ESE pedido. El nivel del
-- domiciliario no interviene: por ejemplo, $8.000 → nivel 1, $18.000 →
-- nivel 2 y un siguiente pedido de $6.000 vuelve al nivel 1.

CREATE OR REPLACE FUNCTION public.registrar_generacion_deuda(
    p_pedido_id UUID,
    p_domiciliario_id UUID,
    p_monto INTEGER,
    p_nivel INTEGER DEFAULT NULL,
    p_tarifa INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_dom RECORD;
    v_pedido RECORD;
    v_actor_domiciliario UUID;
    v_niveles JSONB;
    v_nivel INTEGER;
    v_tarifa INTEGER;
    v_total INTEGER;
    monto_efectivo INTEGER;
    credito_aplicado INTEGER;
    nuevo_saldo INTEGER;
    v_existe BOOLEAN;
BEGIN
    v_actor_domiciliario := public.mi_domiciliario_id();
    IF NOT public.es_admin()
       AND (v_actor_domiciliario IS NULL OR v_actor_domiciliario <> p_domiciliario_id) THEN
        RAISE EXCEPTION 'No tienes permisos para registrar esta comisión';
    END IF;

    SELECT id, domiciliario_id, estado, total, tarifa_base, recargo_total INTO v_pedido
    FROM public.pedidos
    WHERE id = p_pedido_id;
    IF v_pedido IS NULL
       OR v_pedido.domiciliario_id <> p_domiciliario_id
       OR v_pedido.estado <> 'entregado' THEN
        RAISE EXCEPTION 'La comisión solo se puede registrar para un pedido entregado y asignado al domiciliario';
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM public.deuda_movimientos
        WHERE domiciliario_id = p_domiciliario_id
          AND referencia_tipo = 'pedido'
          AND referencia_id = p_pedido_id
    ) INTO v_existe;
    IF v_existe THEN
        SELECT deuda_actual, credito_favor INTO v_dom
        FROM public.domiciliarios WHERE id = p_domiciliario_id;
        RETURN JSONB_BUILD_OBJECT(
            'monto', 0, 'monto_efectivo', 0, 'credito_aplicado', 0,
            'deuda_actual', COALESCE(v_dom.deuda_actual, 0),
            'credito_favor', COALESCE(v_dom.credito_favor, 0),
            'ya_registrado', true
        );
    END IF;

    SELECT id, deuda_actual, credito_favor INTO v_dom
    FROM public.domiciliarios WHERE id = p_domiciliario_id FOR UPDATE;
    IF v_dom IS NULL THEN
        RAISE EXCEPTION 'Domiciliario no encontrado';
    END IF;

    -- Si la escalera cambió hoy, conserva el snapshot del día; si no, usa
    -- la vigente. Así un cambio de configuración no altera entregas previas.
    SELECT niveles INTO v_niveles
    FROM public.comision_historico
    WHERE fecha = (NOW() AT TIME ZONE 'America/Bogota')::DATE;
    IF v_niveles IS NULL THEN
        SELECT jsonb_agg(jsonb_build_object('nivel', nivel, 'hasta', hasta, 'valor', valor) ORDER BY nivel)
        INTO v_niveles
        FROM public.comision_niveles;
    END IF;

    v_total := GREATEST(0, COALESCE(v_pedido.total, v_pedido.tarifa_base + v_pedido.recargo_total, 0));
    SELECT (n ->> 'nivel')::INTEGER, (n ->> 'valor')::INTEGER
    INTO v_nivel, v_tarifa
    FROM jsonb_array_elements(v_niveles) AS n
    WHERE v_total <= (n ->> 'hasta')::INTEGER
    ORDER BY (n ->> 'nivel')::INTEGER
    LIMIT 1;
    IF v_nivel IS NULL THEN
        SELECT (n ->> 'nivel')::INTEGER, (n ->> 'valor')::INTEGER
        INTO v_nivel, v_tarifa
        FROM jsonb_array_elements(v_niveles) AS n
        ORDER BY (n ->> 'nivel')::INTEGER DESC
        LIMIT 1;
    END IF;
    IF v_tarifa IS NULL OR v_tarifa <= 0 THEN
        RAISE EXCEPTION 'No hay una tarifa de comisión válida para el total del pedido';
    END IF;

    credito_aplicado := LEAST(v_dom.credito_favor, v_tarifa);
    monto_efectivo := v_tarifa - credito_aplicado;
    UPDATE public.domiciliarios
    SET credito_favor = credito_favor - credito_aplicado
    WHERE id = p_domiciliario_id;

    IF monto_efectivo > 0 THEN
        INSERT INTO public.deuda_movimientos
            (domiciliario_id, tipo, monto, saldo_resultante, referencia_tipo,
             referencia_id, notas, nivel, tarifa_aplicada)
        VALUES (
            p_domiciliario_id, 'generacion', monto_efectivo,
            v_dom.deuda_actual + monto_efectivo, 'pedido', p_pedido_id,
            'Comisión por servicio completado', v_nivel, v_tarifa
        );
        nuevo_saldo := v_dom.deuda_actual + monto_efectivo;
    ELSE
        nuevo_saldo := v_dom.deuda_actual;
    END IF;

    RETURN JSONB_BUILD_OBJECT(
        'monto', v_tarifa, 'monto_efectivo', monto_efectivo,
        'credito_aplicado', credito_aplicado, 'deuda_actual', nuevo_saldo,
        'credito_favor', v_dom.credito_favor - credito_aplicado,
        'ya_registrado', false, 'nivel', v_nivel
    );
END;
$$;

COMMENT ON COLUMN public.deuda_movimientos.nivel IS
    'Nivel calculado según el total individual del pedido al generar la comisión.';
