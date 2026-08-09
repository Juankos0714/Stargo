// Stub de $app/navigation para tests de UI (mismo patrón que app-state.ts):
// en vitest el alias completo de SvelteKit no existe, así que apuntamos
// $app/navigation aquí. `goto` se espía por componente con vi.mock cuando un
// test necesita verificar navegación; por defecto no hace nada.
export const goto = () => Promise.resolve();
export const invalidate = () => Promise.resolve();
export const invalidateAll = () => Promise.resolve();
export const preloadData = () => Promise.resolve({ type: 'loaded', status: 200, data: undefined });
export const preloadCode = () => Promise.resolve();
export const replaceState = () => {};
export const pushState = () => {};
export const disableScrollHandling = () => {};
