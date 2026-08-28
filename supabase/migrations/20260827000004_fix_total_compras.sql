-- ============================================================
-- StarGo · Fix — conservar la tarifa calculada en compras
-- ============================================================
-- Las compras tienen punto de recogida y destino. La versión anterior de
-- crear_pedido() guardaba tarifa_base = 0 para TODO compra_diligencia,
-- aunque el cotizador ya hubiera calculado el trayecto. Por eso las vistas
-- operativas terminaban mostrando únicamente el recargo de compra.

CREATE OR REPLACE FUNCTION public.crear_pedido(
    p_barrio_origen_id UUID DEFAULT NULL,
    p_direccion_origen TEXT DEFAULT NULL,
    p_barrio_destino_id UUID DEFAULT NULL,
    p_direccion_destino TEXT DEFAULT NULL,
    p_observaciones TEXT DEFAULT NULL,
    p_recargos TEXT[] DEFAULT NULL,
    p_tipo_servicio TEXT DEFAULT 'domicilio',
    p_recargos_confirmados_no_aplica BOOLEAN DEFAULT FALSE,
    p_telefono TEXT DEFAULT NULL,
    p_nombre_cliente TEXT DEFAULT NULL,
    p_base_necesaria INTEGER DEFAULT NULL,
    p_valor_mandado INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_horario JSONB;
    v_zona_origen TEXT;
    v_zona_destino TEXT;
    v_tarifa INTEGER;
    v_numero TEXT;
    v_id UUID;
    v_codigo TEXT;
    v_rec public.recargos%ROWTYPE;
    v_recargo_total INTEGER := 0;
    v_snapshot JSONB := '[]'::jsonb;
    v_total INTEGER;
    v_tipo TEXT;
    v_base_necesaria_calc INTEGER := 0;
    v_valor_mandado INTEGER;
BEGIN
    v_tipo := COALESCE(NULLIF(TRIM(p_tipo_servicio), ''), 'domicilio');

    v_horario := public.horario_hoy();
    IF NOT (v_horario ->> 'abierto')::boolean THEN
        RAISE EXCEPTION
            'Estamos fuera de horario de atención (hoy de % a %). No se reciben pedidos nuevos.',
            v_horario ->> 'apertura', v_horario ->> 'cierre';
    END IF;

    -- Todo pedido con recogida cobra su trayecto, incluido compra/diligencia.
    -- Solo las diligencias sin origen (p. ej. un pago directo) quedan sin
    -- tarifa de trayecto y se cobran mediante sus recargos específicos.
    IF p_barrio_origen_id IS NOT NULL THEN
        SELECT zona_id INTO v_zona_origen FROM public.barrios WHERE id = p_barrio_origen_id;
        SELECT zona_id INTO v_zona_destino FROM public.barrios WHERE id = p_barrio_destino_id;
        IF v_zona_origen IS NULL OR v_zona_destino IS NULL THEN
            RETURN NULL;
        END IF;

        v_tarifa := public.calcular_tarifa(p_barrio_origen_id::text, p_barrio_destino_id::text);
        IF v_tarifa IS NULL THEN
            RETURN NULL;
        END IF;
    ELSIF v_tipo = 'domicilio' THEN
        RETURN NULL;
    ELSE
        v_tarifa := 0;
        IF p_barrio_destino_id IS NOT NULL THEN
            SELECT zona_id INTO v_zona_destino FROM public.barrios WHERE id = p_barrio_destino_id;
        END IF;
    END IF;

    IF p_recargos IS NOT NULL AND array_length(p_recargos, 1) > 0 THEN
        IF array_length(p_recargos, 1) > 15 THEN
            RAISE EXCEPTION 'Demasiados recargos (máx. 15)';
        END IF;
        FOREACH v_codigo IN ARRAY p_recargos LOOP
            SELECT * INTO v_rec FROM public.recargos WHERE codigo = v_codigo;
            IF v_rec.codigo IS NULL OR NOT v_rec.activo THEN
                RAISE EXCEPTION 'Recargo inválido o inactivo: %', v_codigo;
            END IF;
            v_recargo_total := v_recargo_total + v_rec.valor;
            v_snapshot := v_snapshot || jsonb_build_object(
                'codigo', v_rec.codigo,
                'nombre', v_rec.nombre,
                'valor', v_rec.valor
            );
        END LOOP;
    END IF;

    v_total := v_tarifa + v_recargo_total;

    IF p_base_necesaria IS NOT NULL AND p_base_necesaria >= 0 THEN
        v_base_necesaria_calc := p_base_necesaria;
    ELSIF v_tipo = 'compra_diligencia' THEN
        v_base_necesaria_calc := v_total;
    END IF;

    IF p_valor_mandado IS NOT NULL AND p_valor_mandado >= 0 THEN
        v_valor_mandado := p_valor_mandado;
    ELSE
        v_valor_mandado := NULL;
    END IF;

    LOOP
        v_numero := UPPER(SUBSTR(MD5(RANDOM()::text || CLOCK_TIMESTAMP()::text), 1, 6));
        BEGIN
            INSERT INTO public.pedidos (
                numero, barrio_origen_id, direccion_origen,
                barrio_destino_id, direccion_destino, observaciones,
                tarifa_base, zona_origen_id, zona_destino_id, estado,
                recargos, recargo_total, total, tipo_servicio,
                recargos_confirmados_no_aplica,
                telefono, nombre_cliente, base_necesaria, valor_mandado
            ) VALUES (
                v_numero, p_barrio_origen_id, p_direccion_origen,
                p_barrio_destino_id, p_direccion_destino, p_observaciones,
                v_tarifa, v_zona_origen, v_zona_destino, 'pendiente',
                v_snapshot, v_recargo_total, v_total, v_tipo,
                p_recargos_confirmados_no_aplica,
                NULLIF(TRIM(p_telefono), ''), NULLIF(TRIM(p_nombre_cliente), ''),
                v_base_necesaria_calc, v_valor_mandado
            ) RETURNING id INTO v_id;
            EXIT;
        EXCEPTION
            WHEN unique_violation THEN
                -- Reintentar con otro código de seguimiento.
        END;
    END LOOP;

    INSERT INTO public.historial_estados (pedido_id, estado, notas)
    VALUES (v_id, 'pendiente', 'Pedido creado por el cliente');

    RETURN JSONB_BUILD_OBJECT(
        'pedido_id', v_id,
        'numero', v_numero,
        'tarifa_base', v_tarifa,
        'recargos', v_snapshot,
        'recargo_total', v_recargo_total,
        'total', v_total,
        'estado', 'pendiente',
        'zona_origen', v_zona_origen,
        'zona_destino', v_zona_destino,
        'tipo_servicio', v_tipo,
        'base_necesaria', v_base_necesaria_calc,
        'valor_mandado', v_valor_mandado
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.crear_pedido(UUID, TEXT, UUID, TEXT, TEXT, TEXT[], TEXT, BOOLEAN, TEXT, TEXT, INTEGER, INTEGER) TO anon, authenticated;

-- Reparar pedidos creados por la función defectuosa: estos registros tienen
-- origen, pero tarifa_base quedó en cero y total solo contiene recargos.
WITH corregidos AS (
    SELECT
        id,
        public.calcular_tarifa(barrio_origen_id::text, barrio_destino_id::text) AS tarifa
    FROM public.pedidos
    WHERE tipo_servicio = 'compra_diligencia'
      AND barrio_origen_id IS NOT NULL
      AND barrio_destino_id IS NOT NULL
      AND tarifa_base = 0
)
UPDATE public.pedidos AS p
SET
    tarifa_base = c.tarifa,
    total = c.tarifa + COALESCE(p.recargo_total, 0)
FROM corregidos AS c
WHERE p.id = c.id
  AND c.tarifa IS NOT NULL;
