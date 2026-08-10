-- ============================================================
-- StarGo · Fase 18 (hardening) — Defensa en profundidad sobre
-- comision_niveles: solo se puede escribir congelando el día
-- ============================================================
-- Requiere la Fase 18 (congelar_comisiones_dia, comision_historico).
--
-- PROBLEMA QUE RESUELVE:
--   La garantía «el cambio aplica desde mañana» vivía solo en la capa de
--   app: la API llamaba a congelar_comisiones_dia() antes de cada mutación,
--   pero comision_niveles seguía siendo escribible directamente (PostgREST
--   como admin, service role, o un endpoint futuro que se olvide del
--   congelamiento) → se podía evadir.
--
-- SOLUCIÓN (guardián a nivel de BD):
--   * Un trigger bloquea CUALQUIER INSERT/UPDATE/DELETE sobre
--     comision_niveles salvo que la transacción lleve el flag
--     app.commission_write_allowed = 'on'.
--   * El flag es TRANSACCIÓN-LOCAL (set_config is_local=true): como cada
--     RPC de PostgREST corre en una transacción propia, nunca queda
--     «prendido» para llamadas siguientes ni se filtra entre conexiones
--     pooled.
--   * Las escrituras legítimas pasan por RPCs SECURITY DEFINER que, en la
--     MISMA transacción: 1) congelan el día (congelar_comisiones_dia), 2)
--     ponen el flag, 3) escriben. El flag y la escritura comparten
--     transacción → el trigger las deja pasar. Un flag puesto en una
--     transacción distinta (como haría la app vieja) NO autoriza nada.
--   * Roles de infraestructura (postgres/supabase_admin/service_role) se
--     eximen: ya tienen BYPASSRLS y pueden escribir comision_historico
--     directamente (re-escribir el congelamiento), así que bloquearlos en
--     comision_niveles no añade seguridad y rompería migraciones, seeds y
--     scripts. El guardián protege el camino de la APP (rol authenticated).
-- ============================================================

-- ============================================================
-- 1) Trigger: bloquea la escritura directa sin flag
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_bloquear_escritura_directa_comision_niveles()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Roles de infraestructura (migraciones, seeds, RPCs SECURITY DEFINER que
  -- corren como owner): ya tienen acceso total (BYPASSRLS) y podrían escribir
  -- comision_historico directo, así que el guardián no los protege de nada y
  -- bloquearlos rompería el tooling. Solo se vela por el rol de la app.
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- Cualquier otra escritura (PostgREST con token de admin, endpoint futuro)
  -- exige que la transacción haya congelado el día (flag puesto por el RPC).
  IF current_setting('app.commission_write_allowed', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Escritura directa a comision_niveles no permitida; use el RPC que congela el día primero'
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_bloquear_escritura_directa ON public.comision_niveles;
CREATE TRIGGER trg_bloquear_escritura_directa
  BEFORE INSERT OR UPDATE OR DELETE ON public.comision_niveles
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_bloquear_escritura_directa_comision_niveles();

-- ============================================================
-- 2) congelar_comisiones_dia: autoriza la escritura en SU transacción
-- ============================================================
-- El flag es local a la transacción del RPC. Las RPCs de mutación (abajo)
-- llaman a esta función y escriben DENTRO de la misma transacción, así el
-- flag autoriza exactamente ese write y muere al terminar.
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

    -- Autoriza la escritura de comision_niveles en ESTA transacción (el
    -- trigger trg_bloquear_escritura_directa exige este flag). Al terminar
    -- la transacción el flag se resetea solo (is_local = true).
    PERFORM set_config('app.commission_write_allowed', 'on', true);

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
-- 3) reconfigurar_escalera: congela + autoriza en la misma transacción
-- ============================================================
-- Antes mutaba comision_niveles sin congelar (la API lo hacía aparte, en
-- otra transacción). Ahora congela HOY con la escalera vigente ANTES del
-- cambio y autoriza la escritura en esta misma transacción, así el
-- congelamiento queda garantizado aunque alguien llame al RPC directo.
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

    -- Fase 18 hardening: congela HOY con la escalera VIGENTE (la anterior al
    -- cambio) y autoriza la escritura de comision_niveles en esta transacción
    -- (trg_bloquear_escritura_directa exige el flag).
    PERFORM public.congelar_comisiones_dia();
    PERFORM set_config('app.commission_write_allowed', 'on', true);

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

