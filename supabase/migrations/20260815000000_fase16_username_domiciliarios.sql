-- ============================================================
-- StarGo · Fase 16 — Usuario (username) para domiciliarios
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase (POSTGRES).
-- Requiere Fases 2-15.
--
-- OBJETIVO: el admin crea repartidores SIN correo, con un usuario
-- tipo «movil1», «movil2»… El repartidor entra al panel con ese
-- usuario + contraseña. El correo deja de ser obligatorio.
--
-- Modelo:
--   * public.domiciliarios.username (TEXT UNIQUE, nullable): el
--     identificador de acceso visible («movil1»). Opcional: los
--     domiciliarios existentes con correo real pueden no tenerlo.
--   * La cuenta de Supabase Auth se crea igual que ahora con un EMAIL
--     SINTÉTICO interno (movil1@stargo.local) generado por el backend
--     de la app: así auth.users conserva su esquema (email único) y el
--     repartidor nunca ve ni usa ese correo.
--   * registrar_domiciliario acepta p_username opcional y lo guarda en
--     la fila; el usuario de Auth se localiza por email (el sintético
--     o el real). Se mantiene la firma anterior por compatibilidad.
-- ============================================================

-- ---------- 1) Columna username ----------
ALTER TABLE public.domiciliarios
    ADD COLUMN IF NOT EXISTS username TEXT;

-- Un usuario por repartidor; NULL permitido (varios sin username).
CREATE UNIQUE INDEX IF NOT EXISTS domiciliarios_username_key
    ON public.domiciliarios (username)
    WHERE username IS NOT NULL;

-- ---------- 2) registrar_domiciliario con p_username ----------
-- Localiza la cuenta de Auth por EMAIL (el real o el sintético que
-- generó la app) y crea/reactiva la fila guardando también el username.
CREATE OR REPLACE FUNCTION public.registrar_domiciliario(
    p_nombre TEXT,
    p_telefono TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL,
    p_username TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public VOLATILE
AS $$
DECLARE
    v_user_id UUID;
    v_fila public.domiciliarios%ROWTYPE;
    v_username TEXT;
BEGIN
    IF NOT public.es_admin() THEN
        RAISE EXCEPTION 'Solo un administrador puede registrar domiciliarios';
    END IF;

    IF p_email IS NULL THEN
        RAISE EXCEPTION 'Debes indicar el email del domiciliario';
    END IF;

    -- Username normalizado (el backend ya lo envía en minúsculas).
    IF p_username IS NOT NULL THEN
        v_username := LOWER(TRIM(p_username));
        IF v_username = '' THEN
            v_username := NULL;
        END IF;
    END IF;

    -- Localiza la cuenta de Auth por email (real o sintético).
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE LOWER(email) = LOWER(TRIM(p_email));

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No existe ningún usuario de Supabase con el email %', TRIM(p_email);
    END IF;

    -- Unicidad del username: lo prohíbe para CUALQUIER otra fila (otro repartidor).
    IF v_username IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.domiciliarios
        WHERE username = v_username AND user_id <> v_user_id
    ) THEN
        RAISE EXCEPTION 'El usuario % ya está en uso por otro repartidor', v_username;
    END IF;

    INSERT INTO public.domiciliarios (user_id, nombre, email, telefono, username)
    VALUES (v_user_id, TRIM(p_nombre), TRIM(p_email), NULLIF(TRIM(p_telefono), ''), v_username)
    ON CONFLICT (user_id) DO UPDATE
        SET nombre = EXCLUDED.nombre,
            email = EXCLUDED.email,
            telefono = EXCLUDED.telefono,
            username = COALESCE(EXCLUDED.username, public.domiciliarios.username),
            activo = TRUE
    RETURNING * INTO v_fila;

    RETURN JSONB_BUILD_OBJECT(
        'id', v_fila.id,
        'user_id', v_fila.user_id,
        'nombre', v_fila.nombre,
        'email', v_fila.email,
        'username', v_fila.username,
        'telefono', v_fila.telefono,
        'activo', v_fila.activo,
        'created_at', v_fila.created_at
    );
END;
$$;

-- ---------- 3) Permisos ----------
-- La firma cambia (4 args); se garantiza la ejecución para authenticated.
GRANT EXECUTE ON FUNCTION public.registrar_domiciliario(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================
-- Verificación
-- ============================================================
-- SELECT public.registrar_domiciliario('Móvil 1', NULL, 'movil1@stargo.local', 'movil1');
-- SELECT username, email FROM public.domiciliarios ORDER BY created_at DESC LIMIT 5;
