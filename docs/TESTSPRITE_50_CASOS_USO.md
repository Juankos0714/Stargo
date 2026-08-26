# StarGo — 50+ Casos de Uso para TestSprite

## Resumen
Estos 50+ casos de uso cubren los flujos principales del aplicativo StarGo:
- Páginas públicas (home, login, consultar estado, calculadora)
- Flujo de pedido (domicilio, compra/diligencia)
- Panel de administración
- Vistas del domiciliario

---

## 1. PÁGINA PRINCIPAL (HOME)

### Caso 1: Home carga correctamente
```
Navigate to https://stargo-zeta.vercel.app
Assert: Page title contains "StarGo"
Assert: Page shows "Domicilios en Armenia"
Assert: Navigation links are visible
```

### Caso 2: Home muestra horario de atención
```
Navigate to https://stargo-zeta.vercel.app
Assert: Page shows "Atendemos hoy" or "Estamos fuera de horario"
```

### Caso 3: Navegación a Nuevo Pedido
```
Navigate to https://stargo-zeta.vercel.app
Click on "Hacer un pedido" link
Assert: Page navigates to /nuevo-pedido
Assert: Page shows "Hacer un pedido" heading
```

### Caso 4: Navegación a Consultar Estado
```
Navigate to https://stargo-zeta.vercel.app
Click on "Consultar estado" link
Assert: Page navigates to /consultar-estado
Assert: Page shows input for order code
```

---

## 2. NUEVO PEDIDO — SELECCIÓN DE TIPO

### Caso 5: Paso 0 muestra 6 opciones de servicio
```
Navigate to https://stargo-zeta.vercel.app/nuevo-pedido
Assert: Page shows step 0 "¿Qué necesitas?"
Assert: 6 buttons are visible: Domicilio normal, Pago de factura, Pago bancario, Compra, Trámite, Otra
```

### Caso 6: Selección de Domicilio normal
```
Navigate to https://stargo-zeta.vercel.app/nuevo-pedido
Click on "Domicilio normal"
Assert: Button is highlighted
Assert: Form shows origin and destination fields
Assert: Step 3 shows "Detalles del pedido" with peso and transferencia fields
```

### Caso 7: Selección de Pago de factura
```
Navigate to https://stargo-zeta.vercel.app/nuevo-pedido
Click on "Pago de factura o servicio"
Assert: Button is highlighted
Assert: Form shows "¿Se debe recoger algo?" question
Assert: Step A shows "Datos de la diligencia" with description and value fields
```

### Caso 8: Selección de Pago bancario
```
Navigate to https://stargo-zeta.vercel.app/nuevo-pedido
Click on "Pago bancario o corresponsal"
Assert: Button is highlighted
Assert: Form shows entity/bank field and description field
```

### Caso 9: Selección de Compra
```
Navigate to https://stargo-zeta.vercel.app/nuevo-pedido
Click on "Compra de productos"
Assert: Button is highlighted
Assert: Form shows products/description textarea
```

### Caso 10: Selección de Trámite
```
Navigate to https://stargo-zeta.vercel.app/nuevo-pedido
Click on "Trámite o documento"
Assert: Button is highlighted
Assert: Form shows trámite input and instructions textarea
```

### Caso 11: Selección de Otra diligencia
```
Navigate to https://stargo-zeta.vercel.app/nuevo-pedido
Click on "Otra diligencia"
Assert: Button is highlighted
Assert: Form shows description textarea
```

---

## 3. NUEVO PEDIDO — DOMICILIO NORMAL

### Caso 12: Domicilio — Peso 10kg sin transferencia (sin recargos)
```
Navigate to /nuevo-pedido
Click "Domicilio normal"
Select origin: Centro
Select destination: Centro
Enter origin direction: "Calle 10 # 15-20"
Enter destination direction: "Carrera 5 # 10-15"
Enter peso: "10"
Click "No hay transferencia"
Enter telefono: "3001234567"
Assert: Price shows "Tarifa base" with $5.000
Assert: Total shows $5.000 (no recargos)
```

### Caso 13: Domicilio — Peso 25kg + transferencia $150k
```
Navigate to /nuevo-pedido
Click "Domicilio normal"
Select origin: Centro
Select destination: Norte
Enter directions
Enter peso: "25"
Click "Sí, hay transferencia"
Enter transferencia monto: "150000"
Enter telefono: "3001234567"
Assert: Price shows "Tarifa base" > 0
Assert: Price shows peso recargo "Entre 16 a 30 kg" = $2.000
Assert: Price shows transferencia recargo "Más de $100.000" = $2.000
Assert: Total = base + $2.000 + $2.000
```

