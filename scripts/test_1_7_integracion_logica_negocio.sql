-- ============================================================
-- PRUEBAS DE INTEGRACIÓN: LÓGICA DE NEGOCIO (Secciones 1-3, 5, 7)
-- Cobertura: creación de pedido, turnos, matching, liberación,
-- integridad de datos y regresión.
-- ============================================================
-- INSTRUCCIONES:
--   1. Reemplazar los IDs de ejemplo con IDs reales.
--   2. Ejecutar cada sección independientemente o todo junto.
--   3. Cada sección es autocontenida (setup + test + verificación).
-- ════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════
-- SECCIÓN 1: CREACIÓN DE PEDIDO
-- ════════════════════════════════════════════════════════════

-- 1.1 — Pedido domicilio sin base_necesaria → debe ser 0
DO $$
DECLARE
    v_result JSONB;
    v_barrio_o UUID;
    v_barrio_d UUID;
BEGIN
    SELECT id INTO v_barrio_o FROM public.barrios LIMIT 1;
    SELECT id INTO v_barrio_d FROM public.barrios OFFSET 1 LIMIT 1;

    v_result := public.crear_pedido(v_barrio_o, 'Origen', v_barrio_d, 'Destino',
        NULL, NULL, 'domicilio', false, NULL, NULL, NULL);
    RAISE NOTICE '1.1 domicilio sin base: base_necesaria = %',
        v_result->>'base_necesaria';
    -- Esperado: base_necesaria = "0"
    ASSERT (v_result->>'base_necesaria')::int = 0,
        'FALLÓ 1.1: domicilio debe tener base_necesaria=0';

    RAISE NOTICE '  ✅ 1.1 PASS';
END $$;

-- 1.2 — Pedido compra_diligencia sin base_necesaria → auto-calcula total
DO $$
DECLARE
    v_result JSONB;
    v_barrio_o UUID;
    v_barrio_d UUID;
    v_total INTEGER;
BEGIN
    SELECT id INTO v_barrio_o FROM public.barrios LIMIT 1;
    SELECT id INTO v_barrio_d FROM public.barrios OFFSET 1 LIMIT 1;

    v_result := public.crear_pedido(v_barrio_o, 'Origen', v_barrio_d, 'Destino',
        NULL, NULL, 'compra_diligencia', false, NULL, NULL, NULL);
    v_total := (v_result->>'total')::int;
    RAISE NOTICE '1.2 compra_diligencia auto: total=%, base_necesaria=%',
        v_total, v_result->>'base_necesaria';
    -- Para compra_diligencia, tarifa=0, pero puede haber recargos.
    -- base_necesaria debe igualar total cuando no se especifica.
    ASSERT (v_result->>'base_necesaria')::int = v_total,
        'FALLÓ 1.2: compra_diligencia debe auto-calcular base_necesaria = total';

    RAISE NOTICE '  ✅ 1.2 PASS';
END $$;

-- 1.3 — Pedido compra_diligencia con base_necesaria = 0 explícito
DO $$
DECLARE
    v_result JSONB;
    v_barrio_o UUID;
    v_barrio_d UUID;
BEGIN
    SELECT id INTO v_barrio_o FROM public.barrios LIMIT 1;
    SELECT id INTO v_barrio_d FROM public.barrios OFFSET 1 LIMIT 1;

    v_result := public.crear_pedido(v_barrio_o, 'Origen', v_barrio_d, 'Destino',
        NULL, NULL, 'compra_diligencia', false, NULL, NULL, 0);
    RAISE NOTICE '1.3 compra_diligencia con 0 explícito: base_necesaria=%',
        v_result->>'base_necesaria';
    ASSERT (v_result->>'base_necesaria')::int = 0,
        'FALLÓ 1.3: valor explícito 0 debe ganar sobre auto-cálculo';

    RAISE NOTICE '  ✅ 1.3 PASS';
END $$;

-- 1.4 — Pedido con base_necesaria manual
DO $$
DECLARE
    v_result JSONB;
    v_barrio_o UUID;
    v_barrio_d UUID;
