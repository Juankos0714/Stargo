# Resumen de Integración — Rediseño Compras/Diligencias

**Fecha:** 23 de agosto de 2026
**Estado:** Frontend implementado. Backend sin cambios.

---

## 1. Qué se hizo (Fase 21b + Rediseño UI)

### 1.1 Fase 21 — Base Necesaria (ya estaba implementada)
- Campo `base_necesaria` en tabla `pedidos` (INTEGER, DEFAULT 0)
- Campo visible en formulario de nuevo pedido como **Paso 4** independiente
- Se muestra SIEMPRE (domicilio y compra_diligencia)
- Validación en BD: `CHECK (base_necesaria >= 0)`
- Trigger: `protected_base_necesaria()` impide modificar después de asignado

### 1.2 Rediseño del formulario de Compras/Diligencias (nuevo)
- Selección de tipo de diligencia con **5 radio cards**
- Formulario **dinámico** con campos específicos por tipo
- Separación clara entre **"valor a pagar/comprar"** y **"costo de la diligencia"**
- Campos irrelevantes (ej. peso) se ocultan según el tipo seleccionado
- Datos empaquetados en `observaciones` como texto estructurado

---

## 2. Estructura del formulario actual

```
┌─────────────────────────────────────────┐
│ PASO 0: ¿Qué necesitas?                 │
│  ○ Domicilio normal                      │
│  ○ Compra / diligencia                   │
└─────────────────────────────────────────┘

Cuando selecciona "Compra / diligencia":

┌─────────────────────────────────────────┐
│ ¿Qué tipo de diligencia necesitas?      │
│  ○ Pago de factura o servicio            │
│  ○ Pago bancario o corresponsal          │
│  ○ Compra de productos                   │
│  ○ Trámite o documento                   │
│  ○ Otra diligencia                       │
├─────────────────────────────────────────┤
│ ¿Se debe recoger algo o a alguien?      │
│  [Sí, hay recogida]  [No, solo destino] │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ PASO 2: Destino                          │
│  Barrio de destino + Dirección           │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ PASO 3: Recargos (obligatorio)           │
│  [No aplica]  +  opciones disponibles    │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ DATOS DE LA DILIGENCIA (dinámico)        │
│  ← Cambia según tipo seleccionado        │
│  ← Ver sección 3 para detalle            │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ OBSERVACIONES (opcional)                 │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ TUS DATOS                                │
│  Nombre (opcional) + Celular (obligat.) │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ PASO 4: BASE NECESARIA                   │
│  Monto a adelantar (COP)                 │
│  [Usar total estimado]                   │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ RESUMEN: Tarifa del trayecto             │
│  Tarifa base + Recargos = Total          │
│  [Confirmar pedido]                      │
└─────────────────────────────────────────┘
```

---

## 3. Campos específicos por tipo de diligencia

### 3.1 Pago de factura o servicio (`pago`)
| Campo | Tipo | Obligatorio |
|-------|------|-------------|
| Descripción | text | Sí |
| Valor de la factura | number ($) | Sí |
| Costo de la diligencia | number ($) | Sí |

### 3.2 Pago bancario o corresponsal (`banco`)
| Campo | Tipo | Obligatorio |
|-------|------|-------------|
| Entidad / banco | text | Sí |
| Descripción del pago | text | Sí |
| Valor a pagar | number ($) | Sí |
| Costo de la diligencia | number ($) | Sí |

### 3.3 Compra de productos (`compra`)
| Campo | Tipo | Obligatorio |
|-------|------|-------------|
| Productos / descripción | textarea | Sí |
| Cantidad | text | No |
| Presupuesto / valor estimado | number ($) | No |
| Costo de la diligencia | number ($) | Sí |

### 3.4 Trámite o documento (`tramite`)
| Campo | Tipo | Obligatorio |
|-------|------|-------------|
| ¿Qué trámite necesitas? | text | Sí |
| Descripción / instrucciones | textarea | Sí |
| Lugar del trámite | text | No |
| Costo de la diligencia | number ($) | Sí |

### 3.5 Otra diligencia (`otro`)
| Campo | Tipo | Obligatorio |
|-------|------|-------------|
| Describe la diligencia | textarea | Sí |
| Instrucciones adicionales | textarea | No |
| Costo de la diligencia | number ($) | Sí |

---

## 4. Variables de estado nuevas (Frontend)

```typescript
// Tipo de diligencia seleccionado
let tipoDiligencia = $state('');

// Campos específicos por tipo
let dilDescripcion = $state('');       // pago, banco
let dilValorFactura = $state('');      // pago, banco (valor a pagar)
let dilCostoDiligencia = $state('');   // TODOS los tipos (costo del servicio)
let dilEntidad = $state('');           // banco
let dilProductos = $state('');         // compra
let dilCantidad = $state('');          // compra
let dilPresupuesto = $state('');       // compra
let dilTramite = $state('');           // tramite
let dilInstrucciones = $state('');     // tramite, otro
let dilLugarTramite = $state('');      // tramite
let dilOtraDescripcion = $state('');   // otro
```

