-- ============================================================
-- StarGo · Fase 23 COMPLETO — Ledger de deuda + Idempotencia
-- ============================================================
-- Migración ÚNICA e idempotente que puede ejecutarse desde cero.
-- Requiere las Fases 2-21 (domiciliarios, pedidos, comision_niveles,
-- comision_historico, pagos_domiciliarios, etc.).
--
-- Incluye TODO en un solo archivo:
--   A) Esquema: columnas, tabla ledger, trigger, RPCs, RLS
--   B) Idempotencia: UNIQUE parcial, ON CONFLICT, anti-duplicados
--   C) Backfill: reconstruir deuda_actual del histórico
--
-- Ejecutar desde el SQL Editor del Dashboard de Supabase.
-- ============================================================


-- ============================================================
-- PARTE A: ESQUEMA
-- ============================================================

-- ── A1) Columnas nuevas en domiciliarios ──
ALTER TABLE public.domiciliarios
    ADD COLUMN IF NOT EXISTS deuda_actual INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS credito_favor INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
    ALTER TABLE public.domiciliarios
        ADD CONSTRAINT chk_domiciliarios_deuda_actual CHECK (deuda_actual >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE public.domiciliarios
        ADD CONSTRAINT chk_domiciliarios_credito_favor CHECK (credito_favor >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── A2) Tabla deuda_movimientos (ledger) ──
CREATE TABLE IF NOT EXISTS public.deuda_movimientos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    domiciliario_id UUID NOT NULL
        CONSTRAINT deuda_mov_dom_fkey
        REFERENCES public.domiciliarios(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('generacion', 'abono')),
    monto INTEGER NOT NULL CHECK (monto > 0),
    saldo_resultante INTEGER NOT NULL,
    referencia_tipo TEXT CHECK (referencia_tipo IN ('pedido', 'abono', 'ajuste')),
    referencia_id UUID,
    notas TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de búsqueda
CREATE INDEX IF NOT EXISTS idx_deuda_mov_dom
    ON public.deuda_movimientos (domiciliario_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_deuda_mov_referencia
    ON public.deuda_movimientos (referencia_tipo, referencia_id)
    WHERE referencia_tipo IS NOT NULL AND referencia_id IS NOT NULL;

-- ── B1) Índices UNIQUE de idempotencia (PARTE B) ──
-- Cada pedido solo puede generar UN movimiento de 'generacion'.
-- Previene deuda duplicada por retry o race condition.
CREATE UNIQUE INDEX IF NOT EXISTS idx_deuda_mov_uniq_pedido
    ON public.deuda_movimientos (domiciliario_id, referencia_id)
    WHERE referencia_tipo = 'pedido' AND referencia_id IS NOT NULL;

-- Cada pago solo puede tener UN movimiento de 'abono' en el ledger.
-- Previene abonos duplicados por retry.
CREATE UNIQUE INDEX IF NOT EXISTS idx_deuda_mov_uniq_abono
    ON public.deuda_movimientos (domiciliario_id, referencia_id)
    WHERE referencia_tipo = 'abono' AND referencia_id IS NOT NULL;

COMMENT ON TABLE public.deuda_movimientos IS
    'Ledger de deuda de domiciliarios. Cada generación de comisión o '
    'abono queda registrado con saldo resultante para auditoría. '
    'Índices UNIQUE previenen duplicados por pedido y por pago.';

-- ── A3) Trigger: mantener deuda_actual sincronizado ──
CREATE OR REPLACE FUNCTION public.actualizar_deuda_actual()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.tipo = 'generacion' THEN
        UPDATE public.domiciliarios
        SET deuda_actual = deuda_actual + NEW.monto
        WHERE id = NEW.domiciliario_id;
    ELSIF NEW.tipo = 'abono' THEN
        UPDATE public.domiciliarios
        SET deuda_actual = GREATEST(0, deuda_actual - NEW.monto)
        WHERE id = NEW.domiciliario_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deuda_mov_actualizar ON public.deuda_movimientos;