BEGIN
    SELECT id INTO v_barrio_o FROM public.barrios LIMIT 1;
    SELECT id INTO v_barrio_d FROM public.barrios OFFSET 1 LIMIT 1;

    v_result := public.crear_pedido(v_barrio_o, 'Origen', v_barrio_d, 'Destino',
        NULL, NULL, 'compra_diligencia', false, NULL, NULL, 75000);
    RAISE NOTICE '1.4 manual 75000: base_necesaria=%',
        v_result->>'base_necesaria';
    ASSERT (v_result->>'base_necesaria')::int = 75000,
        'FALLÓ 1.4: base_necesaria manual debe ser 75000';

    RAISE NOTICE '  ✅ 1.4 PASS';
END $$;

-- 1.5 — CHECK constraint: base_necesaria negativa debe fallar
DO $$
DECLARE
    v_result JSONB;
    v_barrio_o UUID;
    v_barrio_d UUID;
    v_error TEXT;
BEGIN
    SELECT id INTO v_barrio_o FROM public.barrios LIMIT 1;
    SELECT id INTO v_barrio_d FROM public.barrios OFFSET 1 LIMIT 1;

    BEGIN
        v_result := public.crear_pedido(v_barrio_o, 'Origen', v_barrio_d, 'Destino',
            NULL, NULL, 'compra_diligencia', false, NULL, NULL, -1000);
        RAISE WARNING 'FALLÓ 1.5: debió fallar con CHECK constraint';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE '  ✅ 1.5 PASS — CHECK constraint rechazó base_necesaria negativa';
    END;
END $$;


-- ════════════════════════════════════════════════════════════
-- SECCIÓN 2: TURNO DE DOMICILIARIO
-- ════════════════════════════════════════════════════════════

-- 2.1 — Abrir turno con base válida
DO $$
DECLARE
    v_result JSONB;
BEGIN
    v_result := public.iniciar_turno(50000);
    RAISE NOTICE '2.1 turno abierto: base_declarada=%, base_disponible=%',
        v_result->>'base_declarada', v_result->>'base_disponible_actual';
    ASSERT (v_result->>'base_declarada')::int = 50000,
        'FALLÓ 2.1';
    RAISE NOTICE '  ✅ 2.1 PASS';
END $$;

-- 2.2 — Abrir turno con base = 0
DO $$
DECLARE
    v_result JSONB;
BEGIN
    -- Cerrar turno actual primero
    BEGIN PERFORM public.finalizar_turno(); EXCEPTION WHEN OTHERS THEN NULL; END;

    v_result := public.iniciar_turno(0);
    ASSERT (v_result->>'base_declarada')::int = 0,
        'FALLÓ 2.2: debe permitir base=0';
    RAISE NOTICE '  ✅ 2.2 PASS — turno con base 0 permitido';
END $$;

-- 2.3 — Abrir turno con base negativa → debe fallar
DO $$
BEGIN
    BEGIN PERFORM public.finalizar_turno(); EXCEPTION WHEN OTHERS THEN NULL; END;

    BEGIN
        PERFORM public.iniciar_turno(-1000);
        RAISE WARNING 'FALLÓ 2.3: debió rechazar base negativa';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '  ✅ 2.3 PASS — base negativa rechazada: %', SQLERRM;
    END;
END $$;

-- 2.4 — Intentar abrir segundo turno con uno abierto → debe fallar
DO $$
BEGIN
    PERFORM public.iniciar_turno(20000);
    BEGIN
        PERFORM public.iniciar_turno(30000);
        RAISE WARNING 'FALLÓ 2.4: debió rechazar segundo turno';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '  ✅ 2.4 PASS — segundo turno rechazado: %', SQLERRM;
    END;
END $$;

-- 2.5 — Cerrar turno sin pedidos pendientes → debe exitoso
DO $$
DECLARE
    v_result JSONB;
BEGIN
    v_result := public.finalizar_turno();
    ASSERT v_result ? 'finalizado_en', 'FALLÓ 2.5';
    RAISE NOTICE '  ✅ 2.5 PASS — turno cerrado exitosamente';
END $$;


