/**
 * Identidad visual oficial de StarGo.
 *
 * NOMENCLATURA (importante): `Logo*` = SOLO el símbolo "S" · `Marca*` = símbolo + wordmark "stargo".
 * Los 6 archivos de Cloudinary son SWATCHES de manual de marca (fondo sólido horneado,
 * sin transparencia) — NO se usan como <img> en la UI (verían un rectángulo de color).
 * Los assets de producción con transparencia viven en /static/brand/ y se consumen
 * exclusivamente a través de <Logo /> (src/lib/components/Logo.svelte).
 */

/** Swatch Logo (solo símbolo "S") — fondo blanco, símbolo azul #0064FF. */
export const LOGO_ESTANDAR =
	'https://res.cloudinary.com/yjunxopr/image/upload/v1785980223/LogoEstandar_j0ihcu.webp';
/** Swatch Logo (solo símbolo "S") — fondo azul #0064FF. */
export const LOGO_NEGATIVO =
	'https://res.cloudinary.com/yjunxopr/image/upload/v1785980223/LogoNegativo_r4vil7.webp';
/** Swatch Logo alternativo (solo símbolo) — fondo navy #001621. */
export const LOGO_ALT = 'https://res.cloudinary.com/yjunxopr/image/upload/v1785980175/LogoAlt_rlqhs9.webp';
/** Swatch Marca (símbolo + texto) — fondo blanco. */
export const MARCA_ESTANDAR =
	'https://res.cloudinary.com/yjunxopr/image/upload/v1785980223/MarcaEstandar_fw7jxq.webp';
/** Swatch Marca (símbolo + texto) — fondo azul. */
export const MARCA_NEGATIVO =
	'https://res.cloudinary.com/yjunxopr/image/upload/v1785980224/MarcaNegativo_bbeqjj.webp';
/** Swatch Marca alternativo (símbolo + texto) — fondo navy. */
export const MARCA_ALT = 'https://res.cloudinary.com/yjunxopr/image/upload/v1785980223/MarcaAlt_h6mojw.webp';
