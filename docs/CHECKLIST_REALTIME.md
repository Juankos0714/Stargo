# Checklist manual — Realtime (Parte 6)

La Parte 6 exige una **checklist manual** además de los tests automatizados:
los casos de reconexión tras caída de red, fugas de suscripciones y Realtime
caído son imposibles de automatizar de forma fiable en CI (requieren cortar
la red del navegador a mitad de sesión).

Los tests automatizados que ya existen (tests/e2e/realtime.spec.ts):

- ✅ Propagación: el cambio de estado del admin llega al cliente en tiempo
  real (dos navegadores abiertos a la vez) hasta "Entregado".
- ✅ Aislamiento: un domiciliario sin el pedido asignado no lo ve (RLS de
  Realtime, también en vivo y tras recargar).
- ✅ Refresh manual: el botón "Buscar" actualiza el estado sin depender de
  Realtime (modo "solo refresh manual").

Esta checklist cubre el resto. Correr con `bun run dev` + `supabase start`.

---

## 1. Reconexión automática tras una caída de red

**Objetivo**: una suscripción Realtime se reconecta sola tras una caída y
reanuda la entrega de eventos.

1. Abrir `/consultar-estado` con un pedido y esperar el indicador **"En vivo"**.
2. DevTools → Network → **Offline** (o desconectar el Wi-Fi del dispositivo).
   - El indicador pasa a **"Reconectando…"** (no rompe la página).
3. En otra pestaña, como admin, cambiar el estado del pedido (asignar, etc.).
   - Con la red cortada, el cliente NO recibe el evento (esperado).
4. Volver a Online.
   - El indicador vuelve a **"En vivo"** en ≤30 s (reintentos de Supabase).
5. Cambiar el estado de nuevo como admin.
   - El cliente debe ver el cambio **sin recargar** (la suscripción se
     reconectó y reanudó).
6. ✅ / ❌ — Anotar el resultado.

## 2. Fugas de suscripciones (memory leaks)

**Objetivo**: al salir de una vista, la suscripción se cierra (unsubscribe).

1. Abrir `/admin/pedidos` (suscribe a la tabla `pedidos`).
2. En la consola del navegador: `supabaseBrowser.getChannels()` → debe haber
   1 canal activo (o 1 con estado SUBSCRIBED).
3. Navegar a otra sección del admin (`/admin/zonas`) y volver a `/admin/pedidos`.
4. Repetir la navegación 5 veces y comprobar `supabaseBrowser.getChannels()`:
   - ❌ Si el número de canales crece en cada visita → hay una fuga
     (falta `removeChannel` al desmontar).
   - ✅ Si se mantiene en ~1 → el cleanup del `$effect` funciona.
5. ✅ / ❌

## 3. Realtime caído o no disponible → modo "solo refresh manual"

**Objetivo**: si Realtime está caído, la app sigue siendo usable: sin romperse,
sin loading infinito, con refresh manual.

1. Parar Supabase local (`supabase stop`) o bloquear los WebSockets (en el
   filtro de DevTools de red, bloquear `ws://…/realtime`).
2. Abrir `/consultar-estado` con un pedido:
   - El indicador muestra **"Conectando…"** / **"Reconectando…"** (nunca un
     spinner infinito que oculte la página).
   - El pedido y su historial se ven igual (carga por HTTP, no por Realtime).
3. Cambiar el estado por el panel admin (o por SQL).
4. Pulsar **"Buscar"** → el estado se actualiza manualmente. ✅ usable.
5. Repetir en `/domiciliario` (panel del domiciliario):
   - La lista de entregas carga por HTTP y el refresh manual (F5 o navegación)
     funciona.
6. ✅ / ❌

## 4. Cambio en tiempo real llega SOLO a los implicados

Ya automatizado en `realtime.spec.ts` (aislamiento), pero como verificación
manual rápida con 3 navegadores:

1. Navegador A: `/consultar-estado` de un pedido (cliente).
2. Navegador B: `/domiciliario` del domiciliario **asignado**.
3. Navegador C: `/domiciliario` de un domiciliario **NO asignado**.
4. Como admin, asignar el pedido y avanzarlo:
   - A y B ven los cambios en vivo. ✅
   - C **no** ve el pedido (RLS de Realtime). ✅

---

## Resultado

Fecha de la última ejecución: ________
Casos 1-4: ✅ / ❌ (anotar el que falle y el contexto: navegador, vista, paso).