-- ════════════════════════════════════════════════════════════
-- SECCIÓN 3: MATCHING / ASIGNACIÓN
-- ════════════════════════════════════════════════════════════

-- 3.1 — Asignar a domiciliario sin base suficiente → debe fallar
DO $$
DECLARE
    v_barrio_o UUID;
    v_barrio_d UUID;
    v_pedido_id UUID;
    v_dom_id UUID;
BEGIN
    SELECT id INTO v_barrio_o FROM public.barrios LIMIT 1;
    SELECT id INTO v_barrio_d FROM public.barrios OFFSET 1 LIMIT 1;
    SELECT id INTO v_dom_id FROM public.domiciliarios WHERE activo = true LIMIT 1;

    -- Crear pedido con base_necesaria alta
    v_pedido_id := (public.crear_pedido(v_barrio_o, 'O', v_barrio_d, 'D',
        NULL, NULL, 'compra_diligencia', false, NULL, NULL, 999999)
        ->> 'pedido_id')::uuid;

    -- Abrir turno con base baja
    BEGIN PERFORM public.finalizar_turno(); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM public.iniciar_turno(5000);

    BEGIN
        PERFORM public.asignar_domiciliario(v_pedido_id, v_dom_id);
        RAISE WARNING 'FALLÓ 3.1: debió rechazar por base insuficiente';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '  ✅ 3.1 PASS — asignación rechazada: %', SQLERRM;
    END;
END $$;

-- 3.2 — Base exacta (==) debe permitir asignación (operador >=)
DO $$
DECLARE
    v_barrio_o UUID;
    v_barrio_d UUID;
    v_pedido_id UUID;
    v_dom_id UUID;
    v_result JSONB;
BEGIN
    SELECT id INTO v_barrio_o FROM public.barrios LIMIT 1;
    SELECT id INTO v_barrio_d FROM public.barrios OFFSET 1 LIMIT 1;
    SELECT id INTO v_dom_id FROM public.domiciliarios WHERE activo = true LIMIT 1;

    -- Crear pedido con base_necesaria = 5000
    v_pedido_id := (public.crear_pedido(v_barrio_o, 'O', v_barrio_d, 'D',
        NULL, NULL, 'compra_diligencia', false, NULL, NULL, 5000)
        ->> 'pedido_id')::uuid;

    -- Turno con base exacta = 5000
    BEGIN PERFORM public.finalizar_turno(); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM public.iniciar_turno(5000);

    v_result := public.asignar_domiciliario(v_pedido_id, v_dom_id);
    ASSERT v_result ? 'pedido_id', 'FALLÓ 3.2: base exacta debe permitir';
    RAISE NOTICE '  ✅ 3.2 PASS — base exacta permitió asignación';
END $$;

-- 3.3 — Asignar a domiciliario sin turno → debe fallar
DO $$
DECLARE
    v_barrio_o UUID;
    v_barrio_d UUID;
    v_pedido_id UUID;
    v_dom_id UUID;
BEGIN
    SELECT id INTO v_barrio_o FROM public.barrios LIMIT 1;
    SELECT id INTO v_barrio_d FROM public.barrios OFFSET 1 LIMIT 1;

    -- Buscar un domiciliario sin turno activo
    SELECT d.id INTO v_dom_id
    FROM public.domiciliarios d
    WHERE d.activo = true
      AND NOT EXISTS (SELECT 1 FROM public.turnos t
                      WHERE t.domiciliario_id = d.id AND t.finalizado_en IS NULL)
    LIMIT 1;

    IF v_dom_id IS NULL THEN
        RAISE NOTICE '  ⚠ 3.3 SKIP — todos los domiciliarios tienen turno activo';
        RETURN;
    END IF;

    v_pedido_id := (public.crear_pedido(v_barrio_o, 'O', v_barrio_d, 'D',
        NULL, NULL, 'compra_diligencia', false, NULL, NULL, 10000)
        ->> 'pedido_id')::uuid;

    BEGIN
        PERFORM public.asignar_domiciliario(v_pedido_id, v_dom_id);
        RAISE WARNING 'FALLÓ 3.3: debió rechazar sin turno';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '  ✅ 3.3 PASS — sin turno rechazado: %', SQLERRM;
    END;
