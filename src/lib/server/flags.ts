/**
 * Feature flags server-side (Parte 8).
 *
 * Permiten activar/desactivar cambios riesgosos (p. ej. una nueva lógica de
 * tarifas) sin necesidad de un rollback completo: se leen de variables de
 * entorno en el servidor (Vercel) y se pueden cambiar en segundos.
 *
 * Uso:
 *   // app
 *   if (flagActiva('TARIFAS_V2')) { usarNuevaLogica(); }
 *
 *   // env de Vercel
 *   FLAG_TARIFAS_V2=true   → activo
 *   FLAG_TARIFAS_V2=false  → inactivo (default cuando no se define)
 *
 * Convención: solo se leen en el servidor (nunca en el cliente) y el nombre
 * en mayúsculas se corresponde con la variable de entorno FLAG_<NOMBRE>.
 */
export function flagActiva(nombre: string, porDefecto = false): boolean {
	const valor = process.env[`FLAG_${nombre.toUpperCase()}`];
	if (valor === undefined) return porDefecto;
	return ['1', 'true', 'si', 'yes', 'on'].includes(valor.trim().toLowerCase());
}

/** Variante con valor: p. ej. FLAG_PORCENTAJE_NUEVA_TARIFA=25 → "25". */
export function valorFlag(nombre: string, porDefecto = ''): string {
	return process.env[`FLAG_${nombre.toUpperCase()}`]?.trim() || porDefecto;
}