REVOKE ALL ON FUNCTION public.reconfigurar_escalera(INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconfigurar_escalera(INTEGER, INTEGER) TO authenticated;

-- ============================================================
-- 4) RPCs de mutación: congelan + autorizan + escriben atómicamente
-- ============================================================
-- Sustituyen las escrituras directas que hacía la API (POST/PUT/DELETE).
-- Cada una: admin → congelar (flag en la misma transacción) → escribir.
-- Devuelven la fila afectada como JSONB (la API la responde tal cual).

-- 4a) Agregar un nivel
CREATE OR REPLACE FUNCTION public.agregar_nivel_comision(
    p_nivel INTEGER,
    p_hasta INTEGER,
    p_valor INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_fila public.comision_niveles%ROWTYPE;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede modificar la escalera de comisiones';
    END IF;
    IF p_nivel IS NULL OR p_hasta IS NULL OR p_valor IS NULL THEN
        RAISE EXCEPTION 'Faltan parámetros (nivel, hasta, valor)';
    END IF;

    -- Congela HOY con la escalera vigente ANTES de agregar el nivel: el
    -- cambio aplica desde mañana. El flag autoriza la escritura en ESTA
    -- transacción (el trigger lo exige).
    PERFORM public.congelar_comisiones_dia();
    PERFORM set_config('app.commission_write_allowed', 'on', true);

    INSERT INTO public.comision_niveles (nivel, hasta, valor)
    VALUES (p_nivel, p_hasta, p_valor)
    RETURNING * INTO v_fila;

    RETURN to_jsonb(v_fila);
END;
$$;

-- 4b) Actualizar valor y/o tope de un nivel
CREATE OR REPLACE FUNCTION public.actualizar_nivel_comision(
    p_id UUID,
    p_valor INTEGER DEFAULT NULL,
    p_hasta INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_fila public.comision_niveles%ROWTYPE;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede modificar la escalera de comisiones';
    END IF;
    IF p_id IS NULL OR (p_valor IS NULL AND p_hasta IS NULL) THEN
        RAISE EXCEPTION 'Envía al menos un campo: valor o hasta';
    END IF;

    -- Congela HOY con la escalera vigente ANTES del cambio (aplica desde
    -- mañana) y autoriza la escritura en esta transacción.
    PERFORM public.congelar_comisiones_dia();
    PERFORM set_config('app.commission_write_allowed', 'on', true);

    UPDATE public.comision_niveles
    SET valor = COALESCE(p_valor, valor),
        hasta = COALESCE(p_hasta, hasta)
    WHERE id = p_id
    RETURNING * INTO v_fila;

    IF v_fila.id IS NULL THEN
        RETURN NULL; -- nivel no encontrado
    END IF;
    RETURN to_jsonb(v_fila);
END;
$$;

-- 4c) Eliminar un nivel
CREATE OR REPLACE FUNCTION public.eliminar_nivel_comision(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_fila public.comision_niveles%ROWTYPE;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede modificar la escalera de comisiones';
    END IF;
    IF p_id IS NULL THEN
        RAISE EXCEPTION 'Falta el id del nivel';
    END IF;

    -- Congela HOY con la escalera vigente ANTES de eliminar el nivel y
    -- autoriza la escritura en esta transacción.
    PERFORM public.congelar_comisiones_dia();
    PERFORM set_config('app.commission_write_allowed', 'on', true);

    DELETE FROM public.comision_niveles
    WHERE id = p_id
    RETURNING * INTO v_fila;

    IF v_fila.id IS NULL THEN
        RETURN NULL; -- nivel no encontrado
    END IF;
    RETURN to_jsonb(v_fila);
END;
$$;

-- ============================================================
-- 5) Permisos
-- ============================================================
REVOKE ALL ON FUNCTION public.agregar_nivel_comision(INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agregar_nivel_comision(INTEGER, INTEGER, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.actualizar_nivel_comision(UUID, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actualizar_nivel_comision(UUID, INTEGER, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.eliminar_nivel_comision(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eliminar_nivel_comision(UUID) TO authenticated;

-- ============================================================
-- Verificación
-- ============================================================
-- Como admin (vía API/RPC): SELECT public.congelar_comisiones_dia();
--   SELECT public.agregar_nivel_comision(21, 210000, 1300);
-- Escritura directa como admin → debe fallar con 42501:
--   UPDATE public.comision_niveles SET valor = 1 WHERE nivel = 1;
-- (La API ya no escribe directo: POST/PUT/DELETE usan los RPCs de arriba.)