### Caso 14: Domicilio — Peso 50kg + transferencia $600k
```
Navigate to /nuevo-pedido
Click "Domicilio normal"
Select origin: Sur
Select destination: Norte
Enter directions
Enter peso: "50"
Click "Sí, hay transferencia"
Enter transferencia monto: "600000"
Enter telefono: "3001234567"
Assert: Price shows peso recargo "Entre 31 a 45 kg" = $5.000
Assert: Price shows transferencia recargo "Más de $500.000" = $4.000
Assert: Total = base + $5.000 + $4.000
```

### Caso 15: Domicilio — Peso 70kg + transferencia $1.5M
```
Navigate to /nuevo-pedido
Click "Domicilio normal"
Select origin: Centro
Select destination: Caño
Enter directions
Enter peso: "70"
Click "Sí, hay transferencia"
Enter transferencia monto: "1500000"
Enter telefono: "3001234567"
Assert: Price shows peso recargo = $10.000
Assert: Price shows transferencia recargo = $6.000
Assert: Total = base + $10.000 + $6.000
```

### Caso 16: Domicilio — Transferencia $50k (sin recargo)
```
Navigate to /nuevo-pedido
Click "Domicilio normal"
Select origin and destination
Enter peso: "5"
Click "Sí, hay transferencia"
Enter transferencia monto: "50000"
Enter telefono: "3001234567"
Assert: No transferencia recargo shown (monto <= $100k)
Assert: Total = base only
```

### Caso 17: Domicilio — Validación peso obligatorio
```
Navigate to /nuevo-pedido
Click "Domicilio normal"
Select origin and destination
Leave peso empty
Click "Confirmar pedido"
Assert: Error message "El peso del paquete es obligatorio"
```

### Caso 18: Domicilio — Validación transferencia obligatoria
```
Navigate to /nuevo-pedido
Click "Domicilio normal"
Select origin and destination
Enter peso: "10"
Do not click any transferencia button
Click "Confirmar pedido"
Assert: Error message "Indica si hay transferencia bancaria"
```

### Caso 19: Domicilio — Validación teléfono obligatorio
```
Navigate to /nuevo-pedido
Click "Domicilio normal"
Select origin and destination
Enter peso: "10"
Click "No hay transferencia"
Leave telefono empty
Click "Confirmar pedido"
Assert: Error message "El teléfono es obligatorio"
```

### Caso 20: Domicilio — Validación teléfono inválido
```
Navigate to /nuevo-pedido
Click "Domicilio normal"
Select origin and destination
Enter peso: "10"
Click "No hay transferencia"
Enter telefono: "123"
Click "Confirmar pedido"
Assert: Error message about invalid phone
```

### Caso 21: Domicilio — Cambio de peso actualiza recargo
```
Navigate to /nuevo-pedido
Click "Domicilio normal"
Select origin and destination
Enter peso: "10"
Assert: No peso recargo shown
Change peso to "25"
Assert: Peso recargo "Entre 16 a 30 kg" = $2.000 appears
```

### Caso 22: Domicilio — Cambio de monto transferencia actualiza recargo
```
Navigate to /nuevo-pedido
Click "Domicilio normal"
Select origin and destination
Enter peso: "10"
Click "Sí, hay transferencia"
Enter transferencia monto: "50000"
Assert: No transferencia recargo shown
Change transferencia monto to "200000"
Assert: Transferencia recargo "Más de $100.000" = $2.000 appears
```

---

## 4. NUEVO PEDIDO — COMPRA/DILIGENCIA

### Caso 23: Compra — Flujo completo
```
Navigate to /nuevo-pedido
Click "Compra de productos"
Select destination
Enter destination direction
Enter products: "2 paquetes de arroz, 1 leche"
Enter peso: "15"
Click "No hay transferencia"
Enter telefono: "3001234567"
Assert: Form is valid and can be submitted
```

### Caso 24: Pago de factura — Flujo completo
```
Navigate to /nuevo-pedido
Click "Pago de factura o servicio"
Click "No, solo el destino"
Enter destination direction
Enter description: "Pago de factura de luz"
Enter valor factura: "85000"
Enter peso: "2"
Click "No hay transferencia"
Enter telefono: "3001234567"
Assert: Form is valid
```

### Caso 25: Pago bancario — Flujo completo
```
Navigate to /nuevo-pedido
Click "Pago bancario o corresponsal"
Click "No, solo el destino"
Enter destination direction
Enter entidad: "Bancolombia"
Enter description: "Consignación"
Enter valor pagar: "150000"
Enter peso: "1"
Click "No hay transferencia"
Enter telefono: "3001234567"
Assert: Form is valid
```

