-- ============================================================
-- StarGo · Fase 23 — Ledger de deuda (patrón base_movimientos)
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase (POSTGRES).
-- Requiere las Fases 2-21 (domiciliarios, pedidos, comision_niveles,
-- comision_historico, pagos_domiciliarios, base_movimientos, etc.).
--
-- PROBLEMA QUE RESUELVE:
--   La deuda del domiciliario NO se almacenaba como saldo persistente.
--   Se recalculaba desde cero en cada petición TypeScript (cuenta.ts)
--   sumando todas las comisiones diarias y restando todos los abonos.
--   Esto causaba:
--     * "Reseteo" cuando cambiaba la escalera sin congelar el día
--     * Race conditions (dos requests calculando simultáneamente)
--     * Límite de 10.000 pedidos en la paginación
--     * Recálculo pesado en cada carga del panel
--
-- SOLUCIÓN (mismo patrón que base_movimientos de la Fase 21):
--   1) deuda_movimientos: ledger con tipos 'generacion' y 'abono'
--   2) domiciliarios.deuda_actual + credito_favor: saldos persistentes
--   3) Trigger que mantiene deuda_actual sincronizado
--   4) RPCs transaccionales con SELECT FOR UPDATE
--   5) RLS que solo permite escritura vía RPCs
--
-- REGLA DE NEGOCIO PARA CRÉDITO A FAVOR:
--   Cuando un abono excede la deuda, el excedente se guarda como
--   credito_favor. Al generar deuda nueva, primero se descuenta del
--   crédito existente antes de incrementar deuda_actual.
-- ============================================================

-- ============================================================
-- 1) Columnas nuevas en domiciliarios
-- ============================================================
ALTER TABLE public.domiciliarios
    ADD COLUMN IF NOT EXISTS deuda_actual INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS credito_favor INTEGER NOT NULL DEFAULT 0;

-- Safety nets
DO $$ BEGIN
    ALTER TABLE public.domiciliarios
        ADD CONSTRAINT chk_domiciliarios_deuda_actual CHECK (deuda_actual >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE public.domiciliarios
        ADD CONSTRAINT chk_domiciliarios_credito_favor CHECK (credito_favor >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2) Tabla deuda_movimientos (ledger)
-- ============================================================
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

CREATE INDEX IF NOT EXISTS idx_deuda_mov_dom
    ON public.deuda_movimientos (domiciliario_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_deuda_mov_referencia
    ON public.deuda_movimientos (referencia_tipo, referencia_id)
    WHERE referencia_tipo IS NOT NULL AND referencia_id IS NOT NULL;

COMMENT ON TABLE public.deuda_movimientos IS
    'Ledger de deuda de domiciliarios. Cada generación de comisión o '
    'abono queda registrado con saldo resultante para auditoría.';

-- ============================================================
-- 3) Trigger: mantener deuda_actual sincronizado
-- ============================================================
-- Después de cada INSERT en deuda_movimientos, se actualiza el
-- cache en domiciliarios. Los CHECK >= 0 actúan como safety net.
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

-- ============================================================
-- 4) RPC: registrar_generacion_deuda
-- ============================================================
-- Llamada desde la app cuando un pedido se entrega. Aplica el crédito
-- a favor existente ANTES de incrementar la deuda.
--
-- Flujo:
--   1) SELECT FOR UPDATE sobre el domiciliario (previene race conditions)
--   2) Si credito_favor > 0: reducir la deuda generada por el crédito
--   3) Incrementar deuda_actual con el monto efectivo
--   4) INSERT en deuda_movimientos (trigger actualiza el cache)
--   5) Actualizar credito_favor en domiciliarios
--
-- Parámetros:
--   p_pedido_id:      pedido que generó la deuda
--   p_domiciliario_id: domiciliario que debe
--   p_monto:           comisión generada (>= 0)
--
-- Retorna: nuevo saldo, crédito restante, monto efectivo aplicado
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
            'credito_aplicado', 0, 'deuda_actual', 0, 'credito_favor', 0
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

    -- Actualizar credito_favor
    UPDATE public.domiciliarios
    SET credito_favor = credito_favor - credito_aplicado
    WHERE id = p_domiciliario_id;

    IF monto_efectivo > 0 THEN
        -- Insertar en el ledger (trigger actualiza deuda_actual)
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
        -- Todo cubierto por crédito, no hay deuda nueva
        nuevo_saldo := v_dom.deuda_actual;
    END IF;

    RETURN JSONB_BUILD_OBJECT(
        'monto', p_monto,
        'monto_efectivo', monto_efectivo,
        'credito_aplicado', credito_aplicado,
        'deuda_actual', nuevo_saldo,
        'credito_favor', v_dom.credito_favor - credito_aplicado
    );
