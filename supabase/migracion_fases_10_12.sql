-- ============================================================
-- StarGo · Migración combinada Fases 10 + 11 + 12
-- Ejecutar COMPLETO (en orden) en el SQL Editor del Dashboard de
-- Supabase del proyecto uwfjfkcytohrjnyspkkt (POSTGRES).
-- Es idempotente: puede volverse a ejecutar sin romper nada.
-- Origen: supabase/migrations/20260807000000_fase10_comisiones_bloqueo.sql
--         supabase/migrations/20260808000000_fase11_comision_niveles.sql
--         supabase/migrations/20260809000000_fase12_comision_escalera_configurable.sql
-- ============================================================

-- ============================================================
-- StarGo · Fase 10 — Comisiones, abonos y bloqueo por deuda
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase (POSTGRES).
-- Requiere las Fases 2-9 (domiciliarios, transicionar_pedido,
-- asignar_domiciliario, es_admin, mi_domiciliario_id).
--
-- Resumen:
--  * domiciliarios.comision  → precio fijo (COP) que paga el domiciliario
--    a la app por cada pedido entregado. Configurable por el admin por cada
--    domiciliario; cada cambio queda auditado en historial_comisiones.
--  * domiciliarios.bloqueado → bloqueo por falta de pago: el admin no puede
--    asignarle pedidos nuevos (solo el admin lo desbloquea).
--  * pedidos.comision        → snapshot de la comisión al momento de
--    ENTREGAR el pedido (si el admin cambia la comisión después, la deuda
--    de los pedidos ya entregados no cambia).
--  * pagos_domiciliarios     → abonos que el admin registra contra la deuda.
--    Deuda = Σ pedidos entregados.comision − Σ pagos.
-- ============================================================

-- ============================================================
-- 1) domiciliarios: comision + bloqueado
-- ============================================================
ALTER TABLE public.domiciliarios
    ADD COLUMN IF NOT EXISTS comision INTEGER NOT NULL DEFAULT 0
        CHECK (comision >= 0),
    ADD COLUMN IF NOT EXISTS bloqueado BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- 2) pedidos: snapshot de comisión al entregar
-- ============================================================
ALTER TABLE public.pedidos
    ADD COLUMN IF NOT EXISTS comision INTEGER NOT NULL DEFAULT 0
        CHECK (comision >= 0);

-- ============================================================
-- 3) historial_comisiones (auditoría de cambios por domiciliario)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.historial_comisiones (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    domiciliario_id UUID NOT NULL
        CONSTRAINT hist_comisiones_dom_fkey
        REFERENCES public.domiciliarios(id) ON DELETE CASCADE,
    comision_anterior INTEGER NOT NULL,
    comision_nueva INTEGER NOT NULL,
    cambiado_por UUID REFERENCES auth.users(id),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hist_comisiones_dom
    ON public.historial_comisiones (domiciliario_id, creado_en DESC);

ALTER TABLE public.historial_comisiones ENABLE ROW LEVEL SECURITY;

-- Admin lee todo; el domiciliario solo su propio historial.
DROP POLICY IF EXISTS hist_comisiones_select ON public.historial_comisiones;
CREATE POLICY hist_comisiones_select ON public.historial_comisiones
    FOR SELECT USING (
        public.es_admin() OR domiciliario_id = public.mi_domiciliario_id()
    );

-- ============================================================
-- 4) pagos_domiciliarios (abonos registrados por el admin)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pagos_domiciliarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domiciliario_id UUID NOT NULL
        CONSTRAINT pagos_dom_fkey
        REFERENCES public.domiciliarios(id) ON DELETE CASCADE,
    valor INTEGER NOT NULL CHECK (valor > 0),
    nota TEXT,
    registrado_por UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pagos_dom
    ON public.pagos_domiciliarios (domiciliario_id, created_at DESC);

ALTER TABLE public.pagos_domiciliarios ENABLE ROW LEVEL SECURITY;

