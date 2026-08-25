# Planes de TestSprite — Verificación de Recargos

## Estructura de recargos en la BD

### Peso (selecciona automáticamente según kg)
| Código | Nombre | Valor | Rango |
|--------|--------|-------|-------|
| `sin_peso` | Entre 1 a 15 kg | $0 | 0-15 kg |
| `peso_mas_20kg` | Entre 16 a 30 kg | $2.000 | 16-30 kg |
| `peso_mas_40kg` | Entre 31 a 45 kg | $5.000 | 31-45 kg |
| `peso_mas_60kg` | Entre 46 a 60 kg | $10.000 | 46+ kg |

### Transferencia (selecciona automáticamente según monto)
| Código | Nombre | Valor | Rango |
|--------|--------|-------|-------|
| `transferencia_100k` | Más de $100.000 | $2.000 | $100k-$500k |
| `transferencia_500k` | Más de $500.000 | $4.000 | $500k-$1M |
| `transferencia_1m` | Superior a $1.000.000 | $6.000 | >$1M |

### Tarifa base (mismo sector)
- Centro → Centro: $5.000

## Planes de test creados

### 1. `domicilio-peso-10kg-sin-transferencia.plan.json`
**Escenario:** Peso ligero sin transferencia
- Peso: 10 kg → `sin_peso` = $0 (no debería mostrar recargo)
- Transferencia: No
- **Esperado:** Total = $5.000 (solo tarifa base)

### 2. `domicilio-peso-25kg-transferencia-150k.plan.json`
**Escenario:** Peso medio con transferencia
- Peso: 25 kg → `peso_mas_20kg` = $2.000
- Transferencia: $150.000 → `transferencia_100k` = $2.000
- **Esperado:** Total = tarifa base + $2.000 + $2.000

### 3. `domicilio-peso-50kg-transferencia-600k.plan.json`
**Escenario:** Peso pesado con transferencia alta
- Peso: 50 kg → `peso_mas_40kg` = $5.000
- Transferencia: $600.000 → `transferencia_500k` = $4.000
- **Esperado:** Total = tarifa base + $5.000 + $4.000

### 4. `domicilio-peso-70kg-transferencia-1m5.plan.json`
**Escenario:** Peso máximo con transferencia máxima
- Peso: 70 kg → `peso_mas_60kg` = $10.000
- Transferencia: $1.500.000 → `transferencia_1m` = $6.000
- **Esperado:** Total = tarifa base + $10.000 + $6.000

## Lógica de selección automática

El código `sincronizarRecargos()` selecciona automáticamente el recargo correcto:

```javascript
// Peso
if (peso > 60) codigoPeso = 'peso_mas_60kg';
else if (peso > 40) codigoPeso = 'peso_mas_40kg';
else if (peso > 20) codigoPeso = 'peso_mas_20kg';
else codigoPeso = 'sin_peso';

// Transferencia
if (monto > 1000000) codigoTransfer = 'transferencia_1m';
else if (monto > 500000) codigoTransfer = 'transferencia_500k';
else if (monto > 100000) codigoTransfer = 'transferencia_100k';
```

## Ejecutar los tests

```bash
# Ejecutar un plan específico
testsprite test create --project a99ea0ab-f34d-4275-b2a2-5d83404bf0ef \
  --type frontend \
  --plan-from .testsprite/plans/domicilio-peso-25kg-transferencia-150k.plan.json \
  --run --wait --output json

# Ejecutar todos los planes
for plan in .testsprite/plans/*.plan.json; do
  testsprite test create --project a99ea0ab-f34d-4275-b2a2-5d83404bf0ef \
    --type frontend --plan-from "$plan" --run --wait --output json
done
```

## Nota importante

Estos tests solo pasarán **después de que los cambios de código se desplieguen** a `stargo-zeta.vercel.app`. El código actual en el servidor no tiene la lógica de selección automática de recargos.
