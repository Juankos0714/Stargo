-- ============================================================
-- StarGo · Fix constraints y RLS pendientes (2026-08-25)
-- ============================================================
-- Corrige 3 issues detectados al correr la suite de RLS contra
-- producción:
--
--   1) recargos.valor: falta CHECK >= 0 (la migración base lo
--      declara pero no se aplicó a la BD de producción).
--   2) comision_historico.niveles: la columna tiene NOT NULL y
--      el CHECK de Fase 18 no se aplicó. Se hace nullable + CHECK.
--   3) push_subscriptions: la política RLS permite INSERT a
--      cualquier autenticado; se restringe a admin/domiciliario.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1) recargos.valor >= 0
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'recargos'::regclass
          AND conname = 'recargos_valor_no_negativo'
    ) THEN
        ALTER TABLE public.recargos
            ADD CONSTRAINT recargos_valor_no_negativo
            CHECK (valor >= 0);
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 2) comision_historico.niveles: nullable + CHECK array
-- ────────────────────────────────────────────────────────────

-- 2a) Quitar NOT NULL si existe (la migración base lo puso pero
--     la columna debe ser nullable para backfills y edge cases).
ALTER TABLE public.comision_historico
    ALTER COLUMN niveles DROP NOT NULL;

-- 2b) CHECK constraint: solo array o null.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'comision_historico'::regclass
          AND conname = 'chk_comision_historico_niveles_es_array'
    ) THEN
        ALTER TABLE public.comision_historico
            ADD CONSTRAINT chk_comision_historico_niveles_es_array
            CHECK (niveles IS NULL OR jsonb_typeof(niveles) = 'array');
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 3) push_subscriptions: solo admin o domiciliario puede INSERT
-- ────────────────────────────────────────────────────────────
-- La política actual (push_subs_propias_all) permite INSERT a
-- cualquier autenticado con usuario_id = auth.uid(). Se agrega
-- una política INSERT más restrictiva que exige rol.

DROP POLICY IF EXISTS push_subs_insert_restriccion ON public.push_subscriptions;
CREATE POLICY push_subs_insert_restriccion ON public.push_subscriptions
    FOR INSERT
    WITH CHECK (
        usuario_id = auth.uid()
        AND (
            public.es_admin()
            OR public.es_domiciliario()
        )
    );

-- ============================================================
-- Verificación (ejecutar en SQL Editor):
--
-- -- 1) recargos con valor negativo debe fallar:
-- INSERT INTO public.recargos (codigo, nombre, tipo, valor)
-- VALUES ('rc_test_neg', 'Test neg', 'otro', -1);
--
-- -- 2) comision_historico con niveles = object debe fallar:
-- INSERT INTO public.comision_historico (fecha, niveles)
-- VALUES ('2099-01-01', '{"no":"array"}');
--
-- -- 3) comision_historico con niveles = null debe funcionar:
-- INSERT INTO public.comision_historico (fecha, niveles)
-- VALUES ('2099-01-02', NULL);
--
-- -- 4) push_subscriptions: cliente sin rol no puede INSERT.
-- ============================================================
-- ============================================================
-- StarGo · Fase 21 — Base Necesaria
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase.
-- Requiere las tablas y funciones de Fases 2-20.
--
-- "Base necesaria" es el dinero en efectivo que el domiciliario
-- debe tener disponible para comprar/pagar en el local.
-- Se modela con:
--   1) turnos: turno activo del domiciliario con base declarada.
--   2) base_necesaria en pedidos: monto que el domiciliario
--      necesitará adelantar para ESE pedido.
--   3) base_movimientos: ledger de reservas, liberaciones y
--      liquidaciones (auditable, consistente con Realtime).
--   4) base_disponible_actual en turnos: cache actualizado por
--      trigger, con CHECK >= 0 como safety net.
--
-- Flujo:
--   - Admin asigna → filtra candidatos por base_disponible >= base_necesaria.
--   - Domiciliario acepta → reserva base (resta).
--   - Domiciliario entrega / admin cancela → libera base (suma).
--   - Cerrar turno → solo si no hay pedidos con base reservada.
--
-- Para evitar race conditions (dos pedidos reservando la misma base
-- simultáneamente): SELECT ... FOR UPDATE en el turno dentro del
-- RPC. No se necesita Edge Function.
-- ============================================================

