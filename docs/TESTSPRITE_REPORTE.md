# Reporte TestSprite — StarGo

**Fecha:** 2026-08-25  
**Proyecto:** StarGo - Domicilios  
**URL probada:** https://stargo-zeta.vercel.app  
**Test ejecutado:** Crear pedido domicilio con peso y transferencia

## Resultado: ⚠️ FALLA EN BASE DE DATOS

### Resumen
El test automatizado de TestSprite verificó el flujo completo de creación de un pedido de domicilio normal con peso y transferencia. La **interfaz de usuario funciona correctamente** (14/14 pasos de interacción pasaron), pero la **confirmación del pedido falla** porque la función RPC `crear_pedido()` no existe en la base de datos del staging.

### Pasos que SÍ funcionaron ✅
1. Navegación a la página principal
2. Click en "Hacer un pedido"
3. Selección de barrio origen ("Centro")
4. Selección de barrio destino ("Mercedes del Norte")
5. Ingreso de direcciones
6. Ingreso de peso (25 kg)
7. Selección de transferencia ("Sí, hay transferencia")
8. Ingreso de monto ($150,000)
9. Ingreso de teléfono (3001234567)
10. Click en "Confirmar pedido"

### Pasos que FALLARON ❌
1. **Verificación de recargos de peso:** El desglose no mostró el recargo de peso ($2,000 para 25kg)
2. **Verificación de recargos de transferencia:** El desglose no mostró el recargo de transferencia ($2,000 para $150,000)
3. **Confirmación del pedido:** No se mostró pantalla de éxito porque el servidor retornó error

### Causa raíz
```
Error del servidor: La función RPC public.crear_pedido() no existe en la BD del staging.
```

Esto indica que **las migraciones de la base de datos no se han aplicado** al entorno de staging (`stargo-zeta.vercel.app`). La última migración que define `crear_pedido()` es:

`supabase/migrations/20260828000000_fix_horario_check_crear_pedido.sql`

### Acción requerida

**Aplicar todas las migraciones pendientes a la base de datos de staging:**

```bash
# Conectar a la BD del staging
supabase db push --db-url <STAGING_DATABASE_URL>

# O aplicar manualmente las migraciones
psql <STAGING_DATABASE_URL> -f supabase/migrations/20260828000000_fix_horario_check_crear_pedido.sql
```

### Migraciones pendientes identificadas
- `20260825000000_fix_constraints_rls_pendientes.sql`
- `20260826000000_fase21_base_necesaria.sql`
- `20260826000001_fase21b_protect_base_necesaria.sql`
- `20260827000000_fase22_valor_mandado.sql`
- `20260828000000_fix_horario_check_crear_pedido.sql`

### Para producción (stargo.vercel.app)

**Markdown con cambios necesarios en BD de producción:**

```markdown
## Migración de BD para producción

### Problema
La función `crear_pedido()` necesita ser actualizada para soportar:
- `p_base_necesaria` (INTEGER) - Efectivo que el domiciliario adelanta
- `p_valor_mandado` (INTEGER) - Dinero del cliente que se entrega
- Verificación de horario con `horario_hoy()`

### Solución
Ejecutar en orden las siguientes migraciones:

1. **Fase 21 - Base Necesaria:**
   ```sql
   -- Añadir columna base_necesaria a pedidos
   ALTER TABLE public.pedidos 
   ADD COLUMN IF NOT EXISTS base_necesaria INTEGER DEFAULT NULL;
   
   -- Actualizar crear_pedido()
   CREATE OR REPLACE FUNCTION public.crear_pedido(
       -- ... parámetros existentes ...
       p_base_necesaria INTEGER DEFAULT NULL
   ) RETURNS ... AS $$
   BEGIN
       -- ... lógica existente ...
       -- Insertar con base_necesaria
       INSERT INTO public.pedidos (..., base_necesaria)
       VALUES (..., p_base_necesaria);
   END;
   $$ LANGUAGE plpgsql;
   ```

2. **Fase 22 - Valor Mandado:**
   ```sql
   -- Añadir columna valor_mandado a pedidos
   ALTER TABLE public.pedidos 
   ADD COLUMN IF NOT EXISTS valor_mandado INTEGER DEFAULT NULL;
   
   -- Actualizar crear_pedido()
   -- ... (ver migración completa)
   ```

3. **Fix Horario:**
   ```sql
   -- Restaurar verificación de horario
   -- ... (ver 20260828000000_fix_horario_check_crear_pedido.sql)
   ```

### Verificación
```sql
-- Verificar que la función existe
SELECT proname, proargnames 
FROM pg_proc 
WHERE proname = 'crear_pedido';

-- Verificar columnas
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'pedidos' 
AND column_name IN ('base_necesaria', 'valor_mandado');
```
```

## Siguientes pasos

1. **Aplicar migraciones al staging** para desbloquear las pruebas
2. **Ejecutar nuevamente el test de TestSprite** después de aplicar migraciones
3. **Aplicar migraciones a producción** siguiendo el protocolo de deploy
4. **Ejecutar suite completa de TestSprite** para verificar todos los flujos

---

*Reporte generado por TestSprite CLI v0.7.0*
