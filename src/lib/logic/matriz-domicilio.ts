/**
 * Matriz de tarifas urbanas de Armenia — Origen → Destino.
 *
 * Extraída del PDF "Tarifas 2026 Actualizadas". Cada sector de origen
 * tiene una tabla de precios hacia distintos sectores de destino.
 * La matriz NO es simétrica: Centro→Norte puede ser distinto de Norte→Centro.
 *
 * ⚠️ Nota de calidad: en algunos sectores del sur el precio hacia
 * "Caño Cristales, Rio Verde y Rio Claro" es menor que hacia sectores
 * más cercanos, lo cual rompe el patrón de distancia. Verificar con el
 * negocio antes de producción.
 */

export type SectorId =
	| 'centro'
	| 'norte_38_50'
	| 'norte_19_37'
	| 'norte_1_18'
	| 'sur_27_50'
	| 'sur_despues_naranjos'
	| 'sur_despues_puerto_espejo';

export type DestinoSectorId =
	| SectorId
	| 'mismo_sector'
	| 'nuevo_berlin_villa_inglesa_nogal'
	| 'hasta_naranjos_platinos_tres_esquinas'
	| 'despues_naranjos_platinos_tres_esquinas'
	| 'despues_puerto_espejo_cementerio'
	| 'caño_cristales_rio_verde_rio_claro'
	| 'hasta_calle_19_norte'
	| 'hasta_calle_38_norte'
	| 'hasta_calle_50_norte'
	| 'setta_departamental_la_primavera'
	| 'hasta_calle_1_norte'
	| 'despues_calle_38_norte'
	| 'despues_calle_18_hasta_calle_1_norte'
	| 'restante_del_sur'
	| 'despues_calle_19_norte';

/**
 * Matriz completa origen → destino (valores en COP).
 * Si origen == destino, se usa la clave 'mismo_sector'.
 */
// Mapeo de ID de sector origen → ID de sector destino (nombres descriptivos del PDF)
const SECTOR_A_DESTINO: Record<SectorId, string> = {
	centro: 'centro',
	norte_38_50: 'hasta_calle_38_norte',
	norte_19_37: 'hasta_calle_19_norte',
	norte_1_18: 'hasta_calle_1_norte',
	sur_27_50: 'hasta_naranjos_platinos_tres_esquinas',
	sur_despues_naranjos: 'despues_naranjos_platinos_tres_esquinas',
	sur_despues_puerto_espejo: 'despues_puerto_espejo_cementerio'
};

