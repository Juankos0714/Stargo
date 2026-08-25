/**
 * Tarifas departamentales — Pueblos del Quindío.
 *
 * Extraída del PDF "Tarifas 2026 Actualizadas".
 * Dos tipos de tarifa:
 *   - Fija: mismo precio sin importar la zona de salida en Armenia.
 *   - Por zona de salida (sur/centro/norte de Armenia).
 */

export type ZonaSalida = 'sur' | 'centro' | 'norte';

export type TarifaPueblo =
	| { tipo: 'fija'; valor: number }
	| { tipo: 'por_zona'; sur: number; centro: number; norte: number };

export type PuebloId =
	| 'barcelona'
	| 'buenavista'
	| 'bruselas_antes_mia'
	| 'caimo'
	| 'despues_caimo_antes_seniors'
	| 'calarca'
	| 'circasia'
	| 'cordoba'
	| 'filandia'
	| 'genova'
	| 'montenegro'
	| 'pereira'
	| 'pueblo_tapao'
	| 'pijao'
	| 'quimbaya'
	| 'salento'
	| 'tebaida'
	| 'via_tebaida_primer_retorno';

export const TARIFA_PUEBLOS: Record<PuebloId, TarifaPueblo> = {
	barcelona: { tipo: 'por_zona', sur: 26000, centro: 27000, norte: 28000 },
	buenavista: { tipo: 'fija', valor: 45000 },
	bruselas_antes_mia: { tipo: 'por_zona', sur: 11000, centro: 12000, norte: 13000 },
	caimo: { tipo: 'por_zona', sur: 15000, centro: 16000, norte: 17000 },
	despues_caimo_antes_seniors: { tipo: 'por_zona', sur: 18000, centro: 19000, norte: 20000 },
	calarca: { tipo: 'por_zona', sur: 17000, centro: 16000, norte: 16000 },
	circasia: { tipo: 'por_zona', sur: 19000, centro: 17000, norte: 16000 },
	cordoba: { tipo: 'fija', valor: 45000 },
	filandia: { tipo: 'fija', valor: 45000 },
	genova: { tipo: 'fija', valor: 70000 },
	montenegro: { tipo: 'por_zona', sur: 16000, centro: 17000, norte: 19000 },
	pereira: { tipo: 'fija', valor: 70000 },
	pueblo_tapao: { tipo: 'por_zona', sur: 18000, centro: 20000, norte: 22000 },
	pijao: { tipo: 'fija', valor: 55000 },
	quimbaya: { tipo: 'fija', valor: 40000 },
	salento: { tipo: 'por_zona', sur: 40000, centro: 38000, norte: 36000 },
	tebaida: { tipo: 'por_zona', sur: 18000, centro: 20000, norte: 22000 },
	via_tebaida_primer_retorno: { tipo: 'por_zona', sur: 13000, centro: 15000, norte: 17000 }
};

/**
 * Obtiene la tarifa para un pueblo dado.
 * Para tarifas por zona, necesita la zona de salida del domiciliario en Armenia.
 */
export function obtenerTarifaPueblo(
	pueblo: PuebloId,
	zonaSalida?: ZonaSalida
): number | null {
	const tarifa = TARIFA_PUEBLOS[pueblo];
	if (!tarifa) return null;

	if (tarifa.tipo === 'fija') {
		return tarifa.valor;
	}

	// Por zona: necesita zona de salida
	if (!zonaSalida) return null;
	return tarifa[zonaSalida] ?? null;
}