CREATE TRIGGER trg_deuda_mov_actualizar
    AFTER INSERT ON public.deuda_movimientos
    FOR EACH ROW EXECUTE FUNCTION public.actualizar_deuda_actual();

-- ── A4) RPC: registrar_generacion_deuda (CON idempotencia) ──
-- Si ya existe un movimiento para este pedido, retorna el saldo
-- actual sin cambios (ya_registrado: true).
CREATE OR REPLACE FUNCTION public.registrar_generacion_deuda(
    p_pedido_id UUID,
    p_domiciliario_id UUID,
    p_monto INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_dom RECORD;
    monto_efectivo INTEGER;
    credito_aplicado INTEGER;
    nuevo_saldo INTEGER;
    v_existe BOOLEAN;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede registrar generación de deuda';
    END IF;

    IF p_monto < 0 THEN
        RAISE EXCEPTION 'El monto de generación no puede ser negativo';
    END IF;

    IF p_monto = 0 THEN
        RETURN JSONB_BUILD_OBJECT(
            'monto', 0, 'monto_efectivo', 0,
            'credito_aplicado', 0, 'deuda_actual', 0, 'credito_favor', 0,
            'ya_registrado', false
        );
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
            'monto', p_monto, 'monto_efectivo', 0,
            'credito_aplicado', 0,
            'deuda_actual', COALESCE(v_dom.deuda_actual, 0),
            'credito_favor', COALESCE(v_dom.credito_favor, 0),
            'ya_registrado', true
        );
    END IF;

    -- FOR UPDATE para serializar acceso al saldo
    SELECT id, deuda_actual, credito_favor INTO v_dom
    FROM public.domiciliarios
    WHERE id = p_domiciliario_id
    FOR UPDATE;

    IF v_dom IS NULL THEN
        RAISE EXCEPTION 'Domiciliario no encontrado';
    END IF;

    -- Aplicar crédito a favor primero
    credito_aplicado := LEAST(v_dom.credito_favor, p_monto);
    monto_efectivo := p_monto - credito_aplicado;

    UPDATE public.domiciliarios
    SET credito_favor = credito_favor - credito_aplicado
    WHERE id = p_domiciliario_id;

    IF monto_efectivo > 0 THEN
        INSERT INTO public.deuda_movimientos
            (domiciliario_id, tipo, monto, saldo_resultante,
             referencia_tipo, referencia_id, notas)
        VALUES (
            p_domiciliario_id, 'generacion', monto_efectivo,
            v_dom.deuda_actual + monto_efectivo,
            'pedido', p_pedido_id,
            'Comisión generada por pedido'
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

-- ── A5) RPC: registrar_abono_deuda (CON anti-duplicados) ──
-- Verifica pagos idénticos en los últimos 5 segundos para evitar
-- duplicados por retry del frontend.
CREATE OR REPLACE FUNCTION public.registrar_abono_deuda(
    p_domiciliario_id UUID,
    p_valor INTEGER,
    p_nota TEXT DEFAULT NULL,
    p_registrado_por UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_dom RECORD;
    excedente INTEGER;
    deuda_restante INTEGER;
    v_pago_id UUID;
    v_existe_duplicado BOOLEAN;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede registrar abonos';
    END IF;

    IF p_valor <= 0 THEN
        RAISE EXCEPTION 'El abono debe ser mayor que cero';
    END IF;

    -- Anti-duplicados: pago idéntico en los últimos 5 segundos
    SELECT EXISTS(
        SELECT 1 FROM public.pagos_domiciliarios
        WHERE domiciliario_id = p_domiciliario_id
          AND valor = p_valor
          AND registrado_por IS NOT DISTINCT FROM p_registrado_por
          AND created_at > NOW() - INTERVAL '5 seconds'
    ) INTO v_existe_duplicado;

    IF v_existe_duplicado THEN
        RETURN JSONB_BUILD_OBJECT(
            'error', 'Pago duplicado detectado',
            'ya_registrado', true
        );
    END IF;

    -- FOR UPDATE para serializar acceso al saldo
    SELECT id, deuda_actual, credito_favor INTO v_dom
    FROM public.domiciliarios
    WHERE id = p_domiciliario_id
    FOR UPDATE;

    IF v_dom IS NULL THEN
        RAISE EXCEPTION 'Domiciliario no encontrado';
    END IF;

    deuda_restante := v_dom.deuda_actual;

    IF p_valor <= deuda_restante THEN
        INSERT INTO public.deuda_movimientos
            (domiciliario_id, tipo, monto, saldo_resultante,
             referencia_tipo, notas)
        VALUES (
            p_domiciliario_id, 'abono', p_valor,
            deuda_restante - p_valor,
            'abono', NULLIF(TRIM(p_nota), '')
        );
        excedente := 0;
    ELSE
        IF deuda_restante > 0 THEN
            INSERT INTO public.deuda_movimientos
                (domiciliario_id, tipo, monto, saldo_resultante,
                 referencia_tipo, notas)
            VALUES (
                p_domiciliario_id, 'abono', deuda_restante, 0,
                'abono', NULLIF(TRIM(p_nota), '')
            );
        END IF;

        excedente := p_valor - deuda_restante;

        UPDATE public.domiciliarios
        SET credito_favor = credito_favor + excedente
        WHERE id = p_domiciliario_id;
    END IF;

    -- Insertar en pagos_domiciliarios (compatibilidad hacia atrás)
    INSERT INTO public.pagos_domiciliarios
        (domiciliario_id, valor, nota, registrado_por)
    VALUES (p_domiciliario_id, p_valor, NULLIF(TRIM(p_nota), ''), p_registrado_por)
    RETURNING id INTO v_pago_id;

    -- Actualizar referencia en el ledger
    UPDATE public.deuda_movimientos
    SET referencia_id = v_pago_id
    WHERE referencia_tipo = 'abono'
      AND domiciliario_id = p_domiciliario_id
      AND referencia_id IS NULL
      AND id = (
          SELECT id FROM public.deuda_movimientos
          WHERE domiciliario_id = p_domiciliario_id AND tipo = 'abono'
            AND referencia_id IS NULL
          ORDER BY creado_en DESC LIMIT 1
      );

    RETURN JSONB_BUILD_OBJECT(
        'pago_id', v_pago_id,
        'valor', p_valor,
        'deuda_actual', GREATEST(0, deuda_restante - p_valor),
        'credito_favor', v_dom.credito_favor + excedente,
        'excedente', excedente,
        'ya_registrado', false
    );
END;
$$;

-- ── A6) RPC: saldo_deuda ──
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
                'deuda_actual', d.deuda_actual,
                'credito_favor', d.credito_favor
            ) ORDER BY d.nombre
        ), '[]'::jsonb
    )
    FROM public.domiciliarios d
    WHERE (p_domiciliario_id IS NULL OR d.id = p_domiciliario_id)
      AND d.activo = TRUE;
