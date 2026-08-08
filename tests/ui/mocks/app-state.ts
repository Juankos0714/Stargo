// Stub de $app/state para tests de UI (mismo patrón que env-static-public.ts):
// la página del domiciliario lee page.data.domiciliarioId para suscribirse a
// sus propios pedidos. En vitest el alias completo de SvelteKit no existe, así
// que apuntamos $app/state aquí con un estado ficticio y estable.
export const page = {
	data: { domiciliarioId: 'domi-1' },
	error: null,
	form: null,
	params: {},
	route: { id: '/domiciliario' },
	state: {},
	status: 200,
	url: new URL('http://localhost/domiciliario')
};

// Superficie completa del módulo real (page, navigating, updated) para que
// un futuro componente que importe cualquiera de ellos siga compilando.
export const navigating = {
	from: null,
	to: null,
	type: null
};

export const updated = { get: () => false };
