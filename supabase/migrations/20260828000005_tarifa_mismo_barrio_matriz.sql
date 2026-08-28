-- StarGo · El mismo barrio se tarifa por su zona, igual que cualquier ruta.
-- La fila zona → misma zona de la matriz define la tarifa mínima vigente.

CREATE OR REPLACE FUNCTION public.calcular_tarifa(
    p_barrio_origen TEXT,
    p_barrio_destino TEXT
) RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_zona_origen  TEXT;
    v_zona_destino TEXT;
    v_valor        INTEGER;
BEGIN
    SELECT zona_id INTO v_zona_origen
    FROM public.barrios WHERE id::text = p_barrio_origen;

    SELECT zona_id INTO v_zona_destino
    FROM public.barrios WHERE id::text = p_barrio_destino;

    IF v_zona_origen IS NULL OR v_zona_destino IS NULL THEN
        RETURN NULL;
    END IF;
    IF v_zona_origen = 'zona_roja' OR v_zona_destino = 'zona_roja' THEN
        RETURN NULL;
    END IF;

    SELECT valor INTO v_valor
    FROM public.tarifas
    WHERE zona_origen_id = v_zona_origen AND zona_destino_id = v_zona_destino;

    IF v_valor IS NULL THEN
        SELECT valor INTO v_valor
        FROM public.tarifas
        WHERE zona_origen_id = v_zona_destino AND zona_destino_id = v_zona_origen;
    END IF;

    RETURN v_valor;
END;
$$;
