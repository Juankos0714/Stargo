-- ============================================================
-- StarGo · Fase 21b — Proteger base_necesaria post-asignación
-- ============================================================
-- Bug: sin este trigger, un admin podría reducir base_necesaria
-- de un pedido ya asignado/aceptado, dejando al domiciliario
-- con menos efectivo del que necesita para comprar en el local.
--
-- Regla: base_necesaria solo es editable mientras el pedido está
-- en estado 'pendiente'. Una vez asignado, aceptado, recogido,
-- en_camino o entregado, queda congelado.
-- ============================================================

-- Función del trigger
CREATE OR REPLACE FUNCTION public.protected_base_necesaria()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Si no se está cambiando base_necesaria, no干预
    IF NEW.base_necesaria IS NOT DISTINCT FROM OLD.base_necesaria THEN
        RETURN NEW;
    END IF;

    -- Solo permitir cambios cuando el pedido está pendiente
    IF OLD.estado != 'pendiente' THEN
        RAISE EXCEPTION
            'No se puede modificar base_necesaria de un pedido en estado «%». '
            'Solo editable cuando el pedido está pendiente.',
            OLD.estado;
    END IF;

    RETURN NEW;
END;
$$;

-- Trigger BEFORE UPDATE en pedidos
DROP TRIGGER IF EXISTS trg_protected_base_necesaria ON public.pedidos;
CREATE TRIGGER trg_protected_base_necesaria
    BEFORE UPDATE OF base_necesaria ON public.pedidos
    FOR EACH ROW
    EXECUTE FUNCTION public.protected_base_necesaria();