-- ============================================================
-- 1) Tabla turnos
-- ============================================================
CREATE TABLE IF NOT EXISTS public.turnos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domiciliario_id UUID NOT NULL
        CONSTRAINT turnos_domiciliario_fkey REFERENCES public.domiciliarios(id) ON DELETE CASCADE,
    base_declarada INTEGER NOT NULL CHECK (base_declarada >= 0),
    base_disponible_actual INTEGER NOT NULL CHECK (base_disponible_actual >= 0),
    iniciado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finalizado_en TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_turnos_domiciliario ON public.turnos (domiciliario_id, finalizado_en);
CREATE INDEX IF NOT EXISTS idx_turnos_activo ON public.turnos (domiciliario_id) WHERE finalizado_en IS NULL;

-- ============================================================
-- 2) base_necesaria en pedidos
-- ============================================================
ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS base_necesaria INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'pedidos'::regclass
          AND conname = 'chk_pedidos_base_necesaria'
    ) THEN
        ALTER TABLE public.pedidos
            ADD CONSTRAINT chk_pedidos_base_necesaria CHECK (base_necesaria >= 0);
    END IF;
END $$;

-- ============================================================
-- 3) Tabla base_movimientos (ledger)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.base_movimientos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    turno_id UUID NOT NULL
        CONSTRAINT base_mov_turno_fkey REFERENCES public.turnos(id) ON DELETE CASCADE,
    pedido_id UUID
        CONSTRAINT base_mov_pedido_fkey REFERENCES public.pedidos(id) ON DELETE SET NULL,
    monto INTEGER NOT NULL CHECK (monto > 0),
    tipo TEXT NOT NULL CHECK (tipo IN ('reserva', 'liberacion', 'liquidacion')),
    notas TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_base_mov_turno ON public.base_movimientos (turno_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_base_mov_pedido ON public.base_movimientos (pedido_id) WHERE pedido_id IS NOT NULL;

COMMENT ON TABLE public.base_movimientos IS
    'Ledger de movimientos de base de turnos de domiciliarios. '
    'Cada reserva, liberación o liquidación queda registrada para auditoría.';

-- ============================================================
-- 4) Trigger: mantener base_disponible_actual sincronizado
-- ============================================================
-- Después de cada INSERT en base_movimientos, se actualiza el
-- cache en turnos. El CHECK >= 0 en base_disponible_actual actúa
-- como safety net: si una reserva haría la base negativa, falla.
CREATE OR REPLACE FUNCTION public.actualizar_base_disponible()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.tipo = 'reserva' THEN
        UPDATE public.turnos
        SET base_disponible_actual = base_disponible_actual - NEW.monto
        WHERE id = NEW.turno_id;
    ELSIF NEW.tipo IN ('liberacion', 'liquidacion') THEN
        UPDATE public.turnos
        SET base_disponible_actual = base_disponible_actual + NEW.monto
        WHERE id = NEW.turno_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_base_mov_actualizar ON public.base_movimientos;
CREATE TRIGGER trg_base_mov_actualizar
    AFTER INSERT ON public.base_movimientos
    FOR EACH ROW EXECUTE FUNCTION public.actualizar_base_disponible();

-- ============================================================
-- 5) RLS
-- ============================================================
ALTER TABLE public.turnos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.base_movimientos ENABLE ROW LEVEL SECURITY;

-- Turnos:
--   Admin: acceso total.
--   Domiciliario: ve sus propios turnos; puede INSERT (iniciar turno)
--     y UPDATE su turno activo (finalizar).
DROP POLICY IF EXISTS turnos_admin_all ON public.turnos;
CREATE POLICY turnos_admin_all ON public.turnos
    FOR ALL USING (public.es_admin()) WITH CHECK (public.es_admin());

DROP POLICY IF EXISTS turnos_domiciliario_select ON public.turnos;
CREATE POLICY turnos_domiciliario_select ON public.turnos
    FOR SELECT USING (domiciliario_id = public.mi_domiciliario_id());

DROP POLICY IF EXISTS turnos_domiciliario_insert ON public.turnos;
CREATE POLICY turnos_domiciliario_insert ON public.turnos
    FOR INSERT WITH CHECK (domiciliario_id = public.mi_domiciliario_id());

DROP POLICY IF EXISTS turnos_domiciliario_update ON public.turnos;
CREATE POLICY turnos_domiciliario_update ON public.turnos
    FOR UPDATE USING (domiciliario_id = public.mi_domiciliario_id());

-- Base movimientos:
--   Admin: acceso total.
--   Domiciliario: ve los movimientos de sus turnos.
DROP POLICY IF EXISTS base_movimientos_admin_all ON public.base_movimientos;
CREATE POLICY base_movimientos_admin_all ON public.base_movimientos
    FOR ALL USING (public.es_admin()) WITH CHECK (public.es_admin());

