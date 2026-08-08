import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { INTEGRACION_DISPONIBLE, BASE_URL, peticion } from './http';
import {
	PASSWORD_TEST,
	loginEnApp,
	limpiarIntegracion,
	crearDomiciliario,
	clienteAnon,
	clienteService
} from './helpers';

/**
 * Recuperación de contraseña "validando desde el correo" — flujo de Supabase Auth.
 *
 *  1) El login pide el enlace con resetPasswordForEmail (el correo lo envía
 *     el proveedor de SMTP). En el entorno local el SMTP no entrega a
 *     inbucket, así que el test genera con admin.generateLink el MISMO
 *     enlace que iría en el correo (mismo mecanismo de token y redirect).
 *  2) El enlace lleva a /auth/v1/verify, que redirige a la app
 *     (/recuperar-clave) con la sesión de recuperación en el hash.
 *  3) La página intercambia la sesión (setSession) y actualiza la contraseña.
 *  4) El domiciliario entra a la app con la NUEVA contraseña; la vieja falla.
 *
 * Casos: flujo completo, enlace manipulado/vencido, clave corta, y el
 * contrato de no-enumeración del envío del correo.
 *
 * Nota de cobertura: la página /recuperar-clave también acepta el enlace
 * PKCE (?code, el formato por defecto de resetPasswordForEmail con
 * supabase-js v2), pero ese formato solo se produce vía SMTP (el correo) y
 * en local el SMTP no entrega a inbucket, así que la suite ejercita la ruta
 * del hash (setSession) y el contrato de envío; la ruta ?code la maneja la
 * página pero no se prueba por endpoints.
 */	describe.skipIf(!INTEGRACION_DISPONIBLE)('Recuperación de contraseña desde el correo', () => {
	let servicio: ReturnType<typeof clienteService>;

	/** Genera el enlace de recuperación (igual al que iría en el correo). */
	async function enlaceRecuperacion(email: string): Promise<string> {
		const gl = await servicio.auth.admin.generateLink({
			type: 'recovery',
			email,
			options: { redirectTo: `${BASE_URL}/recuperar-clave` }
		});
		expect(gl.error, gl.error?.message).toBeNull();
		const enlace = gl.data?.properties?.action_link ?? '';
		expect(enlace).toMatch(/type=recovery/);
		return enlace;
	}

	/**
	 * "Abre el correo": sigue el enlace como haría el navegador y devuelve
	 * los parámetros de la sesión de recuperación que la app recibe en el hash.
	 */
	async function tokensDeRecuperacion(email: string): Promise<URLSearchParams> {
		const enlace = await enlaceRecuperacion(email);
		const res = await fetch(enlace, { redirect: 'manual' });
		expect([301, 302, 303, 307, 308]).toContain(res.status);
		const loc = res.headers.get('location') ?? '';
		expect(loc).toContain('/recuperar-clave');
		const hp = new URLSearchParams(new URL(loc, BASE_URL).hash.slice(1));
		expect(hp.get('type')).toBe('recovery');
		expect(hp.get('access_token')).toBeTruthy();
		expect(hp.get('refresh_token')).toBeTruthy();
		return hp;
	}

	beforeAll(() => {
		servicio = clienteService();
	});

	afterAll(async () => {
		await limpiarIntegracion();
	});

	test('flujo completo: el enlace del correo permite cambiar la clave y entrar con la nueva', async () => {
		const domi = await crearDomiciliario();

		// (1) La app envía el enlace al correo; el test lo obtiene generado
		//     por el admin (mismo enlace que recibe el usuario).
		const hp = await tokensDeRecuperacion(domi.email);

		// (2) La página /recuperar-clave intercambia la sesión de recuperación.
		const cliente = clienteAnon();
		const { error: ssErr } = await cliente.auth.setSession({
			access_token: hp.get('access_token')!,
			refresh_token: hp.get('refresh_token')!
		});
		expect(ssErr, ssErr?.message).toBeNull();

		// (3) El usuario define su nueva contraseña.
		const nuevaClave = 'nueva-clave-999';
		const { error: upErr } = await cliente.auth.updateUser({ password: nuevaClave });
		expect(upErr, upErr?.message).toBeNull();
		await cliente.auth.signOut();

		// (4) Entra a la app con la nueva contraseña; la vieja ya no funciona.
		const sesion = await loginEnApp(domi.email, nuevaClave);
		expect(sesion.esDomiciliario).toBe(true);

		const rVieja = await peticion('/api/login', {
			metodo: 'POST',
			cuerpo: { email: domi.email, password: PASSWORD_TEST }
		});
		expect(rVieja.status).toBe(401);
	});

	test('enlace manipulado o vencido no permite cambiar la contraseña', async () => {
		const domi = await crearDomiciliario();

		const enlace = await enlaceRecuperacion(domi.email);
		const corrupto = enlace.replace(/token=[a-f0-9]+/, `token=${'f'.repeat(64)}`);

		const res = await fetch(corrupto, { redirect: 'manual' });
		const loc = res.headers.get('location') ?? '';
		const hp = new URLSearchParams(new URL(loc, BASE_URL).hash.slice(1));
		// Sin tokens de sesión válidos no hay forma de completar el cambio.
		expect(hp.get('access_token')).toBeFalsy();

		// La contraseña original sigue intacta.
		const ok = await clienteAnon().auth.signInWithPassword({ email: domi.email, password: PASSWORD_TEST });
		expect(ok.error).toBeNull();
	});

	test('contraseña demasiado corta es rechazada al cambiarla', async () => {
		const domi = await crearDomiciliario();

		const hp = await tokensDeRecuperacion(domi.email);
		const cliente = clienteAnon();
		const { error: ssErr } = await cliente.auth.setSession({
			access_token: hp.get('access_token')!,
			refresh_token: hp.get('refresh_token')!
		});
		expect(ssErr, ssErr?.message).toBeNull();

		const { error } = await cliente.auth.updateUser({ password: '123' });
		expect(error).not.toBeNull();

		// La vieja sigue funcionando.
		const ok = await clienteAnon().auth.signInWithPassword({ email: domi.email, password: PASSWORD_TEST });
		expect(ok.error).toBeNull();
	});

	test('pedir el enlace funciona y no revela si el email existe (sin enumeración)', async () => {
		const domi = await crearDomiciliario();

		const cliente = clienteAnon();
		const redir = `${BASE_URL}/recuperar-clave`;

		const existente = await cliente.auth.resetPasswordForEmail(domi.email, { redirectTo: redir });
		expect(existente.error, existente.error?.message).toBeNull();

		const inexistente = await cliente.auth.resetPasswordForEmail(`no-existe-${Date.now()}@example.com`, {
			redirectTo: redir
		});
		expect(inexistente.error, inexistente.error?.message).toBeNull();
	});
});
