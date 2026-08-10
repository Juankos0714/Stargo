/**
 * Lógica pura de los botones wa.me (Fase 19).
 *
 * Construcción del link de WhatsApp: normaliza el teléfono (sin espacios,
 * guiones ni paréntesis; antepone el indicativo 57 solo si no lo trae) y
 * codifica el mensaje con encodeURIComponent. Las plantillas de mensaje
 * difieren por rol (admin vs domiciliario) pero reutilizan el mismo mecanismo.
 *
 * Sin dependencias de BD ni de UI — testable con Vitest (cobertura ≥90%).
 */

/** Nombre de la empresa para los mensajes predeterminados (ajustable). */
export const NOMBRE_EMPRESA = 'StarGo';

/** Indicativo de Colombia. El negocio opera solo en Colombia (hora de Bogotá,
 * COP, móviles colombianos de 10 dígitos), por eso va fijo; si algún día se
 * atienden pedidos fuera de Colombia, este es el único punto a parametrizar. */
export const INDICATIVO_COLOMBIA = '57';

/**
 * Normaliza un teléfono para wa.me: elimina todo lo que no sea dígito y
 * antepone el indicativo 57 si el número trae solo los 10 dígitos locales.
 * Devuelve null si no se puede construir un destino válido.
 */
export function normalizarTelefonoWhatsApp(telefono: string | null | undefined): string | null {
	const limpio = (telefono ?? '').replace(/\D/g, '');
	// Ya trae el indicativo completo (12 dígitos empezando por 57).
	if (limpio.length === 12 && limpio.startsWith(INDICATIVO_COLOMBIA)) return limpio;
	// Solo el número local de 10 dígitos: se antepone el indicativo.
	if (limpio.length === 10) return INDICATIVO_COLOMBIA + limpio;
	return null;
}

/**
 * URL de WhatsApp con mensaje predeterminado: https://wa.me/<destino>?text=<urlencoded>.
 * Devuelve null si el teléfono no es válido (el botón no se pinta).
 */
export function urlWhatsApp(telefono: string | null | undefined, mensaje: string): string | null {
	const destino = normalizarTelefonoWhatsApp(telefono);
	if (!destino) return null;
	return `https://wa.me/${destino}?text=${encodeURIComponent(mensaje)}`;
}

/** Saludo del mensaje: «Hola [nombre], » si hay nombre, «Hola, » si no. */
function saludo(nombreCliente: string | null | undefined): string {
	const nombre = (nombreCliente ?? '').trim();
	return nombre ? `Hola ${nombre}, ` : 'Hola, ';
}

/**
 * Mensaje predeterminado del ADMIN: «Hola [nombre], te escribimos de StarGo
 * respecto a tu pedido #XXX. ¿En qué te podemos ayudar?».
 */
export function mensajeWhatsAppAdmin(numero: string, nombreCliente?: string | null): string {
	return `${saludo(nombreCliente)}te escribimos de ${NOMBRE_EMPRESA} respecto a tu pedido #${numero}. ¿En qué te podemos ayudar?`;
}

/**
 * Mensaje predeterminado del DOMICILIARIO (orientado a la entrega):
 * «Hola [nombre], soy tu domiciliario para el pedido #XXX, voy en camino».
 */
export function mensajeWhatsAppDomiciliario(numero: string, nombreCliente?: string | null): string {
	return `${saludo(nombreCliente)}soy tu domiciliario para el pedido #${numero}, voy en camino.`;
}
