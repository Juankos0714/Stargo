-- ============================================================
-- StarGo · Fase 2 — Esquema base: zonas, barrios, tarifas,
-- recargos, admins + calcular_tarifa() + es_admin() + RLS
-- ============================================================
-- Reconstruido desde docs/MIGRACION_SVELTEKIT.md (esquema original).
-- Requiere Supabase Auth (auth.users) para la FK de admins.
-- Las fases posteriores (pedidos, domiciliarios, recargos activos)
-- se aplican encima en orden.
--
-- Modelo de acceso (mismo que audita supabase/audit_rls.sql):
--   * Catálogo público (lectura anónima): zonas, barrios, tarifas, recargos.
--     Escritura SOLO admin (políticas es_admin()).
--   * admins: privada; cada usuario ve su propia fila (admins_propio_select).
--   * Todas las escrituras sensibles pasan por RPCs SECURITY DEFINER.
-- ============================================================

-- ---------- Tabla admins ----------
CREATE TABLE IF NOT EXISTS public.admins (
    user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- Tabla zonas ----------
CREATE TABLE IF NOT EXISTS public.zonas (
    id          TEXT PRIMARY KEY,           -- slug: 'centro', 'norte_1_18', etc.
    nombre      TEXT NOT NULL,
    tipo        TEXT NOT NULL CHECK (tipo IN ('urbana', 'destino_solo', 'no_disponible')),
    descripcion TEXT
);

-- ---------- Tabla barrios ----------
-- id UUID: los RPCs (crear_pedido) reciben el id del barrio como UUID.
-- nombre es único: la API deduplica por nombre al insertar y el cálculo
-- de tarifas acepta el nombre como fallback.
CREATE TABLE IF NOT EXISTS public.barrios (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre    TEXT NOT NULL UNIQUE,
    zona_id   TEXT REFERENCES public.zonas(id),
    revisado  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_barrios_zona ON public.barrios (zona_id);

-- ---------- Tabla tarifas (matriz zona × zona) ----------
CREATE TABLE IF NOT EXISTS public.tarifas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zona_origen_id  TEXT NOT NULL REFERENCES public.zonas(id) ON DELETE CASCADE,
    zona_destino_id TEXT NOT NULL REFERENCES public.zonas(id) ON DELETE CASCADE,
    valor           INTEGER NOT NULL CHECK (valor >= 0),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tarifas_unico UNIQUE (zona_origen_id, zona_destino_id)
);

-- ---------- Tabla recargos (Fase 7 añade descripcion + activo) ----------
CREATE TABLE IF NOT EXISTS public.recargos (
    codigo  TEXT PRIMARY KEY,
    nombre  TEXT NOT NULL,
    tipo    TEXT,
    valor   INTEGER NOT NULL DEFAULT 0 CHECK (valor >= 0)
);

-- ---------- Funciones de rol (deben existir ANTES de las políticas) ----------
-- es_admin(): ¿el usuario actual está en public.admins? (SECURITY DEFINER:
-- el owner lee admins sin RLS). Se usa en las políticas y en los RPCs.
CREATE OR REPLACE FUNCTION public.es_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.admins WHERE user_id = auth.uid()
    );
$$;

-- ---------- Trigger updated_at ----------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tarifas_updated_at ON public.tarifas;
CREATE TRIGGER trg_tarifas_updated_at
    BEFORE UPDATE ON public.tarifas
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- RLS ----------
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zonas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barrios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarifas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recargos ENABLE ROW LEVEL SECURITY;

-- admins: cada usuario solo ve su propia fila (no hay escritura por SQL).
DROP POLICY IF EXISTS admins_propio_select ON public.admins;
CREATE POLICY admins_propio_select ON public.admins
    FOR SELECT USING (user_id = auth.uid());

-- Catálogo: lectura pública + escritura solo admin.
DROP POLICY IF EXISTS zonas_public_select ON public.zonas;
CREATE POLICY zonas_public_select ON public.zonas
    FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS zonas_admin_all ON public.zonas;
CREATE POLICY zonas_admin_all ON public.zonas
    FOR ALL USING (public.es_admin()) WITH CHECK (public.es_admin());

DROP POLICY IF EXISTS barrios_public_select ON public.barrios;
CREATE POLICY barrios_public_select ON public.barrios
    FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS barrios_admin_all ON public.barrios;
CREATE POLICY barrios_admin_all ON public.barrios
    FOR ALL USING (public.es_admin()) WITH CHECK (public.es_admin());

DROP POLICY IF EXISTS tarifas_public_select ON public.tarifas;
CREATE POLICY tarifas_public_select ON public.tarifas
    FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS tarifas_admin_all ON public.tarifas;
CREATE POLICY tarifas_admin_all ON public.tarifas
    FOR ALL USING (public.es_admin()) WITH CHECK (public.es_admin());

DROP POLICY IF EXISTS recargos_public_select ON public.recargos;
CREATE POLICY recargos_public_select ON public.recargos
    FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS recargos_admin_all ON public.recargos;
CREATE POLICY recargos_admin_all ON public.recargos
    FOR ALL USING (public.es_admin()) WITH CHECK (public.es_admin());

-- ---------- Función pública: calcular_tarifa ----------
-- Resuelve barrio → zona → matriz, con zona roja y fallback simétrico.
-- Acepta el id (slug) del barrio. Devuelve NULL si el barrio no existe,
-- está en zona roja o el trayecto no tiene tarifa.
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
    FROM public.barrios WHERE id = p_barrio_origen;

    SELECT zona_id INTO v_zona_destino
    FROM public.barrios WHERE id = p_barrio_destino;

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

-- ---------- Permisos ----------
-- Catálogo público: lectura anónima y autenticada.
GRANT SELECT ON public.zonas, public.barrios, public.tarifas, public.recargos
    TO anon, authenticated;

-- Catálogo admin: los autenticados pueden escribir, pero las políticas RLS
-- (es_admin()) deciden quién realmente puede hacerlo.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zonas, public.barrios,
    public.tarifas, public.recargos TO authenticated;

-- Las políticas llaman a es_admin(); los roles deben poder ejecutarla.
GRANT EXECUTE ON FUNCTION public.es_admin() TO anon, authenticated;

-- calcular_tarifa es pública (la usa la calculadora sin login).
GRANT EXECUTE ON FUNCTION public.calcular_tarifa(TEXT, TEXT) TO anon, authenticated;

-- ---------- Verificación ----------
-- SELECT tablename, policyname, cmd FROM pg_policies
--   WHERE schemaname = 'public' AND tablename IN ('zonas','barrios','tarifas','recargos','admins');
-- SELECT public.calcular_tarifa('centro', 'villa_inglesa');
