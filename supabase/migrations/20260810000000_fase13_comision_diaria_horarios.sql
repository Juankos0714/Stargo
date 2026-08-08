-- ============================================================
-- StarGo · Fase 13 — Comisión DIARIA acumulada + Horarios de operación
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase (POSTGRES).
-- Requiere las Fases 2-12 (pedidos, domiciliarios, transicionar_pedido,
-- comision_niveles, comision_config, es_admin, es_domiciliario).
--
-- CAMBIO DE MODELO DE COMISIÓN (corrige la interpretación de la Fase 11):
--
--   La comisión NO es por pedido: es por DÍA, según el TOTAL que el
--   domiciliario hace en el día sumando TODOS sus pedidos entregados.
--
--   Ejemplo (escalera de $10.000 por nivel, $1.300 por nivel):
--     total del día $40.000  →  alcanza el NIVEL 4
--     comisión del día       →  $1.300 × 4 = $5.200 (se paga por CADA
--                                nivel que se cruza)
--
--   La comisión del día = Σ de los valores de los niveles 1..nivel_alcanzado
--   (si todos valen lo mismo, nivel × valor). Se calcula en la aplicación
--   agrupando los pedidos ENTREGADOS por día (hora de Bogotá, UTC-5).
--   La deuda = Σ comisiones diarias − Σ abonos.
--
--   NOTA: pedidos.comision conserva el snapshot por pedido de la Fase 11
--   como referencia informativa, pero YA NO se usa para la deuda.
--
-- HORARIOS DE OPERACIÓN (nuevo):
--
--   * horario_operacion: 7 filas (una por día de la semana, 1=Lun..7=Dom)
--     con apertura/cierre y un interruptor abierto/cerrado. Semilla:
--     Lunes a Domingo de 08:00 a 20:00.
--   * horario_excepcion: fechas puntuales que anulan el día de la semana
--     (p. ej. 24 dic 08:00-14:00, o un día cerrado con activo=false).
--   * public.horario_hoy(): devuelve el estado de HOY (fuente, horario y si
--     está abierto en este momento, hora de Bogotá).
--   * crear_pedido() ahora RAISE si la app está fuera de horario: no se
--     reciben pedidos nuevos. Los pedidos en curso siguen funcionando.
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

-- Lectura pública (cualquiera puede saber el horario); escritura solo admin.
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
-- 4) crear_pedido: bloquea la creación fuera del horario de atención
-- ============================================================
-- Se re-emite la firma con recargos (Fase 7) agregando al inicio la
-- verificación de horario. La app "cerrada" = no se reciben pedidos NUEVOS;
-- los pedidos en curso y su seguimiento siguen funcionando.
CREATE OR REPLACE FUNCTION public.crear_pedido(
    p_barrio_origen_id UUID,
    p_direccion_origen TEXT,
    p_barrio_destino_id UUID,
    p_direccion_destino TEXT,
    p_observaciones TEXT DEFAULT NULL,
    p_recargos TEXT[] DEFAULT NULL
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
BEGIN
    -- Horario de atención: fuera de horario no se reciben pedidos nuevos.
    v_horario := public.horario_hoy();
    IF NOT (v_horario ->> 'abierto')::boolean THEN
        RAISE EXCEPTION
            'Estamos fuera de horario de atención (hoy de % a %). No se reciben pedidos nuevos.',
            v_horario ->> 'apertura', v_horario ->> 'cierre';
    END IF;

    -- Barrios deben existir
    SELECT zona_id INTO v_zona_origen FROM public.barrios WHERE id = p_barrio_origen_id;
    SELECT zona_id INTO v_zona_destino FROM public.barrios WHERE id = p_barrio_destino_id;
    IF v_zona_origen IS NULL OR v_zona_destino IS NULL THEN
        RETURN NULL;
    END IF;

    -- Tarifa (matriz simétrica incluida, reutiliza la Fase 2)
    v_tarifa := public.calcular_tarifa(p_barrio_origen_id::text, p_barrio_destino_id::text);
    IF v_tarifa IS NULL THEN
        RETURN NULL; -- trayecto sin tarifa o en zona no disponible
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
                recargos, recargo_total, total
            ) VALUES (
                v_numero, p_barrio_origen_id, p_direccion_origen,
                p_barrio_destino_id, p_direccion_destino, p_observaciones,
                v_tarifa, v_zona_origen, v_zona_destino, 'pendiente',
                v_snapshot, v_recargo_total, v_tarifa + v_recargo_total
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
        'zona_destino', v_zona_destino
    );
END;
$$;

-- ============================================================
-- 5) Realtime: cambios de horario al instante en el panel admin
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
-- 6) Permisos
-- ============================================================
-- Supabase otorga por defecto ALL a anon sobre tablas nuevas: primero se
-- revoca TODO de anon y luego se le deja SOLO lectura pública (el horario no
-- es sensible). La escritura queda restringida por RLS al admin (grant a
-- authenticated + política). El orden importa: REVOKE ALL borra también los
-- grants previos, así que GRANT SELECT debe ir DESPUÉS del REVOKE.
REVOKE ALL ON public.horario_operacion, public.horario_excepcion FROM anon;
GRANT SELECT ON public.horario_operacion, public.horario_excepcion TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.horario_operacion, public.horario_excepcion TO authenticated;

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT * FROM public.horario_operacion ORDER BY dia_semana;
-- SELECT public.horario_hoy();
-- SELECT public.crear_pedido(...);  -- fuera de horario → EXCEPTION con el aviso