-- Admin lee todo; el domiciliario solo sus propios abonos.
DROP POLICY IF EXISTS pagos_dom_select ON public.pagos_domiciliarios;
CREATE POLICY pagos_dom_select ON public.pagos_domiciliarios
    FOR SELECT USING (
        public.es_admin() OR domiciliario_id = public.mi_domiciliario_id()
    );

-- ============================================================
-- 5) asignar_domiciliario: rechazar domiciliarios bloqueados
-- ============================================================
CREATE OR REPLACE FUNCTION public.asignar_domiciliario(
    p_pedido_id UUID,
    p_domiciliario_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_pedido public.pedidos%ROWTYPE;
    v_dom public.domiciliarios%ROWTYPE;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede asignar domiciliarios';
    END IF;

    SELECT * INTO v_dom FROM public.domiciliarios WHERE id = p_domiciliario_id;
    -- Mensaje combinado histórico (la suite RLS lo verifica): si no existe o
    -- está inactivo, no se distingue el motivo.
    IF v_dom.id IS NULL OR NOT v_dom.activo THEN
        RAISE EXCEPTION 'El domiciliario no existe o está inactivo';
    END IF;
    IF v_dom.bloqueado THEN
        RAISE EXCEPTION 'El domiciliario está bloqueado por falta de pago. Regístralo al día antes de asignarle pedidos';
    END IF;

    SELECT * INTO v_pedido FROM public.pedidos WHERE id = p_pedido_id;
    IF v_pedido.id IS NULL THEN
        RAISE EXCEPTION 'Pedido no encontrado';
    END IF;
    IF v_pedido.estado NOT IN ('pendiente', 'asignado') THEN
        RAISE EXCEPTION 'Solo se pueden asignar pedidos pendientes (o reasignar uno ya asignado)';
    END IF;

    UPDATE public.pedidos
    SET domiciliario_id = p_domiciliario_id, estado = 'asignado'
    WHERE id = p_pedido_id;

    INSERT INTO public.historial_estados (pedido_id, estado, notas)
    VALUES (p_pedido_id, 'asignado', 'Asignado a ' || v_dom.nombre);

    RETURN JSONB_BUILD_OBJECT(
        'pedido_id', p_pedido_id,
        'domiciliario_id', p_domiciliario_id,
        'estado', 'asignado'
    );
END;
$$;

-- ============================================================
-- 6) transicionar_pedido: snapshot de comisión al entregar
-- ============================================================
-- Al pasar a 'entregado' se congela la comisión vigente del domiciliario
-- (la de ese momento), para que la deuda quede calculada aunque después
-- el admin cambie el valor.
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
    v_comision INTEGER;
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

    -- Comisión vigente del domiciliario al entregar (0 si no tiene o no hay domi).
    v_comision := 0;
    IF p_estado = 'entregado' AND v_pedido.domiciliario_id IS NOT NULL THEN
        SELECT d.comision INTO v_comision
        FROM public.domiciliarios d
        WHERE d.id = v_pedido.domiciliario_id;
        v_comision := COALESCE(v_comision, 0);
    END IF;

    UPDATE public.pedidos
    SET estado = p_estado,
        motivo_cancelacion = CASE WHEN p_estado = 'cancelado' THEN v_motivo_final ELSE motivo_cancelacion END,
        comision = CASE WHEN p_estado = 'entregado' THEN v_comision ELSE comision END
    WHERE id = p_pedido_id;

    INSERT INTO public.historial_estados (pedido_id, estado, notas)
    VALUES (p_pedido_id, p_estado, v_motivo_final);

    RETURN JSONB_BUILD_OBJECT('pedido_id', p_pedido_id, 'estado', p_estado);
END;
$$;

