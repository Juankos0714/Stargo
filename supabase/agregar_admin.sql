-- ============================================================
-- StarGo · Registrar el primer administrador
-- ============================================================
-- Pasos:
--   1) Crea tu usuario en Supabase:
--      Dashboard → Authentication → Users → "Add user" (email + password)
--   2) Reemplaza 'tu@correo.com' con TU email y ejecuta este script
--      en el SQL Editor del Dashboard de Supabase.
-- ============================================================

INSERT INTO public.admins (user_id, email)
SELECT id, email
FROM auth.users
WHERE email = 'tu@correo.com'
ON CONFLICT (user_id) DO NOTHING;

-- Verificación (debe devolver tu fila):
-- SELECT u.email, a.created_at
-- FROM public.admins a
-- JOIN auth.users u ON u.id = a.user_id;

-- Nota: también puedes dar de alta a otros admins repitiendo el INSERT
-- con su email. Los no-admins no pueden acceder al panel (RLS `es_admin()`).