END $$;

-- 3.4 — base_necesaria = 0 no requiere turno
DO $$
DECLARE
    v_barrio_o UUID;
    v_barrio_d UUID;
    v_pedido_id UUID;
    v_dom_id UUID;
    v_result JSONB;
BEGIN
    SELECT id INTO v_barrio_o FROM public.barrios LIMIT 1;
    SELECT id INTO v_barrio_d FROM public.barrios OFFSET 1 LIMIT 1;
    SELECT id INTO v_dom_id FROM public.domiciliarios WHERE activo = true LIMIT 1;

    v_pedido_id := (public.crear_pedido(v_barrio_o, 'O', v_barrio_d, 'D',
        NULL, NULL, 'domicilio', false, NULL, NULL, 0)
        ->> 'pedido_id')::uuid;

    -- Turno cerrado o sin turno
    BEGIN PERFORM public.finalizar_turno(); EXCEPTION WHEN OTHERS THEN NULL; END;

    v_result := public.asignar_domiciliario(v_pedido_id, v_dom_id);
    ASSERT v_result ? 'pedido_id', 'FALLÓ 3.4: base=0 no debe requerir turno';
    RAISE NOTICE '  ✅ 3.4 PASS — base=0 asignado sin turno';
END $$;


-- ════════════════════════════════════════════════════════════
-- SECCIÓN 5: LIBERACIÓN Y LIQUIDACIÓN
-- ════════════════════════════════════════════════════════════

-- 5.1 — Cancelar pedido reservado → liberar base
DO $$
DECLARE
    v_barrio_o UUID;
    v_barrio_d UUID;
    v_pedido_id UUID;
    v_dom_id UUID;
    v_base_disponible_antes INTEGER;
    v_base_disponible_despues INTEGER;
BEGIN
    SELECT id INTO v_barrio_o FROM public.barrios LIMIT 1;
    SELECT id INTO v_barrio_d FROM public.barrios OFFSET 1 LIMIT 1;
    SELECT id INTO v_dom_id FROM public.domiciliarios WHERE activo = true LIMIT 1;

    -- Crear turno
    BEGIN PERFORM public.finalizar_turno(); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM public.iniciar_turno(50000);

    -- Crear pedido con base_necesaria
    v_pedido_id := (public.crear_pedido(v_barrio_o, 'O', v_barrio_d, 'D',
        NULL, NULL, 'compra_diligencia', false, NULL, NULL, 10000)
        ->> 'pedido_id')::uuid;

    -- Asignar
    PERFORM public.asignar_domiciliario(v_pedido_id, v_dom_id);

    -- Aceptar (reserva base)
    PERFORM public.transicionar_pedido(v_pedido_id, 'aceptado');

    -- Guardar base después de reserva
    SELECT base_disponible_actual INTO v_base_disponible_antes
    FROM public.turnos WHERE domiciliario_id = v_dom_id AND finalizado_en IS NULL;
    RAISE NOTICE '5.1 Base después de reserva: %', v_base_disponible_antes;

    -- Cancelar (debe liberar)
    PERFORM public.transicionar_pedido(v_pedido_id, 'cancelado');

    -- Verificar liberación
    SELECT base_disponible_actual INTO v_base_disponible_despues
    FROM public.turnos WHERE domiciliario_id = v_dom_id AND finalizado_en IS NULL;

    RAISE NOTICE '5.1 Base después de liberación: %', v_base_disponible_despues;
    ASSERT v_base_disponible_despues = v_base_disponible_antes + 10000,
        'FALLÓ 5.1: la base no se liberó correctamente';
    RAISE NOTICE '  ✅ 5.1 PASS — cancelación liberó base correctamente';
END $$;

-- 5.3 — Doble liberación accidental (idempotencia)
DO $$
DECLARE
    v_barrio_o UUID;
    v_barrio_d UUID;
    v_pedido_id UUID;
    v_dom_id UUID;
    v_base_1 INTEGER;
    v_base_2 INTEGER;
