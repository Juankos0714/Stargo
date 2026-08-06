import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/svelte';

// @testing-library/svelte monta en un contenedor por test; sin este cleanup
// los componentes se acumulan en el DOM entre tests.
afterEach(() => {
	cleanup();
});
