-- ============================================================
-- StarGo · Fase 8 — Auditoría RLS y hardening de permisos
-- ============================================================
-- Ejecutar en el SQL Editor del Dashboard de Supabase (POSTGRES).
--
-- Tiene 3 partes:
--   1) VERIFICACIÓN: consultas que muestran el estado actual (RLS, políticas,
--      grants). Ejecútalas y compara contra la matriz esperada.
--   2) HARDENING: idempotente; revoca de anon/authenticated los permisos que
--      no deberían tener y garantiza los grants mínimos correctos.
--   3) PRUEBA: consultas por rol para comprobar que nadie lee/escribe lo que
--      no le corresponde.
--
-- Modelo de acceso:
--   * Tablas públicas (lectura anónima): zonas, barrios, tarifas, recargos,
--     pedido_eventos. Escritura SOLO admin (RLS) vía rol authenticated.
--   * Tablas privadas: pedidos, historial_estados, domiciliarios, admins.
--     El anon NO tiene grants (solo accede vía funciones SECURITY DEFINER:
--     crear_pedido, consultar_pedido, cancelar_pedido_cliente, calcular_tarifa).
--     Los autenticados solo LEEN (SELECT) y RLS decide qué filas ve cada rol.
--   * Todas las escrituras de pedidos pasan por RPCs SECURITY DEFINER
--     (crear_pedido, asignar_domiciliario, transicionar_pedido,
--     cancelar_pedido_cliente, registrar_domiciliario).
-- ============================================================

-- ============================================================
-- 1) VERIFICACIÓN — estado actual
-- ============================================================

-- 1a) Tablas con RLS DESHABILITADA (debe ser 0 filas)
SELECT c.relname AS tabla
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = FALSE
ORDER BY 1;

-- 1b) Políticas existentes por tabla (compara contra la matriz esperada)
SELECT tablename,
       array_agg(policyname || ' [' || cmd || ']' ORDER BY policyname) AS politicas
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;

-- 1c) Permisos de rol sobre tablas (busca accesos inesperados)
SELECT table_name, privilege_type, grantee
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, table_name, privilege_type;

-- 1d) Funciones ejecutables por rol (anon solo debe poder ejecutar el conjunto público)
SELECT r.rolname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_roles r ON r.rolname IN ('anon', 'authenticated', 'service_role')
WHERE n.nspname = 'public'
  AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
ORDER BY r.rolname, p.proname;

-- ============================================================
-- 1e) Matriz esperada de políticas (referencia)
-- ============================================================
-- | Tabla              | SELECT público        | Escritura admin            | Otros                    |
-- |--------------------|-----------------------|----------------------------|--------------------------|
-- | zonas              | zonas_public_select   | zonas_admin_all            | —                        |
-- | barrios            | barrios_public_select | barrios_admin_all          | —                        |
-- | tarifas            | tarifas_public_select | tarifas_admin_all          | —                        |
-- | recargos           | recargos_public_select| recargos_admin_all         | —                        |
-- | pedido_eventos     | pedido_eventos_select | (solo INSERT por trigger)  | —                        |
-- | pedidos            | — (vía funciones)     | pedidos_admin_select/update/delete | pedidos_domiciliario_select |
-- | historial_estados  | — (vía funciones)     | historial_admin_select/insert     | historial_domiciliario_select |
-- | domiciliarios      | —                     | domiciliarios_admin_all    | domiciliarios_propio_select |
-- | admins             | —                     | —                          | admins_propio_select     |
--
-- Lectura pública esperada para anon: zonas, barrios, tarifas, recargos,
-- pedido_eventos. Cero grants de anon sobre pedidos, historial_estados,
-- domiciliarios y admins.

-- ============================================================
-- 2) HARDENING — idempotente
-- ============================================================

-- Catálogo público: anon y authenticated solo leen.
GRANT SELECT ON public.zonas, public.barrios, public.tarifas, public.recargos,
    public.pedido_eventos TO anon, authenticated;

-- Catálogo admin: los autenticados pueden escribir, pero las políticas RLS
-- (es_admin()) limitan quién realmente puede.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zonas, public.barrios,
    public.tarifas, public.recargos TO authenticated;

-- Tablas privadas: los autenticados LEEN (admin ve todo, domiciliario lo suyo
-- según RLS); NUNCA escriben por SQL directo (todo pasa por RPCs).
GRANT SELECT ON public.pedidos, public.historial_estados,
    public.domiciliarios TO authenticated;

-- REVOKE de seguridad: el anon no toca datos privados ni escribe en nada.
REVOKE ALL ON public.pedidos, public.historial_estados,
    public.domiciliarios, public.admins FROM anon;

-- Los autenticados tampoco escriben directo en datos privados.
REVOKE INSERT, UPDATE, DELETE ON public.pedidos, public.historial_estados,
    public.domiciliarios, public.admins FROM authenticated;

-- La tabla admins no se lee desde SQL directo (es_admin() es SECURITY DEFINER);
-- se deja SOLO la lectura propia (política admins_propio_select) si ya existe.
REVOKE INSERT, UPDATE, DELETE ON public.admins FROM anon, authenticated;
GRANT SELECT ON public.admins TO authenticated;

-- Verificación post-hardening: vuelve a ejecutar 1c y confirma que anon solo
-- tiene SELECT sobre el catálogo público.

-- ============================================================
-- 3) PRUEBA — escenarios por rol (SQL Editor: Run as...)
-- ============================================================
-- En el SQL Editor de Supabase puedes cambiar el rol con:
--   SET ROLE anon;           -- o SET ROLE authenticated;
--
-- Debe devolver ERROR (permiso denegado / sin filas):
--   anon:  SELECT * FROM public.pedidos LIMIT 1;
--   anon:  SELECT * FROM public.domiciliarios LIMIT 1;
--   anon:  UPDATE public.tarifas SET valor = 0 WHERE false;
--   anon:  SELECT public.registrar_domiciliario('X', NULL, 'x@x.com');
--
-- Debe funcionar (lectura pública):
--   anon:  SELECT count(*) FROM public.barrios;
--   anon:  SELECT public.calcular_tarifa('centro', 'norte_1_18');
--   anon:  SELECT public.crear_pedido(...);
--   anon:  SELECT public.consultar_pedido('ABC123');
--
-- Debe devolver solo sus filas / respetar RLS (autenticado):
--   authenticated: SELECT public.es_admin();
--   authenticated: SELECT count(*) FROM public.pedidos;  -- según RLS
--   authenticated: UPDATE public.pedidos SET estado='x' WHERE false;  -- ERROR
--   authenticated: SELECT public.transicionar_pedido(...);  -- valida rol en BD