-- ============================================================
-- 7) RPCs admin: comisión, abonos y bloqueo
-- ============================================================
-- 7a) actualizar_comision_domiciliario: cambia el valor y audita el cambio.
CREATE OR REPLACE FUNCTION public.actualizar_comision_domiciliario(
    p_domiciliario_id UUID,
    p_comision INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_anterior INTEGER;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede cambiar comisiones';
    END IF;
    IF p_comision < 0 THEN
        RAISE EXCEPTION 'La comisión no puede ser negativa';
    END IF;

    SELECT comision INTO v_anterior
    FROM public.domiciliarios WHERE id = p_domiciliario_id;
    IF v_anterior IS NULL THEN
        RAISE EXCEPTION 'Domiciliario no encontrado';
    END IF;

    IF v_anterior = p_comision THEN
        RETURN JSONB_BUILD_OBJECT(
            'domiciliario_id', p_domiciliario_id,
            'comision', p_comision,
            'cambiado', false
        );
    END IF;

    UPDATE public.domiciliarios
    SET comision = p_comision
    WHERE id = p_domiciliario_id;

    INSERT INTO public.historial_comisiones
        (domiciliario_id, comision_anterior, comision_nueva, cambiado_por)
    VALUES (p_domiciliario_id, v_anterior, p_comision, auth.uid());

    RETURN JSONB_BUILD_OBJECT(
        'domiciliario_id', p_domiciliario_id,
        'comision', p_comision,
        'comision_anterior', v_anterior,
        'cambiado', true
    );
END;
$$;

-- 7b) registrar_pago_domiciliario: registra un abono contra la deuda.
CREATE OR REPLACE FUNCTION public.registrar_pago_domiciliario(
    p_domiciliario_id UUID,
    p_valor INTEGER,
    p_nota TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_existe BOOLEAN;
    v_pago public.pagos_domiciliarios%ROWTYPE;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede registrar abonos';
    END IF;
    IF p_valor <= 0 THEN
        RAISE EXCEPTION 'El abono debe ser mayor que cero';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.domiciliarios WHERE id = p_domiciliario_id
    ) INTO v_existe;
    IF NOT v_existe THEN
        RAISE EXCEPTION 'Domiciliario no encontrado';
    END IF;

    INSERT INTO public.pagos_domiciliarios
        (domiciliario_id, valor, nota, registrado_por)
    VALUES (p_domiciliario_id, p_valor, NULLIF(TRIM(p_nota), ''), auth.uid())
    RETURNING * INTO v_pago;

    RETURN JSONB_BUILD_OBJECT(
        'id', v_pago.id,
        'domiciliario_id', v_pago.domiciliario_id,
        'valor', v_pago.valor,
        'nota', v_pago.nota,
        'created_at', v_pago.created_at
    );
END;
$$;

-- 7c) bloquear_domiciliario: bloquea/desbloquea por deuda (solo admin).
CREATE OR REPLACE FUNCTION public.bloquear_domiciliario(
    p_domiciliario_id UUID,
    p_bloqueado BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_existe BOOLEAN;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede bloquear domiciliarios';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.domiciliarios WHERE id = p_domiciliario_id
    ) INTO v_existe;
    IF NOT v_existe THEN
        RAISE EXCEPTION 'Domiciliario no encontrado';
    END IF;

    UPDATE public.domiciliarios
    SET bloqueado = p_bloqueado
    WHERE id = p_domiciliario_id;

    RETURN JSONB_BUILD_OBJECT(
        'domiciliario_id', p_domiciliario_id,
        'bloqueado', p_bloqueado
    );
END;
$$;

-- ============================================================
-- 8) Realtime: pagos e historial para refresco en vivo
-- ============================================================
-- El panel admin ya escucha 'domiciliarios' (los cambios de comisión/bloqueo
-- emiten UPDATE); se publica también pagos_domiciliarios para que los abonos
-- se reflejen sin recargar.
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.pagos_domiciliarios;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.historial_comisiones;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;

