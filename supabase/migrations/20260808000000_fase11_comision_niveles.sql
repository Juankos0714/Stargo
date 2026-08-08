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