export const MATRIZ_DOMICILIO: Record<SectorId, Partial<Record<DestinoSectorId, number>>> = {
	centro: {
		mismo_sector: 5000,
		centro: 5000,
		norte_38_50: 7000,
		norte_19_37: 6000,
		norte_1_18: 6000,
		sur_27_50: 6000,
		sur_despues_naranjos: 7000,
		sur_despues_puerto_espejo: 8000,
		nuevo_berlin_villa_inglesa_nogal: 7000,
		hasta_naranjos_platinos_tres_esquinas: 6000,
		despues_naranjos_platinos_tres_esquinas: 7000,
		despues_puerto_espejo_cementerio: 8000,
		caño_cristales_rio_verde_rio_claro: 9000,
		hasta_calle_19_norte: 6000,
		hasta_calle_38_norte: 7000,
		hasta_calle_50_norte: 8000,
		setta_departamental_la_primavera: 9000
	},
	norte_38_50: {
		mismo_sector: 5000,
		norte_38_50: 5000,
		norte_19_37: 6000,
		norte_1_18: 7000,
		centro: 8000,
		sur_27_50: 9000,
		sur_despues_naranjos: 10000,
		sur_despues_puerto_espejo: 12000,
		nuevo_berlin_villa_inglesa_nogal: 9000,
		hasta_naranjos_platinos_tres_esquinas: 9000,
		despues_naranjos_platinos_tres_esquinas: 10000,
		caño_cristales_rio_verde_rio_claro: 12000
	},
	norte_19_37: {
		mismo_sector: 5000,
		norte_19_37: 5000,
		norte_38_50: 6000,
		norte_1_18: 6000,
		centro: 7000,
		sur_27_50: 8000,
		sur_despues_naranjos: 9000,
		sur_despues_puerto_espejo: 10000,
		nuevo_berlin_villa_inglesa_nogal: 8000,
		hasta_naranjos_platinos_tres_esquinas: 8000,
		despues_naranjos_platinos_tres_esquinas: 9000,
		despues_puerto_espejo_cementerio: 10000,
		caño_cristales_rio_verde_rio_claro: 11000,
		despues_calle_38_norte: 6000,
		despues_calle_18_hasta_calle_1_norte: 6000,
		setta_departamental_la_primavera: 7000
	},
	norte_1_18: {
		mismo_sector: 5000,
		norte_1_18: 5000,
		norte_19_37: 6000,
		norte_38_50: 7000,
		centro: 6000,
		sur_27_50: 7000,
		sur_despues_naranjos: 8000,
		sur_despues_puerto_espejo: 9000,
		nuevo_berlin_villa_inglesa_nogal: 7000,
		hasta_naranjos_platinos_tres_esquinas: 7000,
		despues_naranjos_platinos_tres_esquinas: 8000,
		despues_puerto_espejo_cementerio: 9000,
		caño_cristales_rio_verde_rio_claro: 10000,
		despues_calle_19_norte: 6000,
		despues_calle_38_norte: 7000,
		setta_departamental_la_primavera: 8000
	},
	sur_27_50: {
		mismo_sector: 5000,
		sur_27_50: 5000,
		sur_despues_naranjos: 6000,
		sur_despues_puerto_espejo: 7000,
		centro: 6000,
		norte_1_18: 7000,
		norte_19_37: 7000,
		norte_38_50: 8000,
		nuevo_berlin_villa_inglesa_nogal: 7000,
		hasta_naranjos_platinos_tres_esquinas: 6000,
		despues_naranjos_platinos_tres_esquinas: 6000,
		despues_puerto_espejo_cementerio: 7000,
		hasta_calle_19_norte: 7000,
		hasta_calle_38_norte: 8000,
		hasta_calle_50_norte: 9000,
		setta_departamental_la_primavera: 10000,
		caño_cristales_rio_verde_rio_claro: 8000
	},
	sur_despues_naranjos: {
		mismo_sector: 5000,
		sur_despues_naranjos: 5000,
		sur_despues_puerto_espejo: 6000,
		centro: 7000,
		norte_1_18: 8000,
		norte_19_37: 8000,
		norte_38_50: 9000,
		nuevo_berlin_villa_inglesa_nogal: 8000,
		hasta_calle_19_norte: 8000,
		hasta_calle_38_norte: 9000,
		hasta_calle_50_norte: 10000,
		setta_departamental_la_primavera: 11000,
		caño_cristales_rio_verde_rio_claro: 7000,
		restante_del_sur: 6000
	},
	sur_despues_puerto_espejo: {
		mismo_sector: 5000,
		sur_despues_puerto_espejo: 5000,
		sur_27_50: 6000,
		sur_despues_naranjos: 7000,
		centro: 8000,
		norte_1_18: 9000,
		norte_19_37: 9000,
		norte_38_50: 10000,
		nuevo_berlin_villa_inglesa_nogal: 9000,
		hasta_naranjos_platinos_tres_esquinas: 6000,
		despues_naranjos_platinos_tres_esquinas: 7000,
		hasta_calle_19_norte: 9000,
		hasta_calle_38_norte: 10000,
		hasta_calle_50_norte: 11000,
		setta_departamental_la_primavera: 12000,
		caño_cristales_rio_verde_rio_claro: 7000
	}
};

/**
 * Obtiene la tarifa de domicilio entre dos sectores.
 * Si origen == destino, usa 'mismo_sector'.
 * Devuelve null si no hay tarifa definida.
 */
export function obtenerTarifaDomicilio(
	origen: SectorId,
	destino: SectorId
): number | null {
	const tablaOrigen = MATRIZ_DOMICILIO[origen];
	if (!tablaOrigen) return null;

	const clave = origen === destino ? 'mismo_sector' : destino;
	return tablaOrigen[clave as DestinoSectorId] ?? null;
}
