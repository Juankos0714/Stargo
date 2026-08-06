// Stub de $env/static/public para tests de UI. Hoy es una red de seguridad:
// supabase-browser/realtime se mockean en los tests de página, así que nada
// lo importa realmente; si mañana un test carga un módulo que sí lee
// $env/static/public, recibirá valores ficticios y nunca credenciales reales.
export const PUBLIC_SUPABASE_URL = 'http://localhost:54321';
export const PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key';