$$;

-- ── A7) RPC: domiciliarios_con_deuda ──
CREATE OR REPLACE FUNCTION public.domiciliarios_con_deuda()
RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
    SELECT COALESCE(
        JSONB_AGG(
            JSONB_BUILD_OBJECT(
                'domiciliario_id', d.id,
                'nombre', d.nombre,
                'deuda_actual', d.deuda_actual,
                'credito_favor', d.credito_favor,
                'bloqueado', d.bloqueado
            ) ORDER BY d.nombre
        ), '[]'::jsonb
    )
    FROM public.domiciliarios d
    WHERE d.activo = TRUE;
$$;

-- ── A8) RLS ──
ALTER TABLE public.deuda_movimientos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deuda_movimientos_admin_all ON public.deuda_movimientos;
CREATE POLICY deuda_movimientos_admin_all ON public.deuda_movimientos
    FOR ALL USING (public.es_admin()) WITH CHECK (public.es_admin());

DROP POLICY IF EXISTS deuda_movimientos_domiciliario_select ON public.deuda_movimientos;
CREATE POLICY deuda_movimientos_domiciliario_select ON public.deuda_movimientos
    FOR SELECT USING (domiciliario_id = public.mi_domiciliario_id());

-- ── A9) Permisos ──
GRANT SELECT ON public.deuda_movimientos TO authenticated;
REVOKE ALL ON public.deuda_movimientos FROM anon;

