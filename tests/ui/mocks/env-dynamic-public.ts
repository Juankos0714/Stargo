// Stub de $env/dynamic/public para tests de UI (mismo patrón que
// env-static-public.ts). A diferencia del static, el objeto es mutable: los
// tests de push inyectan PUBLIC_VAPID_PUBLIC_KEY antes de cada caso.
export const env: { PUBLIC_VAPID_PUBLIC_KEY?: string } = {
	PUBLIC_VAPID_PUBLIC_KEY: ''
};
