/**
 * ¿El error de Supabase Auth indica que el email YA tiene una cuenta o una
 * invitación pendiente?
 *
 * inviteUserByEmail() y admin.createUser() rechazan el alta cuando el email ya
 * existe, pero el mensaje y el código varían según la versión de GoTrue:
 *   - "User already registered"      (code user_already_exists / email_exists)
 *   - "User already been invited"    (invitación enviada, sin aceptar aún)
 *   - "User already exists" / "already exists"
 *   - "A user with this email address has already been registered"
 *
 * No es un error fatal: el flujo debe enlazar/reactivar la fila del
 * domiciliario igual (la contraseña que ya tiene o la del enlace pendiente).
 * Se cubren todas las variantes conocidas + un comodín "user already" para no
 * depender del texto exacto de cada versión.
 */
export function esErrorUsuarioExistente(
	error: { code?: string | null; message?: string | null } | null | undefined
): boolean {
	if (!error) return false;
	const code = error.code ?? '';
	const mensaje = error.message ?? '';
	return (
		code === 'email_exists' ||
		code === 'user_already_exists' ||
		code === 'user_already_invited' ||
		code === 'already_exists' ||
		/already (been )?(registered|invited)|already exists|already have an account|user already/i.test(
			mensaje
		)
	);
}

/**
 * ¿El error indica que Supabase Auth NO PUDO ENVIAR el correo (invitación,
 * confirmación, etc.)?
 *
 * GoTrue acepta el alta pero el mailer falla — normalmente por configuración
 * de SMTP/email en el Dashboard de Supabase (Auth → Settings → Email), por
 * límites del proveedor o por una plantilla rota. Mensajes típicos:
 *   - "Error sending invite email"
 *   - "Error sending confirmation mail"
 *   - "Failed to send email"
 *   - Errores SMTP/mailer
 *
 * No es un bug de la app: la cuenta suele NO crearse (GoTrue revierte la
 * transacción) y el flujo puede reintentarse una vez corregido el email.
 * El mensaje que ve el usuario debe orientarlo a revisar la configuración,
 * no mostrar el texto crudo de GoTrue.
 */
export function esErrorEnvioEmail(
	error: { code?: string | null; message?: string | null } | null | undefined
): boolean {
	if (!error) return false;
	const mensaje = error.message ?? '';
	return /error sending (invite )?email|error sending confirmation|failed to send (the )?email|smtp|mailer|email provider|no email provider/i.test(
		mensaje
	);
}