### Caso 26: Trámite — Flujo completo
```
Navigate to /nuevo-pedido
Click "Trámite o documento"
Click "No, solo el destino"
Enter destination direction
Enter trámite: "Radicar documento"
Enter instrucciones: "Llevar cédula original"
Enter peso: "1"
Click "No hay transferencia"
Enter telefono: "3001234567"
Assert: Form is valid
```

### Caso 27: Compra — Con recogida
```
Navigate to /nuevo-pedido
Click "Compra de productos"
Click "Sí, hay recogida"
Assert: Origin fields appear
Select origin barrio
Enter origin direction
Select destination barrio
Enter destination direction
Enter products and peso
Assert: Form shows both origin and destination
```

### Caso 28: Pago de factura — Validación campos obligatorios
```
Navigate to /nuevo-pedido
Click "Pago de factura o servicio"
Click "No, solo el destino"
Leave description empty
Leave valor factura empty
Click "Confirmar pedido"
Assert: Error for description
Assert: Error for valor factura
```

### Caso 29: Pago bancario — Validación campos obligatorios
```
Navigate to /nuevo-pedido
Click "Pago bancario o corresponsal"
Click "No, solo el destino"
Leave entidad empty
Leave description empty
Leave valor pagar empty
Click "Confirmar pedido"
Assert: Error for entidad
Assert: Error for description
Assert: Error for valor pagar
```

### Caso 30: Compra — Peso y transferencia obligatorios
```
Navigate to /nuevo-pedido
Click "Compra de productos"
Click "No, solo el destino"
Enter destination direction
Enter products: "Medicamentos"
Leave peso empty
Click "Confirmar pedido"
Assert: Error "El peso del paquete es obligatorio"
```

---

## 5. CONSULTAR ESTADO

### Caso 31: Consultar estado — Página carga
```
Navigate to https://stargo-zeta.vercel.app/consultar-estado
Assert: Page shows "Consultar estado" heading
Assert: Input field for order code is visible
```

### Caso 32: Consultar estado — Código inválido
```
Navigate to /consultar-estado
Enter code: "XXXXXX"
Click search button
Assert: Error message "Pedido no encontrado"
```

### Caso 33: Consultar estado — Campo vacío
```
Navigate to /consultar-estado
Leave code empty
Click search button
Assert: Error message or button disabled
```

---

## 6. LOGIN

### Caso 34: Login — Página carga
```
Navigate to https://stargo-zeta.vercel.app/login
Assert: Page shows login form
Assert: Email/username field visible
Assert: Password field visible
Assert: Login button visible
```

### Caso 35: Login — Credenciales inválidas
```
Navigate to /login
Enter email: "invalid@test.com"
Enter password: "wrongpassword"
Click login button
Assert: Error message about invalid credentials
```

### Caso 36: Login — Campo email vacío
```
Navigate to /login
Leave email empty
Enter password: "test123"
Click login button
Assert: Error message about required email
```

### Caso 37: Login — Campo password vacío
```
Navigate to /login
Enter email: "test@test.com"
Leave password empty
Click login button
Assert: Error message about required password
```

---

## 7. RECUPERAR CLAVE

### Caso 38: Recuperar clave — Página carga
```
Navigate to https://stargo-zeta.vercel.app/recuperar-clave
Assert: Page shows "Recuperar contraseña" heading
Assert: Email input field visible
Assert: Submit button visible
```

### Caso 39: Recuperar clave — Email inválido
```
Navigate to /recuperar-clave
Enter email: "not-an-email"
Click submit button
Assert: Error message about invalid email
```

---

## 8. CALCULADORA

### Caso 40: Calculadora — Página carga
```
Navigate to https://stargo-zeta.vercel.app/calculadora
Assert: Page shows calculator form
Assert: Origin and destination fields visible
```

### Caso 41: Calculadora — Cálculo simple
```
Navigate to /calculadora
Select origin: Centro
Select destination: Norte
Assert: Price is calculated and displayed
```

---

## 9. FLUJO COMPLETO DE PEDIDO

### Caso 42: Pedido completo — Domicilio y confirmación
```
Navigate to /nuevo-pedido
Click "Domicilio normal"
Select origin: Centro
Select destination: Norte
Enter directions
Enter peso: "10"
Click "No hay transferencia"
Enter telefono: "3001234567"
Click "Confirmar pedido"
Assert: Success confirmation page shown
Assert: Order code is displayed
Assert: Total price is shown
```

### Caso 43: Pedido completo — Compra y confirmación
```
Navigate to /nuevo-pedido
Click "Compra de productos"
Click "No, solo el destino"
Select destination
Enter destination direction
Enter products: "Medicamentos"
Enter peso: "2"
Click "No hay transferencia"
Enter telefono: "3001234567"
Click "Confirmar pedido"
Assert: Success confirmation shown
```