---

## 5. Formato de `observaciones` en la BD

Los datos se empaquetan como **texto estructurado** en el campo `observaciones` existente. **No se crearon columnas nuevas.**

### Ejemplo: Pago de factura
```
[DILIGENCIA: Pago de factura o servicio]
Descripción: Pago de factura de luz EPM
Valor a pagar: $85000
Costo diligencia: $5000
```

### Ejemplo: Compra de productos
```
[DILIGENCIA: Compra de productos]
Productos: 2 paquetes de arroz, 1 leche, 1 medicamento Paracetamol
Cantidad: 4 artículos
Presupuesto: $50000
Costo diligencia: $8000
```

### Ejemplo: Pago bancario
```
[DILIGENCIA: Pago bancario o corresponsal]
Entidad: Bancolombia
Descripción: Consignación de arriendo
Valor a pagar: $150000
Costo diligencia: $12000
```

### Ejemplo: Trámite
```
[DILIGENCIA: Trámite o documento]
Trámite: Radicar certificado de residencia
Instrucciones: Llevar cédula original y fotocopia, radicar en ventanilla 3
Lugar: Alcaldía de Armenia
Costo diligencia: $10000
```

### Ejemplo: Otra diligencia
```
[DILIGENCIA: Otra diligencia]
Detalle: Recoger un paquete en laarrera 15 # 20-30
Instrucciones: Llamar al 3001234567 al llegar
Costo diligencia: $7000
```

---

## 6. Función `empaquetarObservaciones()`

Ubicación: `src/routes/nuevo-pedido/+page.svelte`, línea ~283

```typescript
function empaquetarObservaciones(): string {
  const parts: string[] = [];
  if (tipoServicio === 'compra_diligencia' && tipoDiligencia) {
    parts.push(`[DILIGENCIA: ${TIPOS_DILIGENCIA.find((t) => t.valor === tipoDiligencia)?.label ?? tipoDiligencia}]`);
  }
  if (dilDescripcion.trim()) parts.push(`Descripción: ${dilDescripcion.trim()}`);
  if (dilEntidad.trim()) parts.push(`Entidad: ${dilEntidad.trim()}`);
  if (dilValorFactura.trim()) parts.push(`Valor a pagar: $${dilValorFactura.trim()}`);
  if (dilCostoDiligencia.trim()) parts.push(`Costo diligencia: $${dilCostoDiligencia.trim()}`);
  if (dilProductos.trim()) parts.push(`Productos: ${dilProductos.trim()}`);
  if (dilCantidad.trim()) parts.push(`Cantidad: ${dilCantidad.trim()}`);
  if (dilPresupuesto.trim()) parts.push(`Presupuesto: $${dilPresupuesto.trim()}`);
  if (dilTramite.trim()) parts.push(`Trámite: ${dilTramite.trim()}`);
  if (dilInstrucciones.trim()) parts.push(`Instrucciones: ${dilInstrucciones.trim()}`);
  if (dilLugarTramite.trim()) parts.push(`Lugar: ${dilLugarTramite.trim()}`);
  if (dilOtraDescripcion.trim()) parts.push(`Detalle: ${dilOtraDescripcion.trim()}`);
  if (observaciones.trim()) parts.push(observaciones.trim());
  return parts.join('\n');
}
```

---

## 7. Backend — Sin cambios

### API `POST /api/pedidos`
- No recibe campos nuevos
- `observaciones` se envía como string libre (ya existente)
- `base_necesaria` se envía como number (ya existente)

### RPC `crear_pedido()`
- Sin cambios en la migración
- `observaciones` y `base_necesaria` ya son parámetros del RPC

### Columnas afectadas (solo lectura)
```sql
-- Ya existen de la Fase 21
ALTER TABLE pedidos ADD COLUMN base_necesaria INTEGER NOT NULL DEFAULT 0;
-- observaciones ya existía desde la Fase 1
```

---

## 8. Archivos modificados

| Archivo | Cambios |
|---------|---------|
| `src/routes/nuevo-pedido/+page.svelte` | Nuevo formulario dinámico, radio cards, campos específicos por tipo, función `empaquetarObservaciones()` |
| `src/lib/types.ts` | Sin cambios (TIPOS_DILIGENCIA está definido en el componente) |
| `src/lib/logic/validacion.ts` | Sin cambios |
| `src/routes/api/pedidos/+server.ts` | Sin cambios |

---

## 9. Lo que FALTA por implementar

### 9.1 Parsing de `observaciones` en el panel admin
El admin ve el campo `observaciones` como texto libre. Para mostrarlo estructurado:

```typescript
// Función para parsear observaciones estructuradas
function parsearObservaciones(obs: string | null): {
  tipo: string | null;
  campos: Record<string, string>;
} {
  if (!obs) return { tipo: null, campos: {} };
  const campos: Record<string, string> = {};
  let tipo: string | null = null;
  
  for (const linea of obs.split('\n')) {
    const matchTipo = linea.match(/^\[DILIGENCIA:\s*(.+?)\]$/);
    if (matchTipo) { tipo = matchTipo[1]; continue; }
    const idx = linea.indexOf(': ');
    if (idx > 0) {
      campos[linea.slice(0, idx)] = linea.slice(idx + 2);
    }
  }
  return { tipo, campos };
}
```

