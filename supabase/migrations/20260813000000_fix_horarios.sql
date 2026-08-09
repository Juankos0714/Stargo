-- ============================================================
-- StarGo · Reparación — Tablas de horarios + horario_hoy()
-- ============================================================
-- PROBLEMA: la Fase 13 (20260810000000_fase13_comision_diaria_horarios.sql)
-- creaba las tablas horario_operacion / horario_excepcion y la función
-- horario_hoy(), pero NO se ejecutó en la base de producción: el panel de
-- horarios decía «la tabla no existe».
--
-- ESTA MIGRACIÓN NO REDEFINE crear_pedido() a propósito: la Fase 14 ya lo
-- re-emitió con p_tipo_servicio / p_recargos_confirmados_no_aplica. Si se
-- ejecutara la Fase 13 completa después de la 14, se pisaría crear_pedido con
-- la firma vieja y se perdería tipo_servicio. Aquí solo se crean las tablas,
-- la función horario_hoy() (que la Fase 14 ya usa) y los permisos.
--
-- Es idempotente: se puede ejecutar tantas veces como se quiera.
-- ============================================================

-- ============================================================
-- 1) horario_operacion (semana tipo, 1 = Lunes … 7 = Domingo)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.horario_operacion (
    dia_semana SMALLINT PRIMARY KEY CHECK (dia_semana BETWEEN 1 AND 7),
    apertura TIME NOT NULL,
    cierre TIME NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE
);

-- Semilla: 08:00–20:00 todos los días (el admin lo ajusta desde el panel).
INSERT INTO public.horario_operacion (dia_semana, apertura, cierre, activo)
SELECT g.d, TIME '08:00', TIME '20:00', TRUE
FROM generate_series(1, 7) AS g(d)
ON CONFLICT (dia_semana) DO NOTHING;

ALTER TABLE public.horario_operacion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS horario_operacion_select ON public.horario_operacion;
CREATE POLICY horario_operacion_select ON public.horario_operacion
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS horario_operacion_admin_all ON public.horario_operacion;
CREATE POLICY horario_operacion_admin_all ON public.horario_operacion
    FOR ALL USING (public.es_admin()) WITH CHECK (public.es_admin());

-- ============================================================
-- 2) horario_excepcion (fechas puntuales)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.horario_excepcion (
    fecha DATE PRIMARY KEY,
    apertura TIME NOT NULL,
    cierre TIME NOT NULL,
    -- activo=false significa DÍA CERRADO (anula el horario semanal).
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    motivo TEXT
);

ALTER TABLE public.horario_excepcion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS horario_excepcion_select ON public.horario_excepcion;
CREATE POLICY horario_excepcion_select ON public.horario_excepcion
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS horario_excepcion_admin_all ON public.horario_excepcion;
CREATE POLICY horario_excepcion_admin_all ON public.horario_excepcion
    FOR ALL USING (public.es_admin()) WITH CHECK (public.es_admin());

-- ============================================================
-- 3) horario_hoy(): estado de hoy en hora de Bogotá (UTC-5)
-- ============================================================
-- Devuelve JSONB con: fecha, dia_semana (1..7), apertura, cierre, abierto,
-- motivo (solo excepción), fuente ('excepcion' | 'semanal') y hora_actual.
-- Un cierre menor a la apertura se interpreta como horario que cruza la
-- medianoche (p. ej. 20:00 → 02:00).
CREATE OR REPLACE FUNCTION public.horario_hoy()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE
    v_fecha DATE;
    v_dia SMALLINT;
    v_hora TIME;
    v_exc public.horario_excepcion%ROWTYPE;
    v_sem public.horario_operacion%ROWTYPE;
    v_apertura TIME;
    v_cierre TIME;
    v_activo BOOLEAN;
    v_fuente TEXT;
    v_motivo TEXT;
    v_abierto BOOLEAN;
BEGIN
    v_fecha := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date;
    v_dia := EXTRACT(ISODOW FROM v_fecha)::smallint; -- 1 = Lunes … 7 = Domingo
    v_hora := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::time;

    SELECT * INTO v_exc FROM public.horario_excepcion WHERE fecha = v_fecha;
    IF v_exc.fecha IS NOT NULL THEN
        v_apertura := v_exc.apertura;
        v_cierre := v_exc.cierre;
        v_activo := v_exc.activo;
        v_fuente := 'excepcion';
        v_motivo := v_exc.motivo;
    ELSE
        SELECT * INTO v_sem FROM public.horario_operacion WHERE dia_semana = v_dia;
        IF v_sem.dia_semana IS NULL THEN
            v_activo := FALSE;
            v_fuente := 'sin_config';
            v_apertura := TIME '08:00';
            v_cierre := TIME '20:00';
        ELSE
            v_apertura := v_sem.apertura;
            v_cierre := v_sem.cierre;
            v_activo := v_sem.activo;
            v_fuente := 'semanal';
        END IF;
    END IF;

    IF NOT v_activo THEN
        v_abierto := FALSE;
    ELSIF v_cierre > v_apertura THEN
        v_abierto := v_hora >= v_apertura AND v_hora < v_cierre;
    ELSE
        -- Cruza la medianoche (p. ej. 20:00 → 02:00).
        v_abierto := v_hora >= v_apertura OR v_hora < v_cierre;
    END IF;

    RETURN JSONB_BUILD_OBJECT(
        'fecha', TO_CHAR(v_fecha, 'YYYY-MM-DD'),
        'dia_semana', v_dia,
        'apertura', TO_CHAR(v_apertura, 'HH24:MI'),
        'cierre', TO_CHAR(v_cierre, 'HH24:MI'),
        'abierto', v_abierto,
        'motivo', v_motivo,
        'fuente', v_fuente,
        'hora_actual', TO_CHAR(v_hora, 'HH24:MI')
    );
END;
$$;

REVOKE ALL ON FUNCTION public.horario_hoy() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.horario_hoy() TO anon, authenticated;

-- ============================================================
-- 4) Realtime: cambios de horario al instante en el panel admin
-- ============================================================
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.horario_operacion;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.horario_excepcion;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;

ALTER TABLE public.horario_operacion REPLICA IDENTITY FULL;
ALTER TABLE public.horario_excepcion REPLICA IDENTITY FULL;

-- ============================================================
-- 5) Permisos
-- ============================================================
-- Supabase otorga por defecto ALL a anon sobre tablas nuevas: primero se
-- revoca TODO de anon y luego se le deja SOLO lectura pública. La escritura
-- queda restringida por RLS al admin. El orden importa: REVOKE ALL borra
-- también los grants previos, así que GRANT SELECT debe ir DESPUÉS.
REVOKE ALL ON public.horario_operacion, public.horario_excepcion FROM anon;
GRANT SELECT ON public.horario_operacion, public.horario_excepcion TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.horario_operacion, public.horario_excepcion TO authenticated;

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT * FROM public.horario_operacion ORDER BY dia_semana;
-- SELECT public.horario_hoy();
