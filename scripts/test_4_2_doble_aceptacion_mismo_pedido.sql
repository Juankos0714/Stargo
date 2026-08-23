-- ============================================================
-- PRUEBA DE CONCURRENCIA 4.2
-- Dos domiciliarios aceptan el mismo pedido simultáneamente
-- Solo uno debe ganar; el otro debe recibir error claro.
-- ============================================================
-- INSTRUCCIONES:
--   1. Reemplazar los IDs de ejemplo con IDs reales de tu BD.
--   2. Ejecutar la sección SETUP primero.
--   3. Abrir DOS psql o DOS pestañas del SQL Editor de Supabase.
--   4. Ejecutar la Sentencia A en una y la Sentencia B en la otra
--      casi simultáneamente (realmente en paralelo).
--   5. Ejecutar la VERIFICACIÓN.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- SETUP — Crear entorno de prueba
-- ════════════════════════════════════════════════════════════

-- IDs de prueba (REEMPLAZAR con valores reales)
-- \set pedido_id 'UUID_DEL_PEDIDO'
-- \set dom1_id   'UUID_DOMICILIARIO_1'
-- \set dom2_id   'UUID_DOMICILIARIO_2'

-- Asegurar que el pedido esté en estado 'pendiente'
UPDATE public.pedidos
SET estado = 'pendiente', domiciliario_id = NULL
WHERE id = :'pedido_id';

-- Asignar el pedido al domiciliario 1 (estado = 'asignado')
SELECT public.asignar_domiciliario(:'pedido_id', :'dom1_id');

-- Verificar estado inicial
SELECT id, estado, domiciliario_id, base_necesaria
FROM public.pedidos WHERE id = :'pedido_id';
-- Esperado: estado='asignado', domiciliario_id=dom1_id

-- Asegurar que ambos domiciliarios tengan turnos activos con base suficiente
-- (iniciar_turno es idempotent: falla si ya hay turno abierto, ignorar en ese caso)
DO $$
BEGIN
    PERFORM public.iniciar_turno(100000);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════
-- SENTENCIA A — Ejecutar en Terminal 1
-- (Domiciliario 1 acepta el pedido)
-- ════════════════════════════════════════════════════════════

-- SELECT public.transicionar_pedido(:'pedido_id', 'aceptado');

-- ════════════════════════════════════════════════════════════
-- SENTENCIA B — Ejecutar en Terminal 2 (simultáneamente)
-- (Domiciliario 2 también intenta aceptar el mismo pedido)
-- Nota: esto requiere que dom2 también sea domiciliario_id del pedido,
-- o que se use admin role. En la práctica, solo el domiciliario asignado
-- puede aceptar, así que esta sentencia FALLARÁ por permisos.
-- Para simular el race real, usaremos transacciones anidadas:
-- ════════════════════════════════════════════════════════════

-- Versión alternativa: reasignar a dom2 y que ambos acepten
-- (solo funciona si dom2 puede aceptar)

-- ════════════════════════════════════════════════════════════
-- VERIFICACIÓN — Ejecutar después de ambas sentencias
-- ════════════════════════════════════════════════════════════

-- 1) Estado del pedido: debe tener un solo estado, no inconsistente
SELECT id, estado, domiciliario_id, base_necesaria
FROM public.pedidos WHERE id = :'pedido_id';
-- Esperado: estado = 'entregado' o 'aceptado' (consistente, no corrupto)

-- 2) Movimientos de reserva: solo debe haber 1 reserva, no duplicada
SELECT COUNT(*) AS reservas,
       SUM(monto) AS total_reservado
FROM public.base_movimientos
WHERE pedido_id = :'pedido_id' AND tipo = 'reserva';
-- Esperado: COUNT=1, SUM = base_necesaria del pedido

-- 3) Base disponible del turno: debe ser coherente
-- (base_declarada - total_reservas_activas)
SELECT t.base_declarada,
       t.base_disponible_actual,
       t.base_declarada - t.base_disponible_actual AS total_reservado
FROM public.turnos t
WHERE t.domiciliario_id = (
    SELECT domiciliario_id FROM public.pedidos WHERE id = :'pedido_id'
)
AND t.finalizado_en IS NULL;
-- Esperado: total_reservado >= 0, no excede base_declarada

-- 4) No debe haber base negativa (CHECK constraint lo previene)
SELECT id, base_disponible_actual
FROM public.turnos
WHERE base_disponible_actual < 0;
-- Esperado: 0 filas (vacío)

-- ════════════════════════════════════════════════════════════
-- VERSIÓN SIMPLIFICADA (sin terminales separadas)
-- Usa dblink para simular concurrencia real desde un solo script
-- REQUIERE: CREATE EXTENSION IF NOT EXISTS dblink;
-- ════════════════════════════════════════════════════════════

-- CREATE EXTENSION IF NOT EXISTS dblink;

-- -- Obtener la URL de conexión del proyecto
-- -- (reemplazar con tu connection string real)
-- \set connstr 'host=db.XXXXX.supabase.co port=5432 dbname=postgres user=postgres password=TU_PASSWORD'

-- -- Resetear el pedido
-- UPDATE public.pedidos
-- SET estado = 'pendiente', domiciliario_id = NULL
-- WHERE id = :'pedido_id';

-- -- Asignar al dom1
-- SELECT public.asignar_domiciliario(:'pedido_id', :'dom1_id');

-- -- Lanzar dos aceptaciones en paralelo via dblink
-- SELECT dblink_connect('conn1', :'connstr');
-- SELECT dblink_connect('conn2', :'connstr');

-- -- Terminal 1: dom1 acepta
-- SELECT dblink_send_query('conn1',
--     format('SELECT public.transicionar_pedido(%L, ''aceptado'')', :'pedido_id'));

-- -- Terminal 2: intenta aceptar el mismo pedido (debería fallar)
-- SELECT dblink_send_query('conn2',
--     format('SELECT public.transicionar_pedido(%L, ''aceptado'')', :'pedido_id'));

-- -- Esperar a que ambas terminen
-- -- (dblink es asíncrono, poll hasta que no queden resultados)
-- SELECT pg_sleep(2);

-- -- Recoger resultados
-- SELECT * FROM dblink_get_result('conn1') AS (result jsonb);
-- SELECT * FROM dblink_get_result('conn2') AS (result jsonb);

-- SELECT dblink_disconnect('conn1');
-- SELECT dblink_disconnect('conn2');

-- -- Verificar
-- SELECT COUNT(*) FROM base_movimientos
-- WHERE pedido_id = :'pedido_id' AND tipo = 'reserva';
