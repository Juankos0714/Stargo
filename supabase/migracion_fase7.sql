-- ============================================================
-- StarGo · Fase 7 — Recargos, cancelaciones y pulido de flujo
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase.
-- Requiere las tablas y funciones de las Fases 2-5 (recargos, pedidos,
-- historial_estados, es_admin(), crear_pedido(), transicionar_pedido()).
--
-- Resumen:
--  * recargos: se amplía con `descripcion` y `activo` (categorías:
--    compra, tiempo_espera, paradas, peso, pago, otro).
--  * pedidos: recargos (JSONB snapshot), recargo_total, total y
--    motivo_cancelacion.
--  * crear_pedido: nueva sobrecarga que acepta códigos de recargo y
--    recalcula el total EN LA BD (nunca confía en el cliente).
--  * transicionar_pedido: nueva sobrecarga que guarda el motivo al cancelar.
--  * cancelar_pedido_cliente: RPC público por código de seguimiento;
--    el cliente solo puede cancelar pedidos en estado 'pendiente'.
--  * consultar_pedido: ahora devuelve recargos, recargo_total, total y
--    motivo_cancelacion.
-- ============================================================

-- ============================================================
-- 1) Tabla recargos: descripción + activo + RLS
-- ============================================================
ALTER TABLE public.recargos
    ADD COLUMN IF NOT EXISTS descripcion TEXT,
    ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_recargos_activo ON public.recargos (activo);

ALTER TABLE public.recargos ENABLE ROW LEVEL SECURITY;

-- Lectura pública (el formulario del cliente lista los activos);
-- escritura solo admin.
DROP POLICY IF EXISTS recargos_public_select ON public.recargos;
CREATE POLICY recargos_public_select ON public.recargos
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS recargos_admin_all ON public.recargos;
CREATE POLICY recargos_admin_all ON public.recargos
    FOR ALL USING (public.es_admin()) WITH CHECK (public.es_admin());

-- ============================================================
-- 2) pedidos: recargos, total y motivo de cancelación
-- ============================================================
ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS recargos JSONB,
    ADD COLUMN IF NOT EXISTS recargo_total INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total INTEGER,
    ADD COLUMN IF NOT EXISTS motivo_cancelacion TEXT;

-- Backfill: pedidos existentes sin total.
UPDATE public.pedidos
SET total = tarifa_base + recargo_total
WHERE total IS NULL;

-- ============================================================
-- 3) crear_pedido (sobrecarga con recargos)
-- ============================================================
-- Recalcula la tarifa base y suma los recargos activos indicados.
-- Los códigos desconocidos/inactivos son un error (integridad), nunca
-- se ignoran en silencio. El snapshot en JSONB conserva nombre y valor
-- aunque el admin edite el recargo después.
CREATE OR REPLACE FUNCTION public.crear_pedido(
    p_barrio_origen_id UUID,
    p_direccion_origen TEXT,
    p_barrio_destino_id UUID,
    p_direccion_destino TEXT,
    p_observaciones TEXT DEFAULT NULL,
    p_recargos TEXT[] DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
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
                recargos, recargo_total, total
            ) VALUES (
                v_numero, p_barrio_origen_id, p_direccion_origen,
                p_barrio_destino_id, p_direccion_destino, p_observaciones,
                v_tarifa, v_zona_origen, v_zona_destino, 'pendiente',
                v_snapshot, v_recargo_total, v_tarifa + v_recargo_total
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
        'zona_destino', v_zona_destino
    );
END;
$$;

-- ============================================================
-- 4) transicionar_pedido (sobrecarga con motivo de cancelación)
-- ============================================================
-- Igual máquina de estados que la Fase 4, pero cuando el estado nuevo es
-- 'cancelado' también guarda motivo_cancelacion en el pedido.
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

    UPDATE public.pedidos
    SET estado = p_estado,
        motivo_cancelacion = CASE WHEN p_estado = 'cancelado' THEN v_motivo_final ELSE motivo_cancelacion END
    WHERE id = p_pedido_id;

    INSERT INTO public.historial_estados (pedido_id, estado, notas)
    VALUES (p_pedido_id, p_estado, v_motivo_final);

    RETURN JSONB_BUILD_OBJECT('pedido_id', p_pedido_id, 'estado', p_estado);
END;
$$;

-- ============================================================
-- 5) cancelar_pedido_cliente (público, por código)
-- ============================================================
-- El cliente solo puede cancelar un pedido que sigue 'pendiente'
-- (aún no asignado a un domiciliario). Registra el motivo en el
-- pedido y en el historial.
CREATE OR REPLACE FUNCTION public.cancelar_pedido_cliente(
    p_numero TEXT,
    p_motivo TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_id UUID;
    v_estado TEXT;
    v_motivo TEXT;
    v_nota TEXT;
BEGIN
    SELECT id, estado INTO v_id, v_estado
    FROM public.pedidos WHERE numero = UPPER(TRIM(p_numero));

    IF v_id IS NULL THEN
        RAISE EXCEPTION 'No se encontró ningún pedido con ese código';
    END IF;

    IF v_estado <> 'pendiente' THEN
        RAISE EXCEPTION 'Solo se puede cancelar un pedido que siga pendiente (sin asignar)';
    END IF;

    v_motivo := NULLIF(TRIM(p_motivo), '');
    v_nota := 'Cancelado por el cliente' || CASE WHEN v_motivo IS NULL THEN '' ELSE ' · ' || v_motivo END;

    UPDATE public.pedidos
    SET estado = 'cancelado', motivo_cancelacion = v_motivo
    WHERE id = v_id;

    INSERT INTO public.historial_estados (pedido_id, estado, notas)
    VALUES (v_id, 'cancelado', v_nota);

    RETURN JSONB_BUILD_OBJECT(
        'pedido_id', v_id,
        'numero', UPPER(TRIM(p_numero)),
        'estado', 'cancelado',
        'motivo_cancelacion', v_motivo
    );
END;
$$;

-- ============================================================
-- 6) consultar_pedido: incluye recargos, total y motivo
-- ============================================================
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
        'recargos', COALESCE(p.recargos, '[]'::jsonb),
        'recargo_total', p.recargo_total,
        'total', p.total,
        'zona_origen', p.zona_origen_id,
        'zona_destino', p.zona_destino_id,
        'estado', p.estado,
        'motivo_cancelacion', p.motivo_cancelacion,
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

-- ============================================================
-- 7) Sobrecargas obsoletas
-- ============================================================
-- La app ya usa siempre las firmas con recargos/motivo; se eliminan las
-- versiones anteriores para no dejar dos caminos de lógica divergentes.
DROP FUNCTION IF EXISTS public.crear_pedido(UUID, TEXT, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.transicionar_pedido(UUID, TEXT, TEXT);

-- ============================================================
-- 8) Permisos
-- ============================================================
GRANT EXECUTE ON FUNCTION public.crear_pedido(UUID, TEXT, UUID, TEXT, TEXT, TEXT[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transicionar_pedido(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_pedido_cliente(TEXT, TEXT) TO anon, authenticated;

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT codigo, nombre, tipo, valor, activo FROM public.recargos ORDER BY tipo, codigo;
-- SELECT numero, tarifa_base, recargo_total, total, estado, motivo_cancelacion FROM public.pedidos ORDER BY created_at DESC LIMIT 10;
-- SELECT public.cancelar_pedido_cliente('XXXXXX', 'Ya no lo necesito');
