-- ============================================================
-- PRUEBA DE CONCURRENCIA 4.3
-- Un mismo domiciliario acepta 10 pedidos simultáneamente
-- donde la suma de base_necesaria puede exceder su base.
-- Solo los que quepan deben reservarse; el resto debe fallar.
-- base_disponible_actual NUNCA debe quedar negativo.
-- ============================================================
-- INSTRUCCIONES:
--   1. Reemplazar IDs de ejemplo con IDs reales.
--   2. Ajustar la cantidad de pedidos y base_necesaria según tu escenario.
--   3. Ejecutar TODO el script de una vez (usa transacciones anidadas).
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- SETUP
-- ════════════════════════════════════════════════════════════

-- IDs de prueba (REEMPLAZAR)
-- \set dom_id 'UUID_DOMICILIARIO'

-- Crear turno con base de 25000
-- (Si ya tiene turno abierto, cerrarlo primero o ajustar)
DO $$
DECLARE
    v_turno RECORD;
BEGIN
    SELECT * INTO v_turno FROM public.turnos
    WHERE domiciliario_id = :'dom_id'::uuid AND finalizado_en IS NULL;
    IF v_turno IS NOT NULL THEN
        RAISE NOTICE 'Ya hay turno abierto, cerrando...';
        PERFORM public.finalizar_turno();
    END IF;
END $$;

SELECT public.iniciar_turno(25000);
SELECT public.turno_activo();
-- Esperado: base_declarada=25000, base_disponible_actual=25000

-- ════════════════════════════════════════════════════════════
-- CREAR 10 PEDIDOS DE PRUEBA CON base_necesaria = 3000
-- (Cada uno costo 3000, 10 × 3000 = 30000 > 25000)
-- Solo 8 deben poder reservarse (8 × 3000 = 24000 ≤ 25000)
-- ════════════════════════════════════════════════════════════

-- Requiere que existan al menos dos barrios válidos.
-- Ajustar los UUIDs de barrios según tu BD.
DO $$
DECLARE
    v_barrio_origen UUID;
    v_barrio_destino UUID;
    v_pedido_id UUID;
    v_barrios RECORD;
    i INTEGER;
    v_exitosos INTEGER := 0;
    v_fallidos INTEGER := 0;
    v_pedidos UUID[];
BEGIN
    -- Obtener dos barrios válidos para crear pedidos
    SELECT id INTO v_barrio_origen FROM public.barrios LIMIT 1;
    SELECT id INTO v_barrio_destino FROM public.barrios OFFSET 1 LIMIT 1;

    IF v_barrio_origen IS NULL OR v_barrio_destino IS NULL THEN
        RAISE EXCEPTION 'Se necesitan al menos 2 barrios en la BD para esta prueba';
    END IF;

    RAISE NOTICE 'Creando 10 pedidos de compra_diligencia con base_necesaria = 3000...';

    FOR i IN 1..10 LOOP
        -- Crear pedido como compra_diligencia (tarifa=0, base_necesaria=3000 manual)
        v_pedido_id := (
            SELECT (public.crear_pedido(
                v_barrio_origen,
                'Direccion origen ' || i,
                v_barrio_destino,
                'Direccion destino ' || 11 - i,
                'Pedido prueba 4.3 #' || i,
                NULL,
                'compra_diligencia',
                false,
                '300000' || LPAD(i::text, 2, '0'),
                'Cliente prueba ' || i,
                3000  -- base_necesaria manual
            ) ->> 'pedido_id')::uuid
        );

        IF v_pedido_id IS NOT NULL THEN
            v_pedidos[i] := v_pedido_id;

            -- Asignar al domiciliario de prueba
            BEGIN
                PERFORM public.asignar_domiciliario(v_pedido_id, :'dom_id'::uuid);
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'No se pudo asignar pedido #%: %', i, SQLERRM;
            END;
        END IF;
    END LOOP;

    RAISE NOTICE 'Pedidos creados. Intentando aceptar los 10...';

    -- Intentar aceptar todos en secuencia (simula concurrencia)
    FOR i IN 1..10 LOOP
        IF v_pedidos[i] IS NOT NULL THEN
            BEGIN
                PERFORM public.transicionar_pedido(v_pedidos[i], 'aceptado');
                v_exitosos := v_exitosos + 1;
                RAISE NOTICE '✅ Pedido #% ACCEPTED (%/10)', i, v_exitosos;
            EXCEPTION WHEN OTHERS THEN
                v_fallidos := v_fallidos + 1;
                RAISE NOTICE '❌ Pedido #% REJECTED: %', i, SQLERRM;
            END;
        END IF;
    END LOOP;

    RAISE NOTICE '';
    RAISE NOTICE '═══════════════════════════════════════';
    RAISE NOTICE '  RESULTADO: % exitosos, % fallidos', v_exitosos, v_fallidos;
    RAISE NOTICE '═══════════════════════════════════════';
END $$;

-- ════════════════════════════════════════════════════════════
-- VERIFICACIÓN DE INTEGRIDAD
-- ════════════════════════════════════════════════════════════

-- 1) Movimientos de reserva: solo los exitosos
SELECT tipo, COUNT(*) AS cantidad, SUM(monto) AS total
FROM public.base_movimientos bm
JOIN public.turnos t ON t.id = bm.turno_id
WHERE t.domiciliario_id = :'dom_id'::uuid
  AND bm.tipo = 'reserva'
GROUP BY bm.tipo;
-- Esperado: tipo='reserva', cantidad = exitosos, total = exitosos × 3000

-- 2) Base disponible nunca negativa
SELECT id, base_declarada, base_disponible_actual,
       base_declarada - base_disponible_actual AS reservado_total
FROM public.turnos
WHERE domiciliario_id = :'dom_id'::uuid AND finalizado_en IS NULL;
-- Esperado: base_disponible_actual >= 0, reservado_total = exitosos × 3000

-- 3) Consistencia: suma de reservas = base_declarada - base_disponible_actual
WITH reservas AS (
    SELECT SUM(monto) AS total_reservas
    FROM public.base_movimientos bm
    JOIN public.turnos t ON t.id = bm.turno_id
    WHERE t.domiciliario_id = :'dom_id'::uuid
      AND t.finalizado_en IS NULL
      AND bm.tipo = 'reserva'
),
turno AS (
    SELECT base_declarada, base_disponible_actual
    FROM public.turnos
    WHERE domiciliario_id = :'dom_id'::uuid AND finalizado_en IS NULL
)
SELECT
    r.total_reservas,
    t.base_disponible_actual,
    t.base_declarada,
    CASE WHEN r.total_reservas = (t.base_declarada - t.base_disponible_actual)
         THEN '✅ CONSISTENTE'
         ELSE '❌ INCONSISTENTE — ledger y cache no cuadran!'
    END AS verificacion
FROM reservas r, turno t;

-- 4) No existe base negativa en ningún turno (CHECK constraint)
SELECT COUNT(*) AS turnos_negativos
FROM public.turnos WHERE base_disponible_actual < 0;
-- Esperado: 0

-- 5) Detalle de cada pedido aceptado
SELECT p.numero, p.base_necesaria, p.estado,
       bm.tipo, bm.monto, bm.created_at
FROM public.pedidos p
LEFT JOIN public.base_movimientos bm ON bm.pedido_id = p.id AND bm.tipo = 'reserva'
WHERE p.domiciliario_id = :'dom_id'::uuid
  AND p.base_necesaria > 0
ORDER BY p.created_at DESC;