DROP POLICY IF EXISTS base_movimientos_domiciliario_select ON public.base_movimientos;
CREATE POLICY base_movimientos_domiciliario_select ON public.base_movimientos
    FOR SELECT USING (
        turno_id IN (
            SELECT id FROM public.turnos
            WHERE domiciliario_id = public.mi_domiciliario_id()
        )
    );

-- ============================================================
-- 6) RPC: iniciar_turno
-- ============================================================
-- Crea un turno activo para el domiciliario. Valida que no tenga
-- ya un turno abierto. La base declarada es el efectivo que el
-- domiciliario tiene AHORA.
CREATE OR REPLACE FUNCTION public.iniciar_turno(
    p_base_declarada INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_dom_id UUID;
    v_turno_id UUID;
    v_existe_activo BOOLEAN;
BEGIN
    v_dom_id := public.mi_domiciliario_id();
    IF v_dom_id IS NULL THEN
        RAISE EXCEPTION 'No eres un domiciliario activo';
    END IF;

    IF p_base_declarada < 0 THEN
        RAISE EXCEPTION 'La base declarada no puede ser negativa';
    END IF;

    -- Verificar que no tenga un turno ya abierto
    SELECT EXISTS(
        SELECT 1 FROM public.turnos
        WHERE domiciliario_id = v_dom_id AND finalizado_en IS NULL
    ) INTO v_existe_activo;

    IF v_existe_activo THEN
        RAISE EXCEPTION 'Ya tienes un turno abierto. Cierra el turno actual antes de abrir uno nuevo.';
    END IF;

    INSERT INTO public.turnos (domiciliario_id, base_declarada, base_disponible_actual)
    VALUES (v_dom_id, p_base_declarada, p_base_declarada)
    RETURNING id INTO v_turno_id;

    RETURN JSONB_BUILD_OBJECT(
        'turno_id', v_turno_id,
        'base_declarada', p_base_declarada,
        'base_disponible_actual', p_base_declarada,
        'iniciado_en', NOW()
    );
END;
$$;

-- ============================================================
-- 7) RPC: finalizar_turno
-- ============================================================
-- Cierra el turno activo del domiciliario. Solo permite cerrar si
-- no hay pedidos con base reservada (pendientes de entrega/liquidación).
CREATE OR REPLACE FUNCTION public.finalizar_turno() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_dom_id UUID;
    v_turno RECORD;
    v_pedidos_pendientes INTEGER;
BEGIN
    v_dom_id := public.mi_domiciliario_id();
    IF v_dom_id IS NULL THEN
        RAISE EXCEPTION 'No eres un domiciliario activo';
    END IF;

    SELECT * INTO v_turno FROM public.turnos
    WHERE domiciliario_id = v_dom_id AND finalizado_en IS NULL
    FOR UPDATE;

    IF v_turno IS NULL THEN
        RAISE EXCEPTION 'No tienes un turno abierto';
    END IF;

    -- Verificar que no haya pedidos con base reservada en este turno
    SELECT COUNT(*) INTO v_pedidos_pendientes
    FROM public.base_movimientos
    WHERE turno_id = v_turno.id AND tipo = 'reserva'
      AND pedido_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.base_movimientos bm2
          WHERE bm2.turno_id = v_turno.id
            AND bm2.pedido_id = base_movimientos.pedido_id
            AND bm2.tipo IN ('liberacion', 'liquidacion')
      );

    IF v_pedidos_pendientes > 0 THEN
        RAISE EXCEPTION 'Tienes % pedido(s) con base reservada. Entrega o cancela todos antes de cerrar el turno.', v_pedidos_pendientes;
    END IF;

    UPDATE public.turnos
    SET finalizado_en = NOW()
    WHERE id = v_turno.id;

    RETURN JSONB_BUILD_OBJECT(
        'turno_id', v_turno.id,
        'base_declarada', v_turno.base_declarada,
        'base_disponible_actual', v_turno.base_disponible_actual,
        'finalizado_en', NOW()
    );
END;
$$;

-- ============================================================
-- 8) RPC: turno_activo (consulta del domiciliario)
-- ============================================================
-- Devuelve el turno activo del domiciliario actual, o null.
CREATE OR REPLACE FUNCTION public.turno_activo()
RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
    SELECT row_to_json(t)::jsonb
    FROM (
        SELECT id, domiciliario_id, base_declarada,
               base_disponible_actual, iniciado_en, finalizado_en
        FROM public.turnos
        WHERE domiciliario_id = public.mi_domiciliario_id()
          AND finalizado_en IS NULL
        LIMIT 1
    ) t;
