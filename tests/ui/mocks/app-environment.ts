// Stub de $app/environment para tests de UI: los tests corren en jsdom, así
// que el código que distingue navegador/servidor ve "browser = true".
export const browser = true;
export const dev = false;
export const building = false;
export const version = 'test';