### Caso 44: Pedido — Después de confirmar, crear otro
```
Complete a pedido (Caso 42)
Click "Crear otro pedido"
Assert: Form resets to initial state
Assert: All fields are empty
```

### Caso 45: Pedido — Consultar estado después de crear
```
Complete a pedido (Caso 42)
Click "Consultar estado"
Assert: Navigates to consultar-estado page
```

---

## 10. NAVEGACIÓN Y RESPONSIVE

### Caso 46: Navegación entre páginas
```
Navigate to home
Click "Hacer un pedido"
Assert: Navigate to /nuevo-pedido
Click "Consultar estado"
Assert: Navigate to /consultar-estado
Click logo
Assert: Navigate back to home
```

### Caso 47: Header sticky
```
Navigate to /nuevo-pedido
Scroll down
Assert: Header remains visible at top
```

---

## 11. VALIDACIONES DE LÍMITES

### Caso 48: Dirección destino — 300 caracteres
```
Navigate to /nuevo-pedido
Click "Domicilio normal"
Select origin and destination
Enter destination direction with 301 characters
Click "Confirmar pedido"
Assert: Error about max length
```

### Caso 49: Observaciones — 1000 caracteres
```
Navigate to /nuevo-pedido
Click "Domicilio normal"
Select origin and destination
Enter observations with 1001 characters
Click "Confirmar pedido"
Assert: Error about max length
```

### Caso 50: Nombre cliente — 120 caracteres
```
Navigate to /nuevo-pedido
Click "Domicilio normal"
Select origin and destination
Enter name with 121 characters
Click "Confirmar pedido"
Assert: Error about max length
```

---

## 12. ERRORED Y EDGE CASES

### Caso 51: Fuera de horario
```
Navigate to /nuevo-pedido (during off-hours)
Assert: Page shows "Estamos fuera de horario" message
Assert: "Confirmar pedido" button is disabled or hidden
```

### Caso 52: Barrio sin zona asignada
```
Navigate to /nuevo-pedido
Select origin barrio without zone
Assert: Error or warning about unavailable zone
```

### Caso 53: Transferencia monto negativo
```
Navigate to /nuevo-pedido
Click "Domicilio normal"
Select origin and destination
Enter peso: "10"
Click "Sí, hay transferencia"
Enter transferencia monto: "-1000"
Click "Confirmar pedido"
Assert: Error "El monto no puede ser negativo"
```

### Caso 54: Peso negativo
```
Navigate to /nuevo-pedido
Click "Domicilio normal"
Select origin and destination
Enter peso: "-5"
Click "Confirmar pedido"
Assert: Error "El peso no puede ser negativo"
```

### Caso 55: Base necesaria — Cálculo sugerido
```
Navigate to /nuevo-pedido
Click "Domicilio normal"
Select origin and destination
Enter peso: "25"
Click "Sí, hay transferencia"
Enter transferencia monto: "150000"
Assert: Base sugerida button appears with calculated amount
Click "Usar total" button
Assert: Base field is filled with suggested amount
```

---

## 13. ADMIN PANEL (Básico)

### Caso 56: Admin — Redirección a login
```
Navigate to https://stargo-zeta.vercel.app/admin
Assert: Redirects to login page (if not authenticated)
```

---

## 14. DOMICILIARIO (Básico)

### Caso 57: Domiciliario — Redirección a login
```
Navigate to https://stargo-zeta.vercel.app/domiciliario
Assert: Redirects to login page (if not authenticated)
```

---

## 15. PWA Y OFFLINE

### Caso 58: Manifest carga
```
Navigate to https://stargo-zeta.vercel.app/manifest.webmanifest
Assert: Returns JSON with app name "StarGo"
```

### Caso 59: Service Worker registrado
```
Navigate to https://stargo-zeta.vercel.app
Assert: Page loads without errors
```

---

## 16. API ENDPOINTS (Básico)

### Caso 60: API Health check
```
Navigate to https://stargo-zeta.vercel.app/api/health
Assert: Returns 200 status
```

---

## Resumen Total: 60 casos de uso

| Categoría | Cantidad |
|-----------|----------|
| Home | 4 |
| Selección tipo servicio | 7 |
| Domicilio normal | 11 |
| Compra/Diligencia | 8 |
| Consultar estado | 3 |
| Login | 4 |
| Recuperar clave | 2 |
| Calculadora | 2 |
| Flujo completo | 4 |
| Navegación | 2 |
| Validaciones límites | 3 |
| Edge cases | 5 |
| Admin/Domiciliario | 2 |
| PWA | 2 |
| API | 1 |
| **Total** | **60** |