$$;

-- ============================================================
-- 9) Modificar asignar_domiciliario: validar base_necesaria
-- ============================================================
-- Si el pedido tiene base_necesaria > 0, valida que el domiciliario
-- tenga un turno activo con base_disponible_actual >= base_necesaria.
-- NO reserva la base aquí (se reserva al aceptar).
DROP FUNCTION IF EXISTS public.asignar_domiciliario(UUID, UUID);
CREATE OR REPLACE FUNCTION public.asignar_domiciliario(
    p_pedido_id UUID,
    p_domiciliario_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_pedido public.pedidos%ROWTYPE;
    v_dom public.domiciliarios%ROWTYPE;
    v_turno RECORD;
    v_base_necesaria INTEGER;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede asignar domiciliarios';
    END IF;

    SELECT * INTO v_dom FROM public.domiciliarios WHERE id = p_domiciliario_id;
    IF v_dom.id IS NULL OR NOT v_dom.activo THEN
        RAISE EXCEPTION 'El domiciliario no existe o está inactivo';
    END IF;

    IF v_dom.bloqueado THEN
        RAISE EXCEPTION 'El domiciliario está bloqueado por falta de pago';
    END IF;

    SELECT * INTO v_pedido FROM public.pedidos WHERE id = p_pedido_id;
    IF v_pedido.id IS NULL THEN
        RAISE EXCEPTION 'Pedido no encontrado';
    END IF;
    IF v_pedido.estado NOT IN ('pendiente', 'asignado') THEN
        RAISE EXCEPTION 'Solo se pueden asignar pedidos pendientes (o reasignar uno ya asignado)';
    END IF;

    -- Validación de base si el pedido requiere efectivo
    v_base_necesaria := COALESCE(v_pedido.base_necesaria, 0);
    IF v_base_necesaria > 0 THEN
        SELECT id, base_disponible_actual INTO v_turno
        FROM public.turnos
        WHERE domiciliario_id = p_domiciliario_id AND finalizado_en IS NULL
        LIMIT 1;

        IF v_turno IS NULL THEN
            RAISE EXCEPTION 'El domiciliario no tiene un turno abierto. Debe iniciar turno primero.';
        END IF;

        IF v_turno.base_disponible_actual < v_base_necesaria THEN
            RAISE EXCEPTION 'El domiciliario no tiene base suficiente. Necesita %, tiene % disponible.',
                v_base_necesaria, v_turno.base_disponible_actual;
        END IF;
    END IF;

    -- Si el pedido estaba asignado a OTRO domiciliario, liberar su base reservada
    IF v_pedido.estado = 'asignado' AND v_pedido.domiciliario_id IS NOT NULL
       AND v_pedido.domiciliario_id != p_domiciliario_id
       AND COALESCE(v_pedido.base_necesaria, 0) > 0 THEN
        -- Liberar reserva anterior
        INSERT INTO public.base_movimientos (turno_id, pedido_id, monto, tipo, notas)
        SELECT t.id, p_pedido_id, v_base_necesaria, 'liberacion',
               'Reasignación: liberada base del domiciliario anterior'
        FROM public.turnos t
        WHERE t.domiciliario_id = v_pedido.domiciliario_id
          AND t.finalizado_en IS NULL
        LIMIT 1;
    END IF;

    UPDATE public.pedidos
    SET domiciliario_id = p_domiciliario_id, estado = 'asignado'
    WHERE id = p_pedido_id;

    INSERT INTO public.historial_estados (pedido_id, estado, notas)
    VALUES (p_pedido_id, 'asignado', 'Asignado a ' || v_dom.nombre);

    RETURN JSONB_BUILD_OBJECT(
        'pedido_id', p_pedido_id,
        'domiciliario_id', p_domiciliario_id,
        'estado', 'asignado',
        'base_necesaria', v_base_necesaria
    );
END;
$$;

-- ============================================================
-- 10) Modificar transicionar_pedido: reservar/liberar base
-- ============================================================
-- Al aceptar (asignado→aceptado): reserva la base si base_necesaria > 0.
-- Al entregar (en_camino→entregado): libera la base reservada.
-- Al cancelar: libera la base reservada.
DROP FUNCTION IF EXISTS public.transicionar_pedido(UUID, TEXT, TEXT, TEXT);
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
    v_turno RECORD;
    v_base_necesaria INTEGER;
    v_ya_reservada BOOLEAN;
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

    -- ── Lógica de base ──
    v_base_necesaria := COALESCE(v_pedido.base_necesaria, 0);

    -- Al ACEPTAR (asignado → aceptado): reservar base si aplica
    IF v_pedido.estado = 'asignado' AND p_estado = 'aceptado' AND v_base_necesaria > 0 THEN
        -- Buscar turno activo del domiciliario con FOR UPDATE
        SELECT t.id, t.base_disponible_actual INTO v_turno
        FROM public.turnos t
        WHERE t.domiciliario_id = v_pedido.domiciliario_id
          AND t.finalizado_en IS NULL
        FOR UPDATE;

        IF v_turno IS NULL THEN
            RAISE EXCEPTION 'El domiciliario no tiene un turno activo para reservar base';
        END IF;

        IF v_turno.base_disponible_actual < v_base_necesaria THEN
            RAISE EXCEPTION 'Base insuficiente al aceptar. Disponible: %, necesario: %',
                v_turno.base_disponible_actual, v_base_necesaria;
        END IF;

        -- Verificar que no exista ya una reserva para este pedido en este turno
        SELECT EXISTS(
            SELECT 1 FROM public.base_movimientos
            WHERE turno_id = v_turno.id AND pedido_id = p_pedido_id AND tipo = 'reserva'
        ) INTO v_ya_reservada;

        IF NOT v_ya_reservada THEN
            INSERT INTO public.base_movimientos (turno_id, pedido_id, monto, tipo, notas)
            VALUES (v_turno.id, p_pedido_id, v_base_necesaria, 'reserva',
                    'Reserva de base al aceptar pedido ' || v_pedido.numero);
        END IF;
    END IF;

    -- Al ENTREGAR (en_camino → entregado): liberar base reservada
    IF v_pedido.estado = 'en_camino' AND p_estado = 'entregado' AND v_base_necesaria > 0 THEN
        -- Buscar el turno activo para este pedido
        SELECT t.id INTO v_turno
        FROM public.turnos t
        WHERE t.domiciliario_id = v_pedido.domiciliario_id
          AND t.finalizado_en IS NULL
        LIMIT 1;

        IF v_turno IS NOT NULL THEN
            SELECT EXISTS(
                SELECT 1 FROM public.base_movimientos
                WHERE turno_id = v_turno.id AND pedido_id = p_pedido_id AND tipo = 'reserva'
            ) INTO v_ya_reservada;

            IF v_ya_reservada THEN
                -- Verificar que no se haya liberado ya
                IF NOT EXISTS(
                    SELECT 1 FROM public.base_movimientos
                    WHERE turno_id = v_turno.id AND pedido_id = p_pedido_id
                      AND tipo IN ('liberacion', 'liquidacion')
                ) THEN
                    INSERT INTO public.base_movimientos (turno_id, pedido_id, monto, tipo, notas)
                    VALUES (v_turno.id, p_pedido_id, v_base_necesaria, 'liberacion',
                            'Base liberada al entregar pedido ' || v_pedido.numero);
                END IF;
            END IF;
        END IF;
    END IF;

    -- Al CANCELAR: liberar base reservada si existía
    IF p_estado = 'cancelado' AND v_base_necesaria > 0 THEN
        SELECT t.id INTO v_turno
        FROM public.turnos t
        WHERE t.domiciliario_id = v_pedido.domiciliario_id
          AND t.finalizado_en IS NULL
        LIMIT 1;

        IF v_turno IS NOT NULL THEN
            SELECT EXISTS(
                SELECT 1 FROM public.base_movimientos
                WHERE turno_id = v_turno.id AND pedido_id = p_pedido_id AND tipo = 'reserva'
            ) INTO v_ya_reservada;

            IF v_ya_reservada THEN
                IF NOT EXISTS(
                    SELECT 1 FROM public.base_movimientos
                    WHERE turno_id = v_turno.id AND pedido_id = p_pedido_id
                      AND tipo IN ('liberacion', 'liquidacion')
                ) THEN
                    INSERT INTO public.base_movimientos (turno_id, pedido_id, monto, tipo, notas)
                    VALUES (v_turno.id, p_pedido_id, v_base_necesaria, 'liberacion',
                            'Base liberada al cancelar pedido ' || v_pedido.numero);
                END IF;
            END IF;
        END IF;
    END IF;

    -- Actualizar estado del pedido
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
-- 11) Modificar crear_pedido: aceptar base_necesaria
-- ============================================================
-- El cliente/restaurante puede enviar base_necesaria. Si no se
-- envía, se calcula automáticamente para compra_diligencia (= total)
-- y 0 para domicilio.
DROP FUNCTION IF EXISTS public.crear_pedido(UUID, TEXT, UUID, TEXT, TEXT, TEXT[], TEXT, BOOLEAN, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.crear_pedido(
    p_barrio_origen_id UUID,
    p_direccion_origen TEXT,
    p_barrio_destino_id UUID,
    p_direccion_destino TEXT,
    p_observaciones TEXT DEFAULT NULL,
    p_recargos TEXT[] DEFAULT NULL,
    p_tipo_servicio TEXT DEFAULT 'domicilio',
    p_recargos_confirmados_no_aplica BOOLEAN DEFAULT FALSE,
    p_telefono TEXT DEFAULT NULL,
    p_nombre_cliente TEXT DEFAULT NULL,
    p_base_necesaria INTEGER DEFAULT NULL
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
    v_total INTEGER;
    v_tipo TEXT;
    v_base_necesaria_calc INTEGER := 0;
BEGIN
    v_tipo := COALESCE(NULLIF(TRIM(p_tipo_servicio), ''), 'domicilio');

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
                telefono, nombre_cliente, base_necesaria
            ) VALUES (
                v_numero, p_barrio_origen_id, p_direccion_origen,
                p_barrio_destino_id, p_direccion_destino, p_observaciones,
                v_tarifa, v_zona_origen, v_zona_destino, 'pendiente',
                v_snapshot, v_recargo_total, v_total, v_tipo,
                p_recargos_confirmados_no_aplica,
                NULLIF(TRIM(p_telefono), ''), NULLIF(TRIM(p_nombre_cliente), ''),
                v_base_necesaria_calc
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
        'base_necesaria', v_base_necesaria_calc
    );
END;
$$;

-- ============================================================
-- 12) Consultar pedidos: incluir base_necesaria
-- ============================================================
-- (la vista de pedidos ya devuelve * vía RLS, así que base_necesaria
-- se incluye automáticamente en el SELECT *)

