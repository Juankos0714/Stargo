-- ============================================================
-- StarGo · Fase 19 — Teléfono del cliente + botones wa.me
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase (POSTGRES).
-- Requiere las Fases 2-18 (pedidos, crear_pedido).
--
-- CAMBIOS:
--
--   1) pedidos.telefono: celular colombiano del cliente (10 dígitos,
--      normalizado). Es OBLIGATORIO al crear el pedido: sin él no se puede
--      coordinar la entrega por WhatsApp. Las filas previas quedan NULL.
--
--   2) pedidos.nombre_cliente: nombre del cliente, OPCIONAL (el mensaje de
--      WhatsApp lo saluda solo cuando existe).
--
--   3) public.crear_pedido() se re-emite con p_telefono (obligatorio, la BD
--      es la autoridad) y p_nombre_cliente (opcional, máx. 120). El teléfono
--      se normaliza igual que la app (sin espacios/guiones, se descarta el
--      prefijo +57/57) y se guarda en su forma limpia de 10 dígitos.
--
--   RLS: NO cambia ninguna política. pedidos_domiciliario_select (Fase 4-5)
--   ya restringe al domiciliario a sus pedidos asignados, así que el teléfono
--   queda visible SOLO para el admin (pedidos_admin_select) y el domiciliario
--   de ese pedido. consultar_pedido() (público) NO incluye el teléfono: el
--   cliente y el anónimo nunca lo ven.
-- ============================================================

-- ============================================================
-- 1) Columnas nuevas en pedidos
-- ============================================================
ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS telefono TEXT;

ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS nombre_cliente TEXT;

-- Hardening: si algún día una vía directa (service role, endpoint futuro)
-- escribiera el teléfono sin pasar por crear_pedido, el CHECK valida el
-- formato. NULL queda permitido (pedidos previos a la Fase 19).
ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_telefono_check;
ALTER TABLE public.pedidos
    ADD CONSTRAINT pedidos_telefono_check
    CHECK (telefono IS NULL OR telefono ~ '^3\d{9}$');

-- ============================================================
-- 2) crear_pedido con teléfono obligatorio + nombre opcional
-- ============================================================
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
    p_nombre_cliente TEXT DEFAULT NULL
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
    v_telefono TEXT;
    v_nombre_cliente TEXT;
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

    -- Teléfono del cliente (Fase 19): obligatorio para coordinar por
    -- WhatsApp. Se normaliza igual que la app: sin espacios/guiones y
    -- descartando el prefijo +57/57 cuando acompaña a un móvil de 10 dígitos.
    v_telefono := regexp_replace(COALESCE(p_telefono, ''), '\D', '', 'g');
    IF length(v_telefono) = 12 AND left(v_telefono, 2) = '57' THEN
        v_telefono := right(v_telefono, 10);
    END IF;
    IF v_telefono = '' THEN
        RAISE EXCEPTION 'El teléfono es obligatorio para coordinar la entrega.';
    END IF;
    IF v_telefono !~ '^3\d{9}$' THEN
        RAISE EXCEPTION 'Ingresa un número de celular colombiano válido (10 dígitos).';
    END IF;

    -- Nombre del cliente (opcional): se guarda recortado, máx. 120.
    v_nombre_cliente := NULLIF(TRIM(COALESCE(p_nombre_cliente, '')), '');
    IF v_nombre_cliente IS NOT NULL AND length(v_nombre_cliente) > 120 THEN
        RAISE EXCEPTION 'El nombre es demasiado largo (máx. 120 caracteres).';
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
                tipo_servicio, recargos_confirmados_no_aplica,
                telefono, nombre_cliente
            ) VALUES (
                v_numero, p_barrio_origen_id, p_direccion_origen,
                p_barrio_destino_id, p_direccion_destino, p_observaciones,
                v_tarifa, v_zona_origen, v_zona_destino, 'pendiente',
                v_snapshot, v_recargo_total, v_tarifa + v_recargo_total,
                v_tipo_servicio, COALESCE(p_recargos_confirmados_no_aplica, FALSE),
                v_telefono, v_nombre_cliente
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

-- Sobrecarga obsoleta (Fase 14, 8 args): se elimina para que PostgREST no
-- tenga dos candidatas al llamar el RPC (PGRST203), mismo fix que
-- 20260818000000_fix_crear_pedido_overload.sql.
DROP FUNCTION IF EXISTS public.crear_pedido(UUID, TEXT, UUID, TEXT, TEXT, TEXT[], TEXT, BOOLEAN);

GRANT EXECUTE ON FUNCTION public.crear_pedido(UUID, TEXT, UUID, TEXT, TEXT, TEXT[], TEXT, BOOLEAN, TEXT, TEXT) TO anon, authenticated;

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT public.crear_pedido(
--     p_barrio_origen_id => '<uuid>', p_direccion_origen => 'x',
--     p_barrio_destino_id => '<uuid>', p_direccion_destino => 'y',
--     p_telefono => '300 123 4567'
-- );  -- guarda '3001234567'
--
-- SELECT public.crear_pedido(...);  -- sin p_telefono → ERROR 'El teléfono es obligatorio...'
-- SELECT public.crear_pedido(... p_telefono => '4001234567');  -- ERROR 'celular colombiano válido'
--
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid)
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'crear_pedido';
-- → 1 fila: (UUID, TEXT, UUID, TEXT, TEXT, TEXT[], TEXT, BOOLEAN, TEXT, TEXT)
