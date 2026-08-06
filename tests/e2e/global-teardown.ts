/**
 * Global teardown de la suite E2E (Partes 5 y 6).
 *
 * Limpia todo lo sembrado y creado por la corrida (usuarios, catálogo y
 * pedidos asociados a los barrios E2E), siempre de forma best-effort para
 * que un fallo de limpieza no enmascare un fallo real de la suite.
 */
import { limpiarE2E } from './helpers';

export default async function globalTeardown(): Promise<void> {
	try {
		await limpiarE2E();
		console.log('[e2e] Limpieza de la corrida completada.');
	} catch (e) {
		console.error('[e2e] La limpieza falló (best-effort, no bloquea):', e);
	}
}