-- ============================================================
-- 13) Función: domiciliarios con base disponible (admin dashboard)
-- ============================================================
-- Devuelve domiciliarios activos con su turno activo y base disponible.
CREATE OR REPLACE FUNCTION public.domiciliarios_con_base()
RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
    SELECT COALESCE(
        JSONB_AGG(
            JSONB_BUILD_OBJECT(
                'domiciliario_id', d.id,
                'nombre', d.nombre,
                'activo', d.activo,
                'bloqueado', d.bloqueado,
                'turno_id', t.id,
                'base_declarada', t.base_declarada,
                'base_disponible_actual', t.base_disponible_actual,
                'turno_activo', (t.finalizado_en IS NULL),
                'iniciado_en', t.iniciado_en
            ) ORDER BY d.nombre
        ), '[]'::jsonb
    )
    FROM public.domiciliarios d
    LEFT JOIN public.turnos t
        ON t.domiciliario_id = d.id AND t.finalizado_en IS NULL
    WHERE d.activo = TRUE;
$$;

-- ============================================================
-- 14) Realtime
-- ============================================================
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.turnos;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.base_movimientos;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;

-- ============================================================
-- 15) Permisos
-- ============================================================
GRANT EXECUTE ON FUNCTION public.iniciar_turno(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalizar_turno() TO authenticated;
GRANT EXECUTE ON FUNCTION public.turno_activo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.domiciliarios_con_base() TO authenticated;

-- Asignar domiciliario y transicionar (ya existen, pero se re-declara por la firma)
GRANT EXECUTE ON FUNCTION public.asignar_domiciliario(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transicionar_pedido(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================
-- Verificación
-- ============================================================
-- 1) Turno del domiciliario:
-- SELECT public.turno_activo();
-- SELECT public.iniciar_turno(50000);
-- SELECT public.turno_activo();
-- SELECT public.finalizar_turno();
--
-- 2) Pedidos con base:
-- SELECT numero, base_necesaria, estado FROM public.pedidos
--   WHERE base_necesaria > 0 ORDER BY created_at DESC LIMIT 10;
--
-- 3) Dashboard admin:
-- SELECT public.domiciliarios_con_base();
--
-- 4) Movimientos:
-- SELECT * FROM public.base_movimientos ORDER BY created_at DESC LIMIT 20;
-- ============================================================
-- StarGo · Fase 21b — Proteger base_necesaria post-asignación
-- ============================================================
-- Bug: sin este trigger, un admin podría reducir base_necesaria
-- de un pedido ya asignado/aceptado, dejando al domiciliario
-- con menos efectivo del que necesita para comprar en el local.
--
-- Regla: base_necesaria solo es editable mientras el pedido está
-- en estado 'pendiente'. Una vez asignado, aceptado, recogido,
-- en_camino o entregado, queda congelado.
-- ============================================================