END;
$$;

-- ============================================================
-- 5) RPC: registrar_abono_deuda
-- ============================================================
-- Registra un abono del domiciliario contra su deuda. Si el abono
-- excede la deuda, el excedente se guarda como crédito a favor.
-- También inserta en pagos_domiciliarios para compatibilidad.
--
-- Flujo:
--   1) SELECT FOR UPDATE sobre el domiciliario
--   2) Si deuda = 0: todo va a credito_favor
--   3) Si abono <= deuda: deuda_actual -= abono
--   4) Si abono > deuda: credito += excedente; deuda = 0
--   5) INSERT en deuda_movimientos + pagos_domiciliarios
--
-- Parámetros:
--   p_domiciliario_id: domiciliario que paga
--   p_valor:           monto del abono (> 0)
--   p_nota:            nota opcional
--   p_registrado_por:  uid del admin que registra
--
-- Retorna: nuevo saldo, crédito, id del pago
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
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede registrar abonos';
    END IF;

    IF p_valor <= 0 THEN
        RAISE EXCEPTION 'El abono debe ser mayor que cero';
    END IF;

    -- FOR UPDATE para serializar acceso al saldo
    SELECT id, deuda_actual, credito_favor INTO v_dom
    FROM public.domiciliarios
    WHERE id = p_domiciliario_id
    FOR UPDATE;

    IF v_dom IS NULL THEN
        RAISE EXCEPTION 'Domiciliario no encontrado';
    END IF;

    -- Calcular cuánto se aplica a la deuda
    deuda_restante := v_dom.deuda_actual;

    IF p_valor <= deuda_restante THEN
        -- Abono cubierto por la deuda
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
        -- Abono excede la deuda
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

        -- Guardar excedente como crédito a favor
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
      AND id = (
          SELECT id FROM public.deuda_movimientos
          WHERE domiciliario_id = p_domiciliario_id AND tipo = 'abono'
          ORDER BY creado_en DESC LIMIT 1
      );

    RETURN JSONB_BUILD_OBJECT(
        'pago_id', v_pago_id,
        'valor', p_valor,
        'deuda_actual', GREATEST(0, deuda_restante - p_valor),
        'credito_favor', v_dom.credito_favor + excedente,
        'excedente', excedente
    );
END;
$$;

-- ============================================================
-- 6) RPC: saldo_deuda (consulta del domiciliario / admin)
-- ============================================================
-- Devuelve el saldo actual sin necesidad de recalcular todo.
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

-- ============================================================
-- 7) RLS
-- ============================================================
ALTER TABLE public.deuda_movimientos ENABLE ROW LEVEL SECURITY;

-- Admin: acceso total
DROP POLICY IF EXISTS deuda_movimientos_admin_all ON public.deuda_movimientos;
CREATE POLICY deuda_movimientos_admin_all ON public.deuda_movimientos
    FOR ALL USING (public.es_admin()) WITH CHECK (public.es_admin());

-- Domiciliario: solo ve sus movimientos
DROP POLICY IF EXISTS deuda_movimientos_domiciliario_select ON public.deuda_movimientos;
CREATE POLICY deuda_movimientos_domiciliario_select ON public.deuda_movimientos
    FOR SELECT USING (domiciliario_id = public.mi_domiciliario_id());

-- ============================================================
-- 8) Permisos
-- ============================================================
GRANT SELECT ON public.deuda_movimientos TO authenticated;
REVOKE ALL ON public.deuda_movimientos FROM anon;

GRANT EXECUTE ON FUNCTION public.registrar_generacion_deuda(UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_abono_deuda(UUID, INTEGER, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.saldo_deuda(UUID) TO authenticated;

-- ============================================================
-- 9) Realtime
-- ============================================================
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.deuda_movimientos;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;

ALTER TABLE public.deuda_movimientos REPLICA IDENTITY FULL;

-- ============================================================
-- 10) Función: domiciliarios con deuda (panel admin)
-- ============================================================
-- Devuelve domiciliarios activos con su deuda y crédito.
-- Reemplaza la consulta pesada de cuenta.ts.
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

GRANT EXECUTE ON FUNCTION public.domiciliarios_con_deuda() TO authenticated;

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT * FROM public.domiciliarios WHERE deuda_actual > 0 OR credito_favor > 0;
-- SELECT public.registrar_generacion_deuda('<pedido_id>', '<domi_id>', 5200);
-- SELECT public.registrar_abono_deuda('<domi_id>', 3000, 'Abono parcial');
-- SELECT public.saldo_deuda();
-- SELECT public.domiciliarios_con_deuda();
-- SELECT * FROM public.deuda_movimientos ORDER BY creado_en DESC LIMIT 10;