ALTER TABLE public.pagos_domiciliarios REPLICA IDENTITY FULL;
ALTER TABLE public.historial_comisiones REPLICA IDENTITY FULL;

-- ============================================================
-- 9) Permisos
-- ============================================================
-- Tablas nuevas privadas: solo SELECT autenticado (RLS filtra por rol);
-- las escrituras pasan por los RPCs SECURITY DEFINER de la sección 7.
GRANT SELECT ON public.pagos_domiciliarios, public.historial_comisiones
    TO authenticated;

GRANT EXECUTE ON FUNCTION public.actualizar_comision_domiciliario(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_pago_domiciliario(UUID, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bloquear_domiciliario(UUID, BOOLEAN) TO authenticated;

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT id, nombre, comision, bloqueado FROM public.domiciliarios ORDER BY nombre;
-- SELECT public.actualizar_comision_domiciliario('<domi>', 2000);
-- SELECT public.registrar_pago_domiciliario('<domi>', 2000, 'Abono en efectivo');
-- SELECT domiciliario_id, SUM(valor) FROM public.pagos_domiciliarios GROUP BY domiciliario_id;
-- SELECT numero, estado, comision FROM public.pedidos WHERE estado = 'entregado' ORDER BY created_at DESC LIMIT 10;

-- ============================================================
-- FIN FASE 10 · INICIO FASE 11
-- ============================================================

-- ============================================================
-- StarGo · Fase 11 — Comisión por niveles según el valor del pedido
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase (POSTGRES).
-- Requiere las Fases 2-10 (domiciliarios, transicionar_pedido,
-- es_admin, es_domiciliario, pagos_domiciliarios, bloqueo).
--
-- Cambio de modelo: la comisión que paga el domiciliario a la app ya NO
-- es un precio fijo por domiciliario (Fase 10), sino un valor por NIVEL
-- según el valor del pedido entregado (total = tarifa base + recargos):
--
--   Nivel 1 → pedidos hasta $10.000
--   Nivel 2 → pedidos hasta $20.000
--   Nivel 3 → pedidos hasta $30.000
--   ... y así sucesivamente, cada nivel abarca 10.000 más.
--
--   * El valor de cada nivel es configurable desde el panel admin (los 10
--     niveles iniciales nacen en $1.300).
--   * El admin puede agregar/quitar niveles libremente (un nivel agregado
--     continúa la escalera de 10.000 en 10.000).
--   * Al ENTREGAR un pedido se congela el valor del nivel que le
--     corresponde (pedidos.comision) → cambiar un nivel después no altera
--     la deuda ya generada.
--   * Lo que existía de la Fase 10 (domiciliarios.comision,
--     historial_comisiones, actualizar_comision_domiciliario) queda
--     obsoleto para la app; NO se destruye nada para no romper datos.
-- ============================================================

-- ============================================================
-- 1) comision_niveles
-- ============================================================
CREATE TABLE IF NOT EXISTS public.comision_niveles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nivel INTEGER NOT NULL UNIQUE CHECK (nivel > 0),
    -- Tope superior del rango (inclusive): nivel 1 cubre 0..hasta.
    hasta INTEGER NOT NULL CHECK (hasta > 0),
    -- Comisión (COP) que paga el domiciliario por un pedido en este rango.
    valor INTEGER NOT NULL DEFAULT 0 CHECK (valor >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comision_niveles_orden ON public.comision_niveles (nivel);

-- Seed inicial: 10 niveles (hasta $100.000), todos con la comisión vigente
-- ($1.300). El admin los ajusta desde el panel.
INSERT INTO public.comision_niveles (nivel, hasta, valor)
SELECT g.n, g.n * 10000, 1300
FROM generate_series(1, 10) AS g(n)
ON CONFLICT (nivel) DO NOTHING;

ALTER TABLE public.comision_niveles ENABLE ROW LEVEL SECURITY;

-- Lectura: admin y domiciliarios (para saber cuánto pagarán). El cliente
-- (authenticated sin rol) no ve la tabla de comisiones.
DROP POLICY IF EXISTS comision_niveles_select ON public.comision_niveles;
CREATE POLICY comision_niveles_select ON public.comision_niveles
    FOR SELECT USING (public.es_admin() OR public.es_domiciliario());

-- Escritura: solo admin (mismo patrón que zonas/tarifas).
DROP POLICY IF EXISTS comision_niveles_admin_all ON public.comision_niveles;
CREATE POLICY comision_niveles_admin_all ON public.comision_niveles
    FOR ALL USING (public.es_admin()) WITH CHECK (public.es_admin());

-- ============================================================
-- 2) comision_para_total: valor del nivel para un total
-- ============================================================
-- Devuelve el valor del nivel cuyo rango contiene a p_total. Si el total
-- supera el último nivel, aplica el nivel más alto; si no hay niveles, 0.
CREATE OR REPLACE FUNCTION public.comision_para_total(p_total INTEGER)
RETURNS INTEGER
LANGUAGE sql STABLE SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT valor FROM public.comision_niveles
         WHERE p_total <= hasta ORDER BY nivel ASC LIMIT 1),
        (SELECT valor FROM public.comision_niveles ORDER BY nivel DESC LIMIT 1),
        0
    );
