-- ============================================================
-- PRUEBA DE CONCURRENCIA 4.5 (STRESS TEST)
-- 20 requests concurrentes de aceptación sobre el MISMO pedido.
-- Solo 1 debe ganar exactamente. Verificar integridad total.
-- ============================================================
-- INSTRUCCIONES:
--   1. Reemplazar IDs de ejemplo.
--   2. Ejecutar SETUP, luego el BUCLE, luego la VERIFICACIÓN.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- SETUP
-- ════════════════════════════════════════════════════════════

-- \set pedido_id 'UUID_DEL_PEDIDO'
-- \set dom_id    'UUID_DOMICILIARIO'

-- Resetear el pedido a pendiente
UPDATE public.pedidos
SET estado = 'pendiente', domiciliario_id = NULL
WHERE id = :'pedido_id';

-- Asegurar turno activo con base suficiente
DO $$
DECLARE
    v_turno RECORD;
BEGIN
    SELECT * INTO v_turno FROM public.turnos
    WHERE domiciliario_id = :'dom_id'::uuid AND finalizado_en IS NULL;
    IF v_turno IS NOT NULL THEN
        PERFORM public.finalizar_turno();
    END IF;
END $$;

SELECT public.iniciar_turno(100000);

-- Asignar el pedido al domiciliario
SELECT public.asignar_domiciliario(:'pedido_id', :'dom_id'::uuid);

-- Verificar que está en estado 'asignado'
SELECT id, estado, domiciliario_id, base_necesaria
FROM public.pedidos WHERE id = :'pedido_id';

-- ════════════════════════════════════════════════════════════
-- BUCLE: 20 intentos de aceptación sobre el mismo pedido
-- (secuencial, pero cada uno es una transacción independiente)
-- ════════════════════════════════════════════════════════════

DO $$
DECLARE
    i INTEGER;
    v_exitosos INTEGER := 0;
    v_fallidos INTEGER := 0;
    v_mensaje TEXT;
BEGIN
    RAISE NOTICE '═══════════════════════════════════════';
    RAISE NOTICE '  STRESS TEST: 20 aceptaciones del mismo pedido';
    RAISE NOTICE '═══════════════════════════════════════';

    FOR i IN 1..20 LOOP
        BEGIN
            -- Cada llamada es una transacción diferente en PostgreSQL
            -- (Funciones PL/pgSQL son transacciones atómicas)
            PERFORM public.transicionar_pedido(:'pedido_id', 'aceptado');
            v_exitosos := v_exitosos + 1;
            RAISE NOTICE '[%] ✅ ACEPTADO (%/20 éxitos)', i, v_exitosos;
        EXCEPTION WHEN OTHERS THEN
            v_fallidos := v_fallidos + 1;
            RAISE NOTICE '[%] ❌ RECHAZADO: %', i, SQLERRM;
        END;
    END LOOP;

    RAISE NOTICE '';
    RAISE NOTICE '═══════════════════════════════════════';
    RAISE NOTICE '  RESULTADO FINAL:';
    RAISE NOTICE '    Exitosos: %', v_exitosos;
    RAISE NOTICE '    Fallidos: %', v_fallidos;
    RAISE NOTICE '═══════════════════════════════════════';

    -- Afirmación: solo 1 éxito
    IF v_exitosos != 1 THEN
        RAISE WARNING '⚠ ESPERADO 1 ÉXITO, OBTENIDO % — POSIBLE RACE CONDITION!', v_exitosos;
    ELSE
        RAISE NOTICE '✅ Correcto: exactamente 1 aceptación exitosa';
    END IF;
END $$;

-- ════════════════════════════════════════════════════════════
-- VERIFICACIÓN DE INTEGRIDAD COMPLETA
-- ════════════════════════════════════════════════════════════

-- 1) Estado del pedido: debe ser consistente
SELECT id, estado, domiciliario_id, base_necesaria
FROM public.pedidos WHERE id = :'pedido_id';
-- Esperado: estado = 'aceptado', domiciliario_id = dom_id

-- 2) Exactamente 1 reserva para este pedido (no duplicada)
SELECT COUNT(*) AS total_reservas,
       SUM(monto) AS suma_montos
FROM public.base_movimientos
WHERE pedido_id = :'pedido_id' AND tipo = 'reserva';
-- Esperado: COUNT=1, SUM = base_necesaria

-- 3) Base del turno coherente
WITH turno_info AS (
    SELECT t.id, t.base_declarada, t.base_disponible_actual
    FROM public.turnos t
    WHERE t.domiciliario_id = :'dom_id'::uuid AND t.finalizado_en IS NULL
),
reservas_info AS (
    SELECT COALESCE(SUM(monto), 0) AS total_reservas
    FROM public.base_movimientos bm
    WHERE bm.turno_id = (SELECT id FROM turno_info) AND bm.tipo = 'reserva'
)
SELECT
    t.base_declarada,
    t.base_disponible_actual,
    r.total_reservas,
    t.base_declarada - t.base_disponible_actual AS reserva_calculada,
    CASE
        WHEN t.base_disponible_actual < 0 THEN '❌ BASE NEGATIVA'
        WHEN t.base_declarada - t.base_disponible_actual = r.total_reservas THEN '✅ CONSISTENTE'
        ELSE '❌ INCONSISTENTE'
    END AS estado_integridad
FROM turno_info t, reservas_info r;

-- 4) No hay turnos con base negativa
SELECT COUNT(*) AS turnos_negativos
FROM public.turnos WHERE base_disponible_actual < 0;
-- Esperado: 0

-- 5) Historial del pedido: cuántas veces se intentó cambiar
SELECT estado, notas, created_at
FROM public.historial_estados
WHERE pedido_id = :'pedido_id'
ORDER BY created_at;
-- Esperado: 1 creación + 1 asignación + 1 aceptación (no más)

-- 6) Auditoría completa del turno
SELECT bm.tipo, bm.monto, bm.notas, bm.created_at
FROM public.base_movimientos bm
JOIN public.turnos t ON t.id = bm.turno_id
WHERE t.domiciliario_id = :'dom_id'::uuid
ORDER BY bm.created_at;
