# Guía para aplicar migraciones pendientes al staging

## Resumen
El test de TestSprite encontró que la función `crear_pedido()` no existe en la BD del staging. Esto impide crear pedidos desde la aplicación.

## Migraciones pendientes
1. `20260825000000_fix_constraints_rls_pendientes.sql` - Constraints y RLS
2. `20260826000000_fase21_base_necesaria.sql` - Tabla turnos y base_necesaria
3. `20260826000001_fase21b_protect_base_necesaria.sql` - Trigger protección base
4. `20260826000002_fase21_fix_domiciliarios_con_base.sql` - Fix domiciliarios_con_base
5. `20260826000003_fase21_fix_transicionar_turno_activo.sql` - Fix transicionar_pedido
6. `20260827000000_fase22_valor_mandado.sql` - Columna valor_mandado
7. `20260828000000_fix_horario_check_crear_pedido.sql` - Fix crear_pedido con horario

## Pasos para aplicar

### Opción 1: Desde el SQL Editor (Recomendado)

1. Ve al dashboard de Supabase: https://supabase.com/dashboard/project/uwfjfkcytohrjnyspkkt
2. Navega a **SQL Editor** en el menú lateral
3. Copia el contenido del archivo `docs/migraciones_pendientes_staging.sql`
4. Pega en el SQL Editor
5. Haz clic en **Run** para ejecutar

### Opción 2: Usando Supabase CLI (si tienes acceso)

```bash
# Link al proyecto
supabase link --project-ref uwfjfkcytohrjnyspkkt

# Aplicar migraciones
supabase db push
```

## Verificación después de aplicar

Ejecuta estas consultas en el SQL Editor para verificar:

```sql
-- 1. Verificar que crear_pedido existe
SELECT proname, proargnames 
FROM pg_proc 
WHERE proname = 'crear_pedido';

-- 2. Verificar columnas nuevas
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'pedidos' 
AND column_name IN ('base_necesaria', 'valor_mandado');

-- 3. Verificar tabla turnos
SELECT EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_name = 'turnos'
) AS turnos_existe;

-- 4. Verificar función horario_hoy
SELECT proname 
FROM pg_proc 
WHERE proname = 'horario_hoy';
```

## Archivos incluidos
- `docs/migraciones_pendientes_staging.sql` - SQL consolidado listo para ejecutar
- `supabase/migrations/` - Migraciones individuales originales

## Notas importantes
- Estas migraciones son seguras de ejecutar múltiples veces (usan `CREATE OR REPLACE` y `IF NOT EXISTS`)
- No borran datos existentes
- Las migraciones deben ejecutarse en orden (ya están ordenadas en el archivo consolidado)
- Después de aplicar, ejecuta nuevamente el test de TestSprite para verificar