### 9.2 Vista del domiciliario
El domiciliario debería ver los datos de la diligence al aceptar un pedido. Opciones:
- Mostrar `observaciones` parseado en la vista del pedido
- Crear un componente `DetalleDiligencia.svelte` que parsee y renderice

### 9.3 WhatsApp al domiciliario
El mensaje de WhatsApp (`mensajeWhatsAppDomiciliario()`) debería incluir el tipo de diligencia y los datos relevantes. Actualmente solo incluye dirección y observaciones crudas.

### 9.4 Validación frontend condicional
Los campos obligatorios por tipo no están validados en el frontend (solo se envían vacíos). Para mejorar UX:

```typescript
function validarDiligencia(): Record<string, string> {
  const errores: Record<string, string> = {};
  if (!tipoDiligencia) {
    errores.tipoDiligencia = 'Selecciona el tipo de diligencia.';
    return errores;
  }
  
  switch (tipoDiligencia) {
    case 'pago':
      if (!dilDescripcion.trim()) errores.descripcion = 'La descripción es obligatoria.';
      if (!dilValorFactura.trim()) errores.valorFactura = 'El valor de la factura es obligatorio.';
      if (!dilCostoDiligencia.trim()) errores.costoDiligencia = 'El costo de la diligencia es obligatorio.';
      break;
    case 'banco':
      if (!dilEntidad.trim()) errores.entidad = 'La entidad es obligatoria.';
      if (!dilDescripcion.trim()) errores.descripcion = 'La descripción es obligatoria.';
      if (!dilValorFactura.trim()) errores.valorFactura = 'El valor a pagar es obligatorio.';
      if (!dilCostoDiligencia.trim()) errores.costoDiligencia = 'El costo de la diligencia es obligatorio.';
      break;
    case 'compra':
      if (!dilProductos.trim()) errores.productos = 'Los productos son obligatorios.';
      if (!dilCostoDiligencia.trim()) errores.costoDiligencia = 'El costo de la diligencia es obligatorio.';
      break;
    case 'tramite':
      if (!dilTramite.trim()) errores.tramite = 'El tipo de trámite es obligatorio.';
      if (!dilInstrucciones.trim()) errores.instrucciones = 'Las instrucciones son obligatorias.';
      if (!dilCostoDiligencia.trim()) errores.costoDiligencia = 'El costo de la diligencia es obligatorio.';
      break;
    case 'otro':
      if (!dilOtraDescripcion.trim()) errores.descripcion = 'La descripción es obligatoria.';
      if (!dilCostoDiligencia.trim()) errores.costoDiligencia = 'El costo de la diligencia es obligatorio.';
      break;
  }
  return errores;
}
```

### 9.5 Tests
- Test de integración: crear pedido compra_diligencia con tipo específico
- Test de parsing de observaciones
- Test de que domicilio normal no muestra campos de diligencia
- Actualizar `tests/ui/nuevo-pedido.test.ts`

---

## 10. Migración de pedidos existentes

**No se requiere migración.** Los pedidos existentes:
- Tienen `observaciones` en formato libre (sin `[DILIGENCIA: ...]`)
- `base_necesaria` = 0 por defecto
- El parser de `observaciones` es tolerante a formato no estructurado

Para pedidos antiguos que el admin quiera visualizar mejor:
```sql
-- Opcional: marcar pedidos viejos de compra_diligencia
UPDATE pedidos 
SET observaciones = '[DILIGENCIA: Compra de productos]' || E'\n' || observaciones
WHERE tipo_servicio = 'compra_diligencia' 
  AND observaciones NOT LIKE '[DILIGENCIA:%';
```

---

## 11. Decisiones de diseño

| Decisión | Razón |
|----------|-------|
| Datos en `observaciones` (no columnas nuevas) | Evitar migraciones BD, mantener compatibilidad |
| Texto estructurado con prefijos `[DILIGENCIA: X]` | Parseable pero legible sin herramientas |
| `base_necesaria` separado del costo de diligence | `base_necesaria` = efectivo que adelanta el domiciliario; costo diligence = lo que cobra StarGo |
| Formulario dinámico por radio cards | UX: no mostrar campos irrelevantes |
| Validación frontend condicional | UX: guiar al usuario según tipo seleccionado |

---

## 12. Próximos pasos recomendados

1. **Parsing en panel admin** — Mostrar datos estructurados en la vista de pedidos
2. **Componente `DetalleDiligencia.svelte`** — Reutilizable en admin y domiciliario
3. **Validación frontend** — Campos obligatorios por tipo
4. **WhatsApp mejorado** — Incluir tipo de diligence y datos clave
5. **Tests** — Cobertura del nuevo flujo
6. **Commit** — Agrupar cambios en un solo commit descriptivo
