-- ============================================================
-- StarGo · Fase 18 — Comisiones congeladas por día
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase (POSTGRES).
-- Requiere las Fases 11-13 (comision_niveles, comision_config,
-- es_admin, es_domiciliario).
--
-- PROBLEMA QUE RESUELVE:
--   La comisión DIARIA (Fase 13) se calcula en la aplicación con la
--   escalera VIGENTE de comision_niveles para TODOS los días. Si el admin
--   cambia un nivel, las comisiones de los días anteriores (y del día en
--   curso) se recalculaban con la escalera nueva → lo ya generado cambiaba.
--
-- SOLUCIÓN (congelamiento por día):
--   * comision_historico guarda una SNAPSHOT de la escalera (niveles +
--     paso) por cada fecha.
--   * Al cambiar la escalera (desde el panel), la aplicación llama al RPC
--     congelar_comisiones_dia() ANTES de aplicar el cambio: congela HOY y
--     los días sin congelar con la escalera vigente (la anterior al cambio).
--   * El cambio queda para los días SIGUIENTES (desde mañana): hoy y los
--     días pasados conservan la escalera que estaba vigente ese día.
--   * Al calcular una comisión del día D se usa comision_historico[D]
--     (o la escalera vigente si D no está congelado).
-- ============================================================

-- ============================================================
-- 1) comision_historico: snapshot de la escalera por día
-- ============================================================
CREATE TABLE IF NOT EXISTS public.comision_historico (
    -- Día (hora de Bogotá) al que aplica esta escalera congelada.
    fecha DATE PRIMARY KEY,
    -- Snapshot de la escalera: [{nivel, hasta, valor}, ...] ordenada por nivel.
    niveles JSONB NOT NULL,
    -- Paso de la escalera congelada (referencia informativa).
    paso INTEGER NOT NULL DEFAULT 10000,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2) RLS: solo lectura autenticada; la escritura va por el RPC
-- ============================================================
-- La lectura la hacen la app (server con el token del usuario) y el panel;
-- los niveles de comisión ya son de lectura pública para los autenticados
-- (Fase 11), así que el snapshot del día no es sensible.
ALTER TABLE public.comision_historico ENABLE ROW LEVEL SECURITY;

-- Lectura para admin y domiciliarios (igual que comision_niveles); el
-- cliente sin rol no la ve y anon no tiene grants.
DROP POLICY IF EXISTS comision_historico_select ON public.comision_historico;
CREATE POLICY comision_historico_select ON public.comision_historico
    FOR SELECT USING (public.es_admin() OR public.es_domiciliario());

-- ============================================================
-- 3) congelar_comisiones_dia: congela HOY (y los días sin congelar)
--    con la escalera vigente
-- ============================================================
-- Solo admin. Atómico e idempotente:
--   * Si HOY ya está congelado no hace nada (los cambios del día ya
--     están programados para mañana) y devuelve congelado=false.
--   * Si no, congela cada fecha desde el día siguiente al último
--     congelado (o el primer día con entregas, lo que sea más reciente)
--     hasta HOY con la escalera vigente ANTES del cambio.
CREATE OR REPLACE FUNCTION public.congelar_comisiones_dia()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_hoy DATE;
    v_inicio DATE;
    v_niveles JSONB;
    v_paso INTEGER;
    v_fecha DATE;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede congelar las comisiones del día';
    END IF;

    v_hoy := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date;

    -- Hoy ya está congelado: los cambios de hoy ya aplican desde mañana.
    IF EXISTS (SELECT 1 FROM public.comision_historico WHERE fecha = v_hoy) THEN
        RETURN JSONB_BUILD_OBJECT(
            'congelado', FALSE,
            'desde', NULL,
            'hasta', NULL
        );
    END IF;

    -- Snapshot de la escalera vigente (la que se congela para HOY y los
    -- días anteriores aún sin congelar).
    SELECT COALESCE(
        jsonb_agg(jsonb_build_object('nivel', n.nivel, 'hasta', n.hasta, 'valor', n.valor) ORDER BY n.nivel),
        '[]'::jsonb
    ) INTO v_niveles
    FROM public.comision_niveles n;

    SELECT paso INTO v_paso
    FROM public.comision_config
    WHERE id = '00000000-0000-0000-0000-000000000001';

    -- Desde dónde congelar: el día siguiente al último congelado, o el
    -- primer día con entregas si nunca se congeló, o HOY si no hay entregas.
    SELECT COALESCE(
        (SELECT MAX(fecha) + 1 FROM public.comision_historico),
        (SELECT MIN((updated_at AT TIME ZONE 'America/Bogota')::date)
         FROM public.pedidos WHERE estado = 'entregado'),
        v_hoy
    ) INTO v_inicio;

    IF v_inicio > v_hoy THEN
        RETURN JSONB_BUILD_OBJECT('congelado', FALSE, 'desde', NULL, 'hasta', NULL);
    END IF;

    -- Congelar cada fecha de [v_inicio .. v_hoy] con la escalera vigente.
    FOR v_fecha IN SELECT generate_series(v_inicio, v_hoy, '1 day')::date LOOP
        INSERT INTO public.comision_historico (fecha, niveles, paso)
        VALUES (v_fecha, v_niveles, COALESCE(v_paso, 10000))
        ON CONFLICT (fecha) DO NOTHING;
    END LOOP;

    RETURN JSONB_BUILD_OBJECT(
        'congelado', TRUE,
        'desde', TO_CHAR(v_inicio, 'YYYY-MM-DD'),
        'hasta', TO_CHAR(v_hoy, 'YYYY-MM-DD')
    );
END;
$$;

REVOKE ALL ON FUNCTION public.congelar_comisiones_dia() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.congelar_comisiones_dia() TO authenticated;

-- ============================================================
-- 4) Backfill inicial: congela el historial con la escalera vigente
-- ============================================================
-- Al aplicar la migración, todos los días con entregas hasta HOY quedan
-- congelados con la escalera actual (la vigente hasta ahora), de modo que
-- la garantía «cada día conserva su escalera» aplica desde el día uno.
INSERT INTO public.comision_historico (fecha, niveles, paso)
SELECT g.d::date,
       (SELECT COALESCE(
           jsonb_agg(jsonb_build_object('nivel', n.nivel, 'hasta', n.hasta, 'valor', n.valor) ORDER BY n.nivel),
           '[]'::jsonb)
        FROM public.comision_niveles n),
       (SELECT COALESCE(paso, 10000) FROM public.comision_config
        WHERE id = '00000000-0000-0000-0000-000000000001')
FROM generate_series(
    COALESCE(
        (SELECT MIN((updated_at AT TIME ZONE 'America/Bogota')::date)
         FROM public.pedidos WHERE estado = 'entregado'),
        (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date
    ),
    (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date,
    '1 day'
) AS g(d)
ON CONFLICT (fecha) DO NOTHING;

-- ============================================================
-- 5) Permisos
-- ============================================================
REVOKE ALL ON public.comision_historico FROM anon;
GRANT SELECT ON public.comision_historico TO authenticated;

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT fecha, niveles, paso FROM public.comision_historico ORDER BY fecha DESC LIMIT 5;
-- SELECT public.congelar_comisiones_dia();  -- (admin) idempotente
-- SELECT * FROM public.comision_historico WHERE fecha = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date;