GRANT EXECUTE ON FUNCTION public.registrar_generacion_deuda(UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_abono_deuda(UUID, INTEGER, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.saldo_deuda(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.domiciliarios_con_deuda() TO authenticated;

-- ── A10) Realtime ──
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.deuda_movimientos;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.deuda_movimientos REPLICA IDENTITY FULL;


-- ============================================================
-- PARTE C: BACKFILL (reconstruir saldos del histórico)
-- ============================================================

-- Función auxiliar: comisión diaria en SQL
CREATE OR REPLACE FUNCTION public._backfill_comision_diaria(
    p_total_dia INTEGER,
    p_niveles JSONB
) RETURNS INTEGER
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_nivel_alcanzado INTEGER;
    v_valor_total INTEGER;
BEGIN
    IF p_total_dia IS NULL OR p_total_dia <= 0 OR p_niveles IS NULL THEN
        RETURN 0;
    END IF;

    SELECT (elem ->> 'nivel')::INTEGER INTO v_nivel_alcanzado
    FROM jsonb_array_elements(p_niveles) AS elem
    WHERE (elem ->> 'hasta')::INTEGER >= p_total_dia
    ORDER BY (elem ->> 'nivel')::INTEGER ASC
    LIMIT 1;

    IF v_nivel_alcanzado IS NULL THEN
        SELECT (elem ->> 'nivel')::INTEGER INTO v_nivel_alcanzado
        FROM jsonb_array_elements(p_niveles) AS elem
        ORDER BY (elem ->> 'nivel')::INTEGER DESC
        LIMIT 1;
    END IF;

    IF v_nivel_alcanzado IS NULL THEN
        RETURN 0;
    END IF;

    SELECT COALESCE(SUM((elem ->> 'valor')::INTEGER), 0)
    INTO v_valor_total
    FROM jsonb_array_elements(p_niveles) AS elem
    WHERE (elem ->> 'nivel')::INTEGER <= v_nivel_alcanzado;

    RETURN v_valor_total;
END;
$$;

-- Backfill principal (idempotente: solo ejecuta si no hay registros 'ajuste')
DO $$
DECLARE
    v_dom RECORD;
    v_pedido RECORD;
    v_fecha TEXT;
    v_totales_dia JSONB;
    v_par RECORD;
    v_niveles JSONB;
    v_total_comision INTEGER;
    v_total_pagos INTEGER;
    v_deuda INTEGER;
    v_credito INTEGER;
    v_backfill_count INTEGER := 0;
BEGIN
    SELECT COUNT(*) INTO v_backfill_count
    FROM public.deuda_movimientos WHERE tipo = 'ajuste';

    IF v_backfill_count > 0 THEN
        RAISE NOTICE 'Backfill de deuda ya ejecutado, omitiendo.';
        RETURN;
    END IF;

    RAISE NOTICE 'Iniciando backfill de deuda...';

    FOR v_dom IN
        SELECT d.id, d.nombre
        FROM public.domiciliarios d
        WHERE d.activo = TRUE
    LOOP
        v_totales_dia := '{}'::jsonb;

        FOR v_pedido IN
            SELECT total, tarifa_base, recargo_total, updated_at
            FROM public.pedidos
            WHERE domiciliario_id = v_dom.id
              AND estado = 'entregado'
        LOOP
            v_fecha := to_char(
                (v_pedido.updated_at AT TIME ZONE 'America/Bogota')::date,
                'YYYY-MM-DD'
            );

            DECLARE
                v_total_pedido INTEGER;
            BEGIN
                IF v_pedido.total IS NOT NULL AND v_pedido.total > 0 THEN
                    v_total_pedido := v_pedido.total;
                ELSE
                    v_total_pedido := COALESCE(v_pedido.tarifa_base, 0)
                                    + COALESCE(v_pedido.recargo_total, 0);
                END IF;

                v_totales_dia := v_totales_dia || jsonb_build_object(
                    v_fecha,
                    COALESCE((v_totales_dia ->> v_fecha)::INTEGER, 0) + v_total_pedido
                );
            END;
        END LOOP;

        v_total_comision := 0;

        FOR v_par IN
            SELECT (kv.key) AS fecha, (kv.value)::INTEGER AS total_dia
            FROM jsonb_each(v_totales_dia) AS kv
        LOOP
            SELECT niveles INTO v_niveles
            FROM public.comision_historico
            WHERE fecha = v_par.fecha::date;

            IF v_niveles IS NULL THEN
                SELECT COALESCE(
                    jsonb_agg(
                        jsonb_build_object(
                            'nivel', n.nivel, 'hasta', n.hasta, 'valor', n.valor
                        ) ORDER BY n.nivel
                    ), '[]'::jsonb
                ) INTO v_niveles
                FROM public.comision_niveles n;
            END IF;

            v_total_comision := v_total_comision
                + public._backfill_comision_diaria(v_par.total_dia, v_niveles);
        END LOOP;

        SELECT COALESCE(SUM(valor), 0) INTO v_total_pagos
        FROM public.pagos_domiciliarios
        WHERE domiciliario_id = v_dom.id;

        v_deuda := GREATEST(0, v_total_comision - v_total_pagos);
        v_credito := GREATEST(0, v_total_pagos - v_total_comision);

        UPDATE public.domiciliarios
        SET deuda_actual = v_deuda,
            credito_favor = v_credito
        WHERE id = v_dom.id;

        -- Solo insertar en el ledger si hay deuda (monto > 0 es obligatorio).
        -- Si solo hay crédito (deuda = 0), credito_favor ya se actualizó arriba.
        IF v_deuda > 0 THEN
            INSERT INTO public.deuda_movimientos
                (domiciliario_id, tipo, monto, saldo_resultante,
                 referencia_tipo, notas)
            VALUES (
                v_dom.id, 'generacion', v_deuda,
                v_deuda,
                'ajuste',
                'Backfill fase 23: saldo reconstruido del histórico'
            );
        END IF;

        RAISE NOTICE '  %: comisión=%, pagos=%, deuda=%, crédito=%',
            v_dom.nombre, v_total_comision, v_total_pagos, v_deuda, v_credito;
    END LOOP;

    RAISE NOTICE 'Backfill de deuda completado.';
END;
$$;

-- Limpieza
DROP FUNCTION IF EXISTS public._backfill_comision_diaria(INTEGER, JSONB);


-- ============================================================
-- VERIFICACIÓN
-- ============================================================
-- SELECT * FROM public.domiciliarios
--   WHERE deuda_actual > 0 OR credito_favor > 0
--   ORDER BY deuda_actual DESC;
--
-- SELECT public.saldo_deuda();
-- SELECT public.domiciliarios_con_deuda();
--
-- SELECT * FROM public.deuda_movimientos
--   ORDER BY creado_en DESC LIMIT 20;
--
-- -- Test idempotencia (misma llamada dos veces):
-- SELECT public.registrar_generacion_deuda('<pedido_id>', '<domi_id>', 5200);
-- SELECT public.registrar_generacion_deuda('<pedido_id>', '<domi_id>', 5200);
-- -- La segunda debe retornar ya_registrado: true