$$;

-- Supabase otorga por defecto a anon EXECUTE sobre funciones nuevas y ALL
-- sobre tablas nuevas (default privileges). Se revoca EXPLÍCITAMENTE de anon:
-- un REVOKE FROM PUBLIC no alcanza porque el grant de anon es directo.
REVOKE ALL ON FUNCTION public.comision_para_total(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comision_para_total(INTEGER) TO authenticated;

-- ============================================================
-- 3) transicionar_pedido: snapshot por nivel al entregar
-- ============================================================
-- Al pasar a 'entregado' se congela en pedidos.comision el valor del nivel
-- que corresponde al TOTAL del pedido (tarifa + recargos) en ESE momento.
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
    v_comision INTEGER;
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

    -- Comisión por nivel según el valor del pedido (0 si no hay niveles).
    v_comision := 0;
    IF p_estado = 'entregado' THEN
        v_comision := public.comision_para_total(
            COALESCE(v_pedido.total, v_pedido.tarifa_base + COALESCE(v_pedido.recargo_total, 0))
        );
    END IF;

    UPDATE public.pedidos
    SET estado = p_estado,
        motivo_cancelacion = CASE WHEN p_estado = 'cancelado' THEN v_motivo_final ELSE motivo_cancelacion END,
        comision = CASE WHEN p_estado = 'entregado' THEN v_comision ELSE comision END
    WHERE id = p_pedido_id;

    INSERT INTO public.historial_estados (pedido_id, estado, notas)
    VALUES (p_pedido_id, p_estado, v_motivo_final);

    RETURN JSONB_BUILD_OBJECT('pedido_id', p_pedido_id, 'estado', p_estado);
END;
$$;

-- ============================================================
-- 4) Realtime: cambios de niveles al instante en el panel admin
-- ============================================================
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.comision_niveles;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;

ALTER TABLE public.comision_niveles REPLICA IDENTITY FULL;

-- ============================================================
-- 5) Permisos
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comision_niveles TO authenticated;
REVOKE ALL ON public.comision_niveles FROM anon;

-- Hardening consistente: las tablas privadas de la Fase 10 también quedan
-- sin grants de anon (solo las protege RLS; se revoca por los default
-- privileges de Supabase que otorgan ALL a anon sobre tablas nuevas).
REVOKE ALL ON public.pagos_domiciliarios, public.historial_comisiones FROM anon;

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT nivel, hasta, valor FROM public.comision_niveles ORDER BY nivel;
-- SELECT public.comision_para_total(5000);   -- nivel 1
-- SELECT public.comision_para_total(15000);  -- nivel 2
-- SELECT public.comision_para_total(25000);  -- nivel 3
-- SELECT public.comision_para_total(999999); -- nivel más alto
-- SELECT numero, total, comision FROM public.pedidos WHERE estado = 'entregado' ORDER BY created_at DESC LIMIT 5;