-- Función del trigger
CREATE OR REPLACE FUNCTION public.protected_base_necesaria()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Si no se está cambiando base_necesaria, no干预
    IF NEW.base_necesaria IS NOT DISTINCT FROM OLD.base_necesaria THEN
        RETURN NEW;
    END IF;

    -- Solo permitir cambios cuando el pedido está pendiente
    IF OLD.estado != 'pendiente' THEN
        RAISE EXCEPTION
            'No se puede modificar base_necesaria de un pedido en estado «%». '
            'Solo editable cuando el pedido está pendiente.',
            OLD.estado;
    END IF;

    RETURN NEW;
END;
$$;

-- Trigger BEFORE UPDATE en pedidos
DROP TRIGGER IF EXISTS trg_protected_base_necesaria ON public.pedidos;
CREATE TRIGGER trg_protected_base_necesaria
    BEFORE UPDATE OF base_necesaria ON public.pedidos
    FOR EACH ROW
    EXECUTE FUNCTION public.protected_base_necesaria();
-- ============================================================
-- Fix: domiciliarios_con_base ORDER BY fuera de aggregate
-- PostgreSQL 15+ requiere que ORDER BY dentro de JSONB_AGG
-- esté dentro del aggregate, no fuera.
-- ============================================================

CREATE OR REPLACE FUNCTION public.domiciliarios_con_base()
RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
    SELECT COALESCE(
        JSONB_AGG(
            JSONB_BUILD_OBJECT(
                'domiciliario_id', d.id,
                'nombre', d.nombre,
                'activo', d.activo,
                'bloqueado', d.bloqueado,
                'turno_id', t.id,
                'base_declarada', t.base_declarada,
                'base_disponible_actual', t.base_disponible_actual,
                'turno_activo', (t.finalizado_en IS NULL),
                'iniciado_en', t.iniciado_en
            ) ORDER BY d.nombre
        ), '[]'::jsonb
    )
    FROM public.domiciliarios d
    LEFT JOIN public.turnos t
        ON t.domiciliario_id = d.id AND t.finalizado_en IS NULL
    WHERE d.activo = TRUE;