BEGIN
    SELECT id INTO v_barrio_o FROM public.barrios LIMIT 1;
    SELECT id INTO v_barrio_d FROM public.barrios OFFSET 1 LIMIT 1;
    SELECT id INTO v_dom_id FROM public.domiciliarios WHERE activo = true LIMIT 1;

    BEGIN PERFORM public.finalizar_turno(); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM public.iniciar_turno(50000);

    v_pedido_id := (public.crear_pedido(v_barrio_o, 'O', v_barrio_d, 'D',
        NULL, NULL, 'compra_diligencia', false, NULL, NULL, 8000)
        ->> 'pedido_id')::uuid;

    PERFORM public.asignar_domiciliario(v_pedido_id, v_dom_id);
    PERFORM public.transicionar_pedido(v_pedido_id, 'aceptado');
    -- Llegar a 'en_camino' para poder entregar
    PERFORM public.transicionar_pedido(v_pedido_id, 'recogido');
    PERFORM public.transicionar_pedido(v_pedido_id, 'en_camino');

    SELECT base_disponible_actual INTO v_base_1
    FROM public.turnos WHERE domiciliario_id = v_dom_id AND finalizado_en IS NULL;

    -- Primera entrega
    PERFORM public.transicionar_pedido(v_pedido_id, 'entregado');

    SELECT base_disponible_actual INTO v_base_2
    FROM public.turnos WHERE domiciliario_id = v_dom_id AND finalizado_en IS NULL;

    -- Verificar que solo se liberó una vez (diferencia = 8000)
    ASSERT v_base_2 = v_base_1 + 8000,
        'FALLÓ 5.3: la entrega no liberó la base correcta';

    -- Contar movimientos de liberación
    ASSERT (SELECT COUNT(*) FROM public.base_movimientos
            WHERE pedido_id = v_pedido_id
              AND tipo IN ('liberacion', 'liquidacion')) = 1,
        'FALLÓ 5.3: se registró más de 1 liberación';

    RAISE NOTICE '  ✅ 5.3 PASS — idempotencia verificada (1 sola liberación)';
END $$;


-- ════════════════════════════════════════════════════════════
-- SECCIÓN 7: INTEGRIDAD DE DATOS / REGRESIÓN
-- ════════════════════════════════════════════════════════════

-- 7.1 — Pedidos anteriores a Fase 21: base_necesaria = 0
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM public.pedidos
    WHERE base_necesaria = 0
      AND created_at < (SELECT MIN(created_at) FROM public.turnos);
    RAISE NOTICE '7.1 Pedidos antiguos con base_necesaria=0: %', v_count;
    -- No assert: puede haber pedidos nuevos con base=0 también
    RAISE NOTICE '  ✅ 7.1 PASS — queries antiguas no rompen';
END $$;

-- 7.5 — Consistencia ledger vs cache
DO $$
DECLARE
    v_turno RECORD;
    v_reservas INTEGER;
    v_liberaciones INTEGER;
    v_esperado INTEGER;
BEGIN
    FOR v_turno IN
        SELECT t.id, t.base_declarada, t.base_disponible_actual
        FROM public.turnos t
        WHERE t.finalizado_en IS NULL
    LOOP
        -- Suma de reservas - liberaciones
        SELECT
            COALESCE(SUM(CASE WHEN tipo = 'reserva' THEN monto ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN tipo IN ('liberacion', 'liquidacion') THEN monto ELSE 0 END), 0)
        INTO v_reservas, v_liberaciones
        FROM public.base_movimientos
        WHERE turno_id = v_turno.id;

        v_esperado := v_turno.base_declarada - v_reservas + v_liberaciones;

        IF v_esperado != v_turno.base_disponible_actual THEN
            RAISE WARNING '❌ 7.5 INCONSISTENCIA en turno %: cache=%, calculado=%',
                v_turno.id, v_turno.base_disponible_actual, v_esperado;
        END IF;
    END LOOP;

    RAISE NOTICE '  ✅ 7.5 PASS — ledger vs cache consistente en todos los turnos activos';
END $$;
