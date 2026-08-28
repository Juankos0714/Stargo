-- ============================================================
-- Hotfix: cobro de comisión al entregar
-- ============================================================
-- La Fase 24 cambió registrar_generacion_deuda de 3 a 5 parámetros.
-- PostgreSQL conservó la firma anterior como una sobrecarga, por lo que una
-- llamada con 3 argumentos y monto 0 no generaba deuda. Se elimina esa firma
-- y se cobra dentro de la misma transacción que marca el pedido entregado.

DROP FUNCTION IF EXISTS public.registrar_generacion_deuda(UUID, UUID, INTEGER);

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
    v_tarifa INTEGER;
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

    SELECT id, domiciliario_id, estado INTO v_pedido
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
            'monto', 0, 'monto_efectivo', 0,
            'credito_aplicado', 0,
            'deuda_actual', COALESCE(v_dom.deuda_actual, 0),
            'credito_favor', COALESCE(v_dom.credito_favor, 0),
            'ya_registrado', true
        );
    END IF;

    SELECT id, deuda_actual, credito_favor, nivel INTO v_dom
    FROM public.domiciliarios
    WHERE id = p_domiciliario_id
    FOR UPDATE;
    IF v_dom IS NULL THEN
        RAISE EXCEPTION 'Domiciliario no encontrado';
    END IF;

    SELECT valor INTO v_tarifa
    FROM public.comision_niveles
    WHERE nivel = v_dom.nivel;
    IF v_tarifa IS NULL OR v_tarifa <= 0 THEN
        RAISE EXCEPTION 'No hay una tarifa de comisión válida para el nivel %', v_dom.nivel;
    END IF;

    p_monto := v_tarifa;
    credito_aplicado := LEAST(v_dom.credito_favor, p_monto);
    monto_efectivo := p_monto - credito_aplicado;

    UPDATE public.domiciliarios
    SET credito_favor = credito_favor - credito_aplicado
    WHERE id = p_domiciliario_id;

    IF monto_efectivo > 0 THEN
        INSERT INTO public.deuda_movimientos
            (domiciliario_id, tipo, monto, saldo_resultante,
             referencia_tipo, referencia_id, notas, nivel, tarifa_aplicada)
        VALUES (
            p_domiciliario_id, 'generacion', monto_efectivo,
            v_dom.deuda_actual + monto_efectivo,
            'pedido', p_pedido_id, 'Comisión por servicio completado',
            v_dom.nivel, v_tarifa
        );
        nuevo_saldo := v_dom.deuda_actual + monto_efectivo;
    ELSE
        nuevo_saldo := v_dom.deuda_actual;
    END IF;

    RETURN JSONB_BUILD_OBJECT(
        'monto', p_monto,
        'monto_efectivo', monto_efectivo,
        'credito_aplicado', credito_aplicado,
        'deuda_actual', nuevo_saldo,
        'credito_favor', v_dom.credito_favor - credito_aplicado,
        'ya_registrado', false
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_generacion_deuda(UUID, UUID, INTEGER, INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.cobrar_comision_al_entregar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Solo los pedidos asignados que pasan realmente a entregado generan
    -- comisión. La función de deuda es idempotente por pedido, por lo que un
    -- reintento nunca duplica la deuda.
    IF NEW.domiciliario_id IS NOT NULL
       AND NEW.estado = 'entregado'
       AND OLD.estado IS DISTINCT FROM 'entregado' THEN
        PERFORM public.registrar_generacion_deuda(
            NEW.id,
            NEW.domiciliario_id,
            0,
            NULL,
            NULL
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_cobrar_comision_entrega ON public.pedidos;
CREATE TRIGGER trg_pedidos_cobrar_comision_entrega
    AFTER UPDATE OF estado ON public.pedidos
    FOR EACH ROW
    WHEN (NEW.estado = 'entregado' AND OLD.estado IS DISTINCT FROM 'entregado')
    EXECUTE FUNCTION public.cobrar_comision_al_entregar();

REVOKE ALL ON FUNCTION public.cobrar_comision_al_entregar() FROM PUBLIC, anon, authenticated;