$$;
-- ============================================================
-- Hotfix: transicionar_pedido — buscar turno activo en cancelar/entregar
-- Bug: sin finalizado_en IS NULL, podía encontrar turno cerrado
-- y no liberar la base del turno activo.
-- ============================================================

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
    v_turno RECORD;
    v_base_necesaria INTEGER;
    v_ya_reservada BOOLEAN;
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

    IF p_estado = 'cancelado' THEN
        v_motivo_final := COALESCE(NULLIF(TRIM(p_motivo), ''), NULLIF(TRIM(p_nota), ''));
    ELSE
        v_motivo_final := NULLIF(TRIM(p_nota), '');
    END IF;

    v_base_necesaria := COALESCE(v_pedido.base_necesaria, 0);

    -- Al ACEPTAR (asignado → aceptado): reservar base si aplica
    IF v_pedido.estado = 'asignado' AND p_estado = 'aceptado' AND v_base_necesaria > 0 THEN
        SELECT t.id, t.base_disponible_actual INTO v_turno
        FROM public.turnos t
        WHERE t.domiciliario_id = v_pedido.domiciliario_id
          AND t.finalizado_en IS NULL
        FOR UPDATE;

        IF v_turno IS NULL THEN
            RAISE EXCEPTION 'El domiciliario no tiene un turno activo para reservar base';
        END IF;

        IF v_turno.base_disponible_actual < v_base_necesaria THEN
            RAISE EXCEPTION 'Base insuficiente al aceptar. Disponible: %, necesario: %',
                v_turno.base_disponible_actual, v_base_necesaria;
        END IF;

        SELECT EXISTS(
            SELECT 1 FROM public.base_movimientos
            WHERE turno_id = v_turno.id AND pedido_id = p_pedido_id AND tipo = 'reserva'
        ) INTO v_ya_reservada;

        IF NOT v_ya_reservada THEN
            INSERT INTO public.base_movimientos (turno_id, pedido_id, monto, tipo, notas)
            VALUES (v_turno.id, p_pedido_id, v_base_necesaria, 'reserva',
                    'Reserva de base al aceptar pedido ' || v_pedido.numero);
        END IF;
    END IF;

    -- Al ENTREGAR (en_camino → entregado): liberar base reservada
    IF v_pedido.estado = 'en_camino' AND p_estado = 'entregado' AND v_base_necesaria > 0 THEN
        SELECT t.id INTO v_turno
        FROM public.turnos t
        WHERE t.domiciliario_id = v_pedido.domiciliario_id
          AND t.finalizado_en IS NULL
        LIMIT 1;

        IF v_turno IS NOT NULL THEN
            SELECT EXISTS(
                SELECT 1 FROM public.base_movimientos
                WHERE turno_id = v_turno.id AND pedido_id = p_pedido_id AND tipo = 'reserva'
            ) INTO v_ya_reservada;

            IF v_ya_reservada THEN
                IF NOT EXISTS(
                    SELECT 1 FROM public.base_movimientos
                    WHERE turno_id = v_turno.id AND pedido_id = p_pedido_id
                      AND tipo IN ('liberacion', 'liquidacion')
                ) THEN
                    INSERT INTO public.base_movimientos (turno_id, pedido_id, monto, tipo, notas)
                    VALUES (v_turno.id, p_pedido_id, v_base_necesaria, 'liberacion',
                            'Base liberada al entregar pedido ' || v_pedido.numero);
                END IF;
            END IF;
        END IF;
    END IF;

    -- Al CANCELAR: liberar base reservada si existía
    IF p_estado = 'cancelado' AND v_base_necesaria > 0 THEN
        SELECT t.id INTO v_turno
        FROM public.turnos t
        WHERE t.domiciliario_id = v_pedido.domiciliario_id
          AND t.finalizado_en IS NULL
        LIMIT 1;

        IF v_turno IS NOT NULL THEN
            SELECT EXISTS(
                SELECT 1 FROM public.base_movimientos
                WHERE turno_id = v_turno.id AND pedido_id = p_pedido_id AND tipo = 'reserva'
            ) INTO v_ya_reservada;

            IF v_ya_reservada THEN
                IF NOT EXISTS(
                    SELECT 1 FROM public.base_movimientos
                    WHERE turno_id = v_turno.id AND pedido_id = p_pedido_id
                      AND tipo IN ('liberacion', 'liquidacion')
                ) THEN
                    INSERT INTO public.base_movimientos (turno_id, pedido_id, monto, tipo, notas)
                    VALUES (v_turno.id, p_pedido_id, v_base_necesaria, 'liberacion',
                            'Base liberada al cancelar pedido ' || v_pedido.numero);
                END IF;
            END IF;
        END IF;
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
-- StarGo · Fase 22 — Valor Mandado (dato estructurado)
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase.
-- Requiere las Fases 2-21.
--
-- Cambios:
--   1) pedidos.valor_mandado: INTEGER nullable. Almacena el valor
--      de la factura / mandado a pagar (tipos pago y banco) como
--      dato estructurado, no solo como texto en observaciones.
--      DEFAULT NULL para no romper pedidos ya creados.
--
--   2) crear_pedido: se re-emite con p_valor_mandado (DEFAULT NULL).
--      Se almacena en la columna y se retorna en la respuesta.
-- ============================================================

