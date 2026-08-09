-- ============================================================
-- StarGo · Fase 14 — Tipo de servicio (domicilio / compra-diligencia)
-- + decisión obligatoria de recargos
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase (POSTGRES).
-- Requiere las Fases 2-13 (pedidos, recargos, crear_pedido con horario).
--
-- CAMBIOS:
--
--   1) pedidos.tipo_servicio: 'domicilio' (default) o 'compra_diligencia'.
--      - domicilio:        origen Y destino obligatorios (como hasta ahora).
--      - compra_diligencia: destino obligatorio, ORIGEN OPCIONAL (p. ej. un
--        pago bancario solo va al banco; una compra grande sí recoge antes).
--      - Sin ruta origen→destino completa, no hay tarifa automática:
--        tarifa_base = 0 y el domiciliario confirma el precio final al
--        realizar la diligencia.
--
--   2) pedidos.recargos_confirmados_no_aplica: BOOLEAN. Distingue en
--      auditoría/reportes «no se revisó» de «se revisó y no aplica»:
--      el formulario exige elegir recargos o marcar explícitamente
--      «No aplica» antes de poder enviar el pedido.
--
--   3) public.crear_pedido() se re-emite con p_tipo_servicio y
--      p_recargos_confirmados_no_aplica (defaults: no rompen llamadas
--      previas). Valida las reglas de cada tipo en la BD.
-- ============================================================

-- ============================================================
-- 1) Columnas nuevas en pedidos
-- ============================================================
ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS tipo_servicio TEXT NOT NULL DEFAULT 'domicilio'
        CHECK (tipo_servicio IN ('domicilio', 'compra_diligencia'));

ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS recargos_confirmados_no_aplica BOOLEAN NOT NULL DEFAULT FALSE;

-- Compra/diligencia sin recogida: el origen (barrio y dirección) pasa a ser
-- OPCIONAL a nivel de esquema. La FK de barrios sigue validando cuando hay
-- valor (las FK no impiden NULL).
ALTER TABLE public.pedidos ALTER COLUMN barrio_origen_id DROP NOT NULL;
ALTER TABLE public.pedidos ALTER COLUMN direccion_origen DROP NOT NULL;