-- ============================================================
-- FIN FASE 11 · INICIO FASE 12
-- ============================================================

-- ============================================================
-- StarGo · Fase 12 — Escalera de comisiones CONFIGURABLE
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase (POSTGRES).
-- Requiere la Fase 11 (comision_niveles, es_admin).
--
-- Cambio de modelo (pedido del negocio):
--   * La escalera pasa de 10 a 20 niveles (default: cada nivel abarca
--     $10.000, así que el nivel 20 cubre hasta $200.000).
--   * El RANGO entre niveles ya NO está fijo en $10.000: se guarda en la
--     tabla comision_config (una sola fila) como `paso`, y la CANTIDAD de
--     niveles como `niveles`. El admin los ajusta desde el panel y un RPC
--     (reconfigurar_escalera) reacomoda TODA la escalera de una vez.
--   * Reacomodar la escalera conserva el valor de cada nivel por posición
--     (nivel 1 conserva su valor, nivel 2 el suyo, …) y NO toca las
--     comisiones ya congeladas en pedidos.comision.
-- ============================================================

-- ============================================================
-- 1) comision_config (fila única con id fijo)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.comision_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Cuánto abarca cada nivel (COP): nivel 1 cubre 0..paso, nivel 2
    -- paso+1..2*paso, … (el tope de cada nivel es nivel * paso).
    paso INTEGER NOT NULL DEFAULT 10000 CHECK (paso > 0),
    -- Cantidad de niveles de la escalera.
    niveles INTEGER NOT NULL DEFAULT 20 CHECK (niveles > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Id fijo: garantiza que solo exista UNA fila de configuración.
INSERT INTO public.comision_config (id, paso, niveles)
VALUES ('00000000-0000-0000-0000-000000000001', 10000, 20)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2) Completar la escalera a 20 niveles con el paso vigente
-- ============================================================
-- La Fase 11 sembró los niveles 1-10 ($10.000 de paso). Aquí se llenan los
-- faltantes hasta comision_config.niveles, respetando el paso configurado
-- y el valor del último nivel existente. No toca niveles ya configurados.
INSERT INTO public.comision_niveles (nivel, hasta, valor)
SELECT g.n, g.n * c.paso,
       COALESCE((SELECT valor FROM public.comision_niveles ORDER BY nivel DESC LIMIT 1), 1300)
FROM generate_series(1, (SELECT niveles FROM public.comision_config LIMIT 1)) AS g(n)
CROSS JOIN (SELECT paso FROM public.comision_config LIMIT 1) AS c
ON CONFLICT (nivel) DO NOTHING;

-- ============================================================
-- 3) RLS de comision_config (solo admin lee y escribe)
-- ============================================================
-- La escalera la define el admin; el domiciliario ya ve los niveles con sus
-- rangos en su panel (comision_niveles), así que no necesita la config.
ALTER TABLE public.comision_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comision_config_select ON public.comision_config;
CREATE POLICY comision_config_select ON public.comision_config
    FOR SELECT USING (public.es_admin());

DROP POLICY IF EXISTS comision_config_admin_all ON public.comision_config;
CREATE POLICY comision_config_admin_all ON public.comision_config
    FOR ALL USING (public.es_admin()) WITH CHECK (public.es_admin());