-- 1) Columna nueva
ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS valor_mandado INTEGER;

-- CHECK >= 0 (solo cuando no es NULL)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'pedidos'::regclass
          AND conname = 'chk_pedidos_valor_mandado'
    ) THEN
        ALTER TABLE public.pedidos
            ADD CONSTRAINT chk_pedidos_valor_mandado CHECK (valor_mandado IS NULL OR valor_mandado >= 0);
    END IF;
END $$;

COMMENT ON COLUMN public.pedidos.valor_mandado IS
    'Valor de la factura / mandado a pagar (solo tipos pago y banco). '
    'Dato estructurado del cliente, NO es ingreso de StarGo.';

-- 2) Modificar crear_pedido: aceptar p_valor_mandado
DROP FUNCTION IF EXISTS public.crear_pedido(UUID, TEXT, UUID, TEXT, TEXT, TEXT[], TEXT, BOOLEAN, TEXT, TEXT, INTEGER);
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

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT public.crear_pedido(
--     p_barrio_destino_id => '<uuid>',
--     p_direccion_destino => 'Banco X, Calle 10',
--     p_tipo_servicio => 'compra_diligencia',
--     p_recargos_confirmados_no_aplica => TRUE,
--     p_valor_mandado => 85000
-- );  -- debe retornar valor_mandado: 85000
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