-- ============================================================
-- 2) crear_pedido con reglas por tipo de servicio
-- ============================================================
CREATE OR REPLACE FUNCTION public.crear_pedido(
    p_barrio_origen_id UUID DEFAULT NULL,
    p_direccion_origen TEXT DEFAULT NULL,
    p_barrio_destino_id UUID DEFAULT NULL,
    p_direccion_destino TEXT DEFAULT NULL,
    p_observaciones TEXT DEFAULT NULL,
    p_recargos TEXT[] DEFAULT NULL,
    p_tipo_servicio TEXT DEFAULT 'domicilio',
    p_recargos_confirmados_no_aplica BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_horario JSONB;
    v_tipo_servicio TEXT;
    v_zona_origen TEXT;
    v_zona_destino TEXT;
    v_tarifa INTEGER;
    v_numero TEXT;
    v_id UUID;
    v_codigo TEXT;
    v_rec public.recargos%ROWTYPE;
    v_recargo_total INTEGER := 0;
    v_snapshot JSONB := '[]'::jsonb;
BEGIN
    -- Tipo de servicio válido.
    v_tipo_servicio := COALESCE(p_tipo_servicio, 'domicilio');
    IF v_tipo_servicio NOT IN ('domicilio', 'compra_diligencia') THEN
        RAISE EXCEPTION 'Tipo de servicio no válido: %', v_tipo_servicio;
    END IF;

    -- Horario de atención: fuera de horario no se reciben pedidos nuevos.
    v_horario := public.horario_hoy();
    IF NOT (v_horario ->> 'abierto')::boolean THEN
        RAISE EXCEPTION
            'Estamos fuera de horario de atención (hoy de % a %). No se reciben pedidos nuevos.',
            v_horario ->> 'apertura', v_horario ->> 'cierre';
    END IF;

    -- Destino: obligatorio en ambos tipos (es donde se entrega o se hace la diligencia).
    IF p_barrio_destino_id IS NULL THEN
        RAISE EXCEPTION 'Selecciona el barrio de destino.';
    END IF;
    IF NULLIF(TRIM(p_direccion_destino), '') IS NULL THEN
        RAISE EXCEPTION 'La dirección de destino es obligatoria.';
    END IF;

    -- Origen: obligatorio solo en domicilio (compra/diligencia lo hace opcional).
    IF v_tipo_servicio = 'domicilio' THEN
        IF p_barrio_origen_id IS NULL THEN
            RAISE EXCEPTION 'Selecciona el barrio de origen.';
        END IF;
        IF NULLIF(TRIM(p_direccion_origen), '') IS NULL THEN
            RAISE EXCEPTION 'La dirección de origen es obligatoria.';
        END IF;
    END IF;

    -- Barrios deben existir (zona no nula).
    IF p_barrio_origen_id IS NOT NULL THEN
        SELECT zona_id INTO v_zona_origen FROM public.barrios WHERE id = p_barrio_origen_id;
        IF v_zona_origen IS NULL THEN
            RETURN NULL;
        END IF;
    END IF;
    SELECT zona_id INTO v_zona_destino FROM public.barrios WHERE id = p_barrio_destino_id;
    IF v_zona_destino IS NULL THEN
        RETURN NULL;
    END IF;

    -- Tarifa: con ruta completa se calcula en la matriz; sin origen
    -- (compra/diligencia) queda en 0 y el domiciliario confirma el precio final.
    IF p_barrio_origen_id IS NOT NULL THEN
        v_tarifa := public.calcular_tarifa(p_barrio_origen_id::text, p_barrio_destino_id::text);
        IF v_tarifa IS NULL THEN
            RETURN NULL; -- trayecto sin tarifa o en zona no disponible
        END IF;
    ELSE
        v_tarifa := 0;
    END IF;

    -- Recargos: validar códigos y armar el snapshot con nombre + valor.
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

    -- Código de seguimiento único (reintenta ante colisión)
    LOOP
        v_numero := UPPER(SUBSTR(MD5(RANDOM()::text || CLOCK_TIMESTAMP()::text), 1, 6));
        BEGIN
            INSERT INTO public.pedidos (
                numero, barrio_origen_id, direccion_origen,
                barrio_destino_id, direccion_destino, observaciones,
                tarifa_base, zona_origen_id, zona_destino_id, estado,
                recargos, recargo_total, total,
                tipo_servicio, recargos_confirmados_no_aplica
            ) VALUES (
                v_numero, p_barrio_origen_id, p_direccion_origen,
                p_barrio_destino_id, p_direccion_destino, p_observaciones,
                v_tarifa, v_zona_origen, v_zona_destino, 'pendiente',
                v_snapshot, v_recargo_total, v_tarifa + v_recargo_total,
                v_tipo_servicio, COALESCE(p_recargos_confirmados_no_aplica, FALSE)
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
        'total', v_tarifa + v_recargo_total,
        'estado', 'pendiente',
        'zona_origen', v_zona_origen,
        'zona_destino', v_zona_destino,
        'tipo_servicio', v_tipo_servicio
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.crear_pedido(UUID, TEXT, UUID, TEXT, TEXT, TEXT[], TEXT, BOOLEAN) TO anon, authenticated;

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT public.crear_pedido(
--     p_barrio_origen_id => NULL,
--     p_direccion_origen => NULL,
--     p_barrio_destino_id => '<uuid>',
--     p_direccion_destino => 'Banco X, Calle 10',
--     p_tipo_servicio => 'compra_diligencia',
--     p_recargos_confirmados_no_aplica => TRUE
-- );  -- tarifa_base = 0, sin exigir origen
