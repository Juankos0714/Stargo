-- ============================================================
-- StarGo · Fase 23 (backfill) — Reconstruir deuda_actual
-- ============================================================
-- Requiere la Fase 23 (deuda_movimientos, deuda_actual, credito_favor).
--
-- PROBLEMA QUE RESUELVE:
--   Las columnas deuda_actual y credito_favor se crearon con DEFAULT 0.
--   Este backfill las pobló con el saldo real calculado a partir del
--   histórico completo de comisiones generadas y abonos registrados.
--
-- ALGORITMO:
--   Para cada domiciliario:
--     1. Agrupar pedidos entregados por día (hora Bogotá)
--     2. Para cada día, buscar la escalera congelada (comision_historico)
--        o usar la vigente
--     3. Calcular comision_diaria = Σ valores de niveles 1..nivel_alcanzado
--     4. Sumar todas las comisiones diarias = total_comision
--     5. Sumar todos los abonos = total_pagos
--     6. deuda_actual = MAX(0, total_comision - total_pagos)
--     7. credito_favor = MAX(0, total_pagos - total_comision)
--     8. Insertar un movimiento de tipo 'ajuste' inicial en el ledger
--
-- NOTA: Este backfill es idempotente: solo ejecuta si deuda_actual = 0
--       (las filas de deuda_movimientos no existen aún).
-- ============================================================

-- Función auxiliar: comisión diaria en SQL (replica comisionDiaria de TS)
-- Dado un total acumulado del día y una escalera, devuelve la comisión.
CREATE OR REPLACE FUNCTION public._backfill_comision_diaria(
    p_total_dia INTEGER,
    p_niveles JSONB
) RETURNS INTEGER
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_nivel_alcanzado INTEGER;
    v_valor_total INTEGER;
    v_nivel JSONB;
BEGIN
    IF p_total_dia IS NULL OR p_total_dia <= 0 OR p_niveles IS NULL THEN
        RETURN 0;
    END IF;

    -- Encontrar el nivel alcanzado: primer nivel cuyo 'hasta' >= total_dia
    SELECT (elem ->> 'nivel')::INTEGER INTO v_nivel_alcanzado
    FROM jsonb_array_elements(p_niveles) AS elem
    WHERE (elem ->> 'hasta')::INTEGER >= p_total_dia
    ORDER BY (elem ->> 'nivel')::INTEGER ASC
    LIMIT 1;

    -- Si no se encontró, usar el último nivel
    IF v_nivel_alcanzado IS NULL THEN
        SELECT (elem ->> 'nivel')::INTEGER INTO v_nivel_alcanzado
        FROM jsonb_array_elements(p_niveles) AS elem
        ORDER BY (elem ->> 'nivel')::INTEGER DESC
        LIMIT 1;
    END IF;

    IF v_nivel_alcanzado IS NULL THEN
        RETURN 0;
    END IF;

    -- Sumar valores de todos los niveles hasta el alcanzado
    SELECT COALESCE(SUM((elem ->> 'valor')::INTEGER), 0)
    INTO v_valor_total
    FROM jsonb_array_elements(p_niveles) AS elem
    WHERE (elem ->> 'nivel')::INTEGER <= v_nivel_alcanzado;

    RETURN v_valor_total;
END;
$$;

-- Backfill principal
DO $$
DECLARE
    v_dom RECORD;
    v_pedido RECORD;
    v_fecha TEXT;
    v_totales_dia JSONB;  -- { "YYYY-MM-DD": total }
    v_par RECORD;
    v_niveles JSONB;
    v_total_comision INTEGER;
    v_total_pagos INTEGER;
    v_deuda INTEGER;
    v_credito INTEGER;
    v_backfill_count INTEGER := 0;
BEGIN
    -- Solo ejecutar si no se ha hecho el backfill
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
        -- 1) Agrupar pedidos entregados por día (hora Bogotá)
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

            -- Calcular total del pedido
            DECLARE
                v_total_pedido INTEGER;
            BEGIN
                IF v_pedido.total IS NOT NULL AND v_pedido.total > 0 THEN
                    v_total_pedido := v_pedido.total;
                ELSE
                    v_total_pedido := COALESCE(v_pedido.tarifa_base, 0)
                                    + COALESCE(v_pedido.recargo_total, 0);
                END IF;

                -- Acumular en el día
                v_totales_dia := v_totales_dia || jsonb_build_object(
                    v_fecha,
                    COALESCE((v_totales_dia ->> v_fecha)::INTEGER, 0) + v_total_pedido
                );
            END;
        END LOOP;

        -- 2) Calcular comisión total sumando comisiones diarias
        v_total_comision := 0;

        FOR v_par IN
            SELECT (kv.key) AS fecha, (kv.value)::INTEGER AS total_dia
            FROM jsonb_each(v_totales_dia) AS kv
        LOOP
            -- Buscar escalera congelada para esta fecha
            SELECT niveles INTO v_niveles
            FROM public.comision_historico
            WHERE fecha = v_par.fecha::date;

            -- Si no está congelada, usar la escalera actual
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

        -- 3) Sumar abonos
        SELECT COALESCE(SUM(valor), 0) INTO v_total_pagos
        FROM public.pagos_domiciliarios
        WHERE domiciliario_id = v_dom.id;

        -- 4) Calcular deuda y crédito
        v_deuda := GREATEST(0, v_total_comision - v_total_pagos);
        v_credito := GREATEST(0, v_total_pagos - v_total_comision);

        -- 5) Actualizar domiciliario
        UPDATE public.domiciliarios
        SET deuda_actual = v_deuda,
            credito_favor = v_credito
        WHERE id = v_dom.id;

        -- 6) Registrar movimiento de ajuste inicial en el ledger
        IF v_deuda > 0 OR v_credito > 0 THEN
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

-- ============================================================
-- Limpieza: eliminar función auxiliar del backfill
-- ============================================================
DROP FUNCTION IF EXISTS public._backfill_comision_diaria(INTEGER, JSONB);

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT id, nombre, deuda_actual, credito_favor
--   FROM public.domiciliarios
--   WHERE deuda_actual > 0 OR credito_favor > 0
--   ORDER BY deuda_actual DESC;
--
-- SELECT domiciliario_id, tipo, monto, saldo_resultante, notas
--   FROM public.deuda_movimientos
--   WHERE tipo = 'ajuste'
--   ORDER BY creado_en DESC;