-- ============================================================
-- 4) reconfigurar_escalera: reacomoda la escalera completa
-- ============================================================
-- Atómico y validado en SQL. Solo admin. Al llamarlo:
--   * Deja EXACTAMENTE p_niveles niveles (borra los que sobren, crea los
--     faltantes con el valor del último nivel vigente).
--   * El tope de cada nivel pasa a ser nivel * p_paso.
--   * CONSERVA el valor de cada nivel existente por posición.
--   * Persiste paso/niveles en comision_config.
-- Las comisiones ya congeladas en pedidos.comision nunca se alteran.
CREATE OR REPLACE FUNCTION public.reconfigurar_escalera(p_paso INTEGER, p_niveles INTEGER)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_ultimo_valor INTEGER;
    v_n INTEGER;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede reconfigurar la escalera de comisiones';
    END IF;
    -- El tope máximo es nivel * paso y `hasta` es INTEGER (2^31-1 ≈ 2.147 mil
    -- millones), así que 200 niveles * $10.000.000 = $2.000.000.000 es el límite
    -- seguro (siempre bajo el tope de INTEGER).
    IF p_paso IS NULL OR p_paso < 1 OR p_paso > 10000000 THEN
        RAISE EXCEPTION 'El paso entre niveles debe estar entre $1 y $10.000.000';
    END IF;
    IF p_niveles IS NULL OR p_niveles < 1 OR p_niveles > 200 THEN
        RAISE EXCEPTION 'La cantidad de niveles debe estar entre 1 y 200';
    END IF;

    -- Quitar los niveles que sobran.
    DELETE FROM public.comision_niveles WHERE nivel > p_niveles;

    -- Valor para niveles nuevos: el del nivel MÁS ALTO vigente (o $1.300).
    -- Es el valor que pagaría un pedido por encima del tope actual; no se
    -- usa MAX(valor) porque un nivel intermedio personalizado no debe
    -- arrastrar su valor a los niveles nuevos.
    SELECT COALESCE(
        (SELECT valor FROM public.comision_niveles ORDER BY nivel DESC LIMIT 1),
        1300
    ) INTO v_ultimo_valor;

    -- Reacomodar el tope de los que quedan y crear los faltantes.
    -- El ON CONFLICT conserva el `valor` de cada nivel existente.
    FOR v_n IN 1..p_niveles LOOP
        INSERT INTO public.comision_niveles (nivel, hasta, valor)
        VALUES (v_n, v_n * p_paso, v_ultimo_valor)
        ON CONFLICT (nivel) DO UPDATE SET hasta = EXCLUDED.hasta;
    END LOOP;

    -- Persistir la configuración.
    INSERT INTO public.comision_config (id, paso, niveles, updated_at)
    VALUES ('00000000-0000-0000-0000-000000000001', p_paso, p_niveles, NOW())
    ON CONFLICT (id) DO UPDATE
        SET paso = EXCLUDED.paso, niveles = EXCLUDED.niveles, updated_at = NOW();

    RETURN JSONB_BUILD_OBJECT('paso', p_paso, 'niveles', p_niveles);
END;
$$;

-- Revocar EXECUTE de anon (default privileges de Supabase) y dejarlo solo
-- para usuarios autenticados; el RPC valida el rol admin por dentro.
REVOKE ALL ON FUNCTION public.reconfigurar_escalera(INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconfigurar_escalera(INTEGER, INTEGER) TO authenticated;

-- ============================================================
-- 5) Realtime: cambios de config al instante en el panel admin
-- ============================================================
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.comision_config;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;

ALTER TABLE public.comision_config REPLICA IDENTITY FULL;

-- ============================================================
-- 6) Permisos
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comision_config TO authenticated;
REVOKE ALL ON public.comision_config FROM anon;

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT * FROM public.comision_config;  -- 1 fila: paso 10000, niveles 20
-- SELECT COUNT(*), MIN(nivel), MAX(nivel) FROM public.comision_niveles;  -- 20, 1, 20
-- SELECT nivel, hasta, valor FROM public.comision_niveles ORDER BY nivel LIMIT 5;
-- SELECT public.reconfigurar_escalera(15000, 3);  -- prueba manual (admin)
-- SELECT nivel, hasta, valor FROM public.comision_niveles ORDER BY nivel;  -- 15k/30k/45k
