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
