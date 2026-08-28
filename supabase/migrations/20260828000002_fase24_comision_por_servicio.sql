-- ============================================================
-- StarGo · Fase 24 — Comisión por servicio (no por día)
-- ============================================================
-- Cambio de modelo de negocio:
--
-- ANTES (Fase 13): La comisión se calculaba por el total acumulado
--   del día. Ejemplo: 3 pedidos de $15k → total $45k → nivel 4 →
--   comisión del día = $5.200 (suma de niveles 1..4).
--
-- AHORA (Fase 24): Cada servicio/domicilio genera UNA comisión
--   igual a la tarifa del nivel que tenía el domiciliario al
--   completar el servicio. Ejemplo: domiciliario en nivel 1,
--   realiza 3 servicios → 3 × $1.300 = $3.900.
--
-- Requiere: Fase 23 (deuda_movimientos, deuda_actual, credito_favor).
--
-- CAMBIOS:
--   1) domiciliarios.nivel: nivel actual del domiciliario (default 1)
--   2) deuda_movimientos: columnas nivel y tarifa_aplicada
--   3) RPC registrar_generacion_deuda: recibe nivel y tarifa
--   4) RPC domiciliarios_con_deuda: incluye nivel
--   5) Backfill: nivel = 1 para todos (nivel por defecto)
-- ============================================================

-- ============================================================
-- 1) Nivel del domiciliario
-- ============================================================
ALTER TABLE public.domiciliarios
    ADD COLUMN IF NOT EXISTS nivel INTEGER NOT NULL DEFAULT 1
    CHECK (nivel > 0);

-- ============================================================
-- 2) Columnas nivel y tarifa en el ledger
-- ============================================================
-- Estas columnas registran el nivel y tarifa vigentes al momento
-- de generar la comisión, para auditoría histórica.
ALTER TABLE public.deuda_movimientos
    ADD COLUMN IF NOT EXISTS nivel INTEGER CHECK (nivel > 0),
    ADD COLUMN IF NOT EXISTS tarifa_aplicada INTEGER CHECK (tarifa_aplicada >= 0);

COMMENT ON COLUMN public.deuda_movimientos.nivel IS
    'Nivel del domiciliario al momento de generar esta comisión.';
COMMENT ON COLUMN public.deuda_movimientos.tarifa_aplicada IS
    'Tarifa (COP) del nivel aplicada para esta comisión.';

-- ============================================================
-- 3) RPC: registrar_generacion_deuda (versión per-servicio)
-- ============================================================
-- Ahora recibe el nivel y la tarifa del domiciliario al momento
-- del servicio, en vez de calcular incrementalmente por día.
-- La versión de Fase 23 tenía tres parámetros. PostgreSQL no reemplaza
-- funciones cuando cambia su firma: sin este DROP coexistirían ambas y
-- PostgREST escogería la antigua al recibir solo tres argumentos.
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
    -- Un domiciliario puede registrar únicamente la comisión de SU propio
    -- pedido ya entregado. El admin también puede reintentar la operación.
    -- Nunca se confía en p_monto: la tarifa se resuelve en esta transacción.
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

    -- Idempotencia: si ya existe un movimiento para este pedido, no duplicar
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

    -- FOR UPDATE para serializar acceso al saldo
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

    -- La única fuente de verdad para la comisión es el nivel vigente en BD.
    p_monto := v_tarifa;

    -- Aplicar crédito a favor primero
    credito_aplicado := LEAST(v_dom.credito_favor, p_monto);
    monto_efectivo := p_monto - credito_aplicado;

    UPDATE public.domiciliarios
    SET credito_favor = credito_favor - credito_aplicado
    WHERE id = p_domiciliario_id;

    IF monto_efectivo > 0 THEN
        INSERT INTO public.deuda_movimientos
            (domiciliario_id, tipo, monto, saldo_resultante,
             referencia_tipo, referencia_id, notas,
             nivel, tarifa_aplicada)
        VALUES (
            p_domiciliario_id, 'generacion', monto_efectivo,
            v_dom.deuda_actual + monto_efectivo,
            'pedido', p_pedido_id,
            'Comisión por servicio completado',
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

-- ============================================================
-- 4) domiciliarios_con_deuda: incluir nivel
-- ============================================================
CREATE OR REPLACE FUNCTION public.domiciliarios_con_deuda()
RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
    SELECT COALESCE(
        JSONB_AGG(
            JSONB_BUILD_OBJECT(
                'domiciliario_id', d.id,
                'nombre', d.nombre,
                'nivel', d.nivel,
                'deuda_actual', d.deuda_actual,
                'credito_favor', d.credito_favor,
                'bloqueado', d.bloqueado
            ) ORDER BY d.nombre
        ), '[]'::jsonb
    )
    FROM public.domiciliarios d
    WHERE d.activo = TRUE;
$$;

-- ============================================================
-- 5) saldo_deuda: incluir nivel
-- ============================================================
CREATE OR REPLACE FUNCTION public.saldo_deuda(
    p_domiciliario_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
    SELECT COALESCE(
        JSONB_AGG(
            JSONB_BUILD_OBJECT(
                'domiciliario_id', d.id,
                'nombre', d.nombre,
                'nivel', d.nivel,
                'deuda_actual', d.deuda_actual,
                'credito_favor', d.credito_favor
            ) ORDER BY d.nombre
        ), '[]'::jsonb
    )
    FROM public.domiciliarios d
    WHERE (p_domiciliario_id IS NULL OR d.id = p_domiciliario_id)
      AND d.activo = TRUE;
$$;

-- ============================================================
-- 6) RPC: cambiar nivel de domiciliario (solo admin)
-- ============================================================
CREATE OR REPLACE FUNCTION public.cambiar_nivel_domiciliario(
    p_domiciliario_id UUID,
    p_nuevo_nivel INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_anterior INTEGER;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede cambiar el nivel';
    END IF;

    IF p_nuevo_nivel < 1 THEN
        RAISE EXCEPTION 'El nivel debe ser mayor que cero';
    END IF;

    SELECT nivel INTO v_anterior
    FROM public.domiciliarios
    WHERE id = p_domiciliario_id;

    IF v_anterior IS NULL THEN
        RAISE EXCEPTION 'Domiciliario no encontrado';
    END IF;

    UPDATE public.domiciliarios
    SET nivel = p_nuevo_nivel
    WHERE id = p_domiciliario_id;

    RETURN JSONB_BUILD_OBJECT(
        'domiciliario_id', p_domiciliario_id,
        'nivel_anterior', v_anterior,
        'nivel_nuevo', p_nuevo_nivel
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cambiar_nivel_domiciliario(UUID, INTEGER) TO authenticated;

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT id, nombre, nivel, deuda_actual, credito_favor
--   FROM public.domiciliarios
--   WHERE activo = TRUE
--   ORDER BY nombre;
--
-- SELECT domiciliario_id, nivel, tarifa_aplicada, monto, notas
--   FROM public.deuda_movimientos
--   WHERE tipo = 'generacion'
--   ORDER BY creado_en DESC;
--
-- SELECT public.cambiar_nivel_domiciliario('<domi_id>', 2);
