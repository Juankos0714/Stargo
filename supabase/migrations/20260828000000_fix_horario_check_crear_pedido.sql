-- ============================================================
-- StarGo · Fix — Restaurar verificación de horario en crear_pedido()
-- ============================================================
-- PROBLEMA: La fase21 (20260826000000) reescribió crear_pedido()
-- SIN incluir la verificación de horario_hoy() que existía desde
-- fase13/fase14/fase19. Esto permitía crear pedidos fuera de
-- horario de atención, rompiendo el bloqueo operativo.
--
-- SOLUCIÓN: Reemplazar crear_pedido() restaurando la llamada
-- horario_hoy() y el RAISE EXCEPTION correspondiente.
--
-- Es seguro ejecutar múltiples veces (CREATE OR REPLACE).
-- ============================================================

-- Asegurar que horario_hoy() existe (por si las migraciones de
-- horarios no se ejecutaron en orden).
-- Si la función ya existe, esto no la modifica.

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

    -- Horario de atención: fuera de horario no se reciben pedidos nuevos.
    -- (Restaurado: se perdió en fase21/fase22)
    v_horario := public.horario_hoy();
    IF NOT (v_horario ->> 'abierto')::boolean THEN
        RAISE EXCEPTION
            'Estamos fuera de horario de atención (hoy de % a %). No se reciben pedidos nuevos.',
            v_horario ->> 'apertura', v_horario ->> 'cierre';
    END IF;

    -- Barrios deben existir (solo para domicilio con origen)
    IF v_tipo = 'domicilio' THEN
        SELECT zona_id INTO v_zona_origen FROM public.barrios WHERE id = p_barrio_origen_id;
        SELECT zona_id INTO v_zona_destino FROM public.barrios WHERE id = p_barrio_destino_id;
        IF v_zona_origen IS NULL OR v_zona_destino IS NULL THEN
            RETURN NULL;
        END IF;

        v_tarifa := public.calcular_tarifa(p_barrio_origen_id::text, p_barrio_destino_id::text);
        IF v_tarifa IS NULL THEN
            RETURN NULL;
        END IF;
    ELSE
        -- compra/diligencia: tarifa = 0 (solo recargos)
        v_tarifa := 0;
        IF p_barrio_destino_id IS NOT NULL THEN
            SELECT zona_id INTO v_zona_destino FROM public.barrios WHERE id = p_barrio_destino_id;
        END IF;
    END IF;

    -- Recargos
    IF p_recargos IS NOT NULL AND array_length(p_recargos, 1) > 0 THEN
        IF array_length(p_recargos, 1) > 15 THEN
            RAISE EXCEPTION 'Demasiados recargos (máx. 15)';
        END IF;
        v_snapshot := '[]'::jsonb;
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

    -- Base necesaria: si no se proporcionó, calcular automáticamente
    IF p_base_necesaria IS NOT NULL AND p_base_necesaria >= 0 THEN
        v_base_necesaria_calc := p_base_necesaria;
    ELSIF v_tipo = 'compra_diligencia' THEN
        -- En compra/diligencia el domiciliario adelanta el total
        v_base_necesaria_calc := v_total;
    ELSE
        -- En domicilio normal no se adelanta pago
        v_base_necesaria_calc := 0;
    END IF;

    -- Valor mandado: solo válido para pago/banco, debe ser >= 0
    IF p_valor_mandado IS NOT NULL AND p_valor_mandado >= 0 THEN
        v_valor_mandado := p_valor_mandado;
    ELSE
        v_valor_mandado := NULL;
    END IF;

    -- Código de seguimiento único
    LOOP
        v_numero := UPPER(SUBSTR(MD5(RANDOM()::text || CLOCK_TIMESTAMP()::text), 1, 6));
        BEGIN
            INSERT INTO public.pedidos (
                numero, barrio_origen_id, direccion_origen,
                barrio_destino_id, direccion_destino, observaciones,
                tarifa_base, zona_origen_id, zona_destino_id, estado,
                recargos, recargo_total, total, tipo_servicio,
                recargos_confirmados_no_aplica,
                telefono, nombre_cliente, base_necesaria,
                valor_mandado
            ) VALUES (
                v_numero, p_barrio_origen_id, p_direccion_origen,
                p_barrio_destino_id, p_direccion_destino, p_observaciones,
                v_tarifa, v_zona_origen, v_zona_destino, 'pendiente',
                v_snapshot, v_recargo_total, v_total, v_tipo,
                p_recargos_confirmados_no_aplica,
                NULLIF(TRIM(p_telefono), ''), NULLIF(TRIM(p_nombre_cliente), ''),
                v_base_necesaria_calc,
                v_valor_mandado
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
