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
