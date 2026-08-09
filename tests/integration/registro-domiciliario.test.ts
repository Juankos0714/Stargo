import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { INTEGRACION_DISPONIBLE, peticion } from './http';
import {
	PASSWORD_TEST,
	loginEnApp,
	sesionConToken,
	limpiarIntegracion,
	crearAdmin,
	crearCliente,
	clienteAnon,
	clienteService,
	PREFIJO,
	type SesionApp,
	type UsuarioRol
} from './helpers';

interface RespuestaRegistro {
	error?: string;
	message?: string;
	data?: { id: string; user_id: string; nombre: string; email: string; activo: boolean };
	meta?: { cuentaCreada?: boolean };
}

/**
 * Registro de domiciliarios desde el panel admin — flujo por endpoints reales:
 *
 *   POST /api/domiciliarios { nombre, email, password } CREA la cuenta de
 *   Supabase Auth (service role, email_confirm: true) y enlaza la fila del
 *   domiciliario: el domi entra de inmediato con ese email+contraseña, SIN
 *   correo de confirmación.
 *   Sin password, solo enlaza una cuenta ya existente (creada en el
 *   dashboard de Supabase).
 *
 * Casos: registro completo con cuenta creada, email ya existente (no se
 * resetea la clave), sin password y sin cuenta (error claro), validaciones
 * y seguridad.
 */
describe.skipIf(!INTEGRACION_DISPONIBLE)('Registro de domiciliarios desde el panel', () => {
	let servicio: ReturnType<typeof clienteService>;
	let admin: UsuarioRol;
	let sesionAdmin: SesionApp;
	let cliente: UsuarioRol;
	let sesionCliente: SesionApp;
	const usuariosCreados: string[] = [];

	function emailNuevo(sufijo: string): string {
		return `domapi_${PREFIJO}_${sufijo}@example.com`;
	}

	async function registrar(body: Record<string, unknown>, jar?: SesionApp['jar']) {
		return peticion<RespuestaRegistro>('/api/domiciliarios', {
			metodo: 'POST',
			cuerpo: body,
			jar
		});
	}

	beforeAll(async () => {
		servicio = clienteService();
		admin = await crearAdmin();
		cliente = await crearCliente();
		sesionAdmin = await loginEnApp(admin.email, PASSWORD_TEST);
		sesionCliente = sesionConToken(cliente.token);
	});

	afterAll(async () => {
		// Los usuarios creados por el endpoint no pasan por el helper de
		// limpieza, así que se borran explícitamente (best-effort).
		for (const id of usuariosCreados) {
			try {
				await servicio.auth.admin.deleteUser(id);
			} catch {
				// ya eliminado o usuario inexistente
			}
		}
		usuariosCreados.length = 0;
		await limpiarIntegracion();
	});

	test('registro completo: crea la cuenta de Auth y el domiciliario entra sin confirmar correo', async () => {
		const email = emailNuevo('nuevo');
		const r = await registrar(
			{
				nombre: `Repartidor Nuevo ${PREFIJO}`,
				email,
				telefono: '3001112233',
				password: 'clave12345'
			},
			sesionAdmin.jar
		);
		expect(r.status, r.data?.error).toBe(200);
		expect(r.data?.meta?.cuentaCreada).toBe(true);
		expect(r.data?.data).toMatchObject({ email, activo: true });
		usuariosCreados.push(r.data!.data!.user_id);

		// La fila del domiciliario quedó enlazada (verificado contra la BD real).
		const { data: fila } = await servicio
			.from('domiciliarios')
			.select('id, email')
			.eq('id', r.data!.data!.id)
			.maybeSingle();
		expect(fila?.email).toBe(email);

		// El domiciliario entra a la app con su email y la contraseña definida,
		// sin haber confirmado ningún correo.
		const sesion = await loginEnApp(email, 'clave12345');
		expect(sesion.esDomiciliario).toBe(true);
	});

	test('si el email ya tiene cuenta, se enlaza sin crear ni resetear su contraseña', async () => {
		// Usuario DEDICADO (no el `cliente` del beforeAll, que otros tests
		// asumen sin rol): su cuenta de Auth ya existe, así que el endpoint
		// debe enlazar la fila sin tocar su contraseña.
		const existente = await crearCliente();
		const r = await registrar(
			{
				nombre: `Repartidor Existente ${PREFIJO}`,
				email: existente.email,
				password: 'otra-clave-999'
			},
			sesionAdmin.jar
		);
		expect(r.status, r.data?.error).toBe(200);
		expect(r.data?.meta?.cuentaCreada).toBe(false);
		expect(r.data?.data?.email).toBe(existente.email);

		// La contraseña original sigue intacta; la enviada en el registro no se aplica.
		const ok = await clienteAnon().auth.signInWithPassword({ email: existente.email, password: PASSWORD_TEST });
		expect(ok.error).toBeNull();
		const falla = await clienteAnon().auth.signInWithPassword({ email: existente.email, password: 'otra-clave-999' });
		expect(falla.error).not.toBeNull();
	});

	test('sin password y sin cuenta existente → 400 con mensaje claro', async () => {
		const r = await registrar(
			{ nombre: `Repartidor Sin Cuenta ${PREFIJO}`, email: emailNuevo('sin-cuenta') },
			sesionAdmin.jar
		);
		expect(r.status).toBe(400);
		expect(r.data?.error).toMatch(/No existe ningún usuario de Supabase/);
	});

	test('contraseña demasiado corta → 400 y no crea nada', async () => {
		const email = emailNuevo('clave-corta');
		const r = await registrar({ nombre: `Repartidor Corto ${PREFIJO}`, email, password: '123' }, sesionAdmin.jar);
		expect(r.status).toBe(400);
		expect(r.data?.error).toMatch(/al menos 6 caracteres/);

		// No se creó ni la cuenta ni la fila del domiciliario.
		const { data: usuarios } = await servicio.auth.admin.listUsers({ page: 1, perPage: 1000 });
		expect(usuarios?.users.some((u) => u.email === email) ?? false).toBe(false);
		const { data: fila } = await servicio.from('domiciliarios').select('id').eq('email', email).maybeSingle();
		expect(fila).toBeNull();
	});

	test('reinicio de contraseña: PUT /api/domiciliarios?id=X { password } cambia la clave sin correo', async () => {
		// 1) Registro completo (crea la cuenta con email+contraseña).
		const email = emailNuevo('reinicio');
		const r = await registrar(
			{ nombre: `Repartidor Reinicio ${PREFIJO}`, email, password: 'clave-original' },
			sesionAdmin.jar
		);
		expect(r.status, r.data?.error).toBe(200);
		const domiId = r.data!.data!.id;
		const userId = r.data!.data!.user_id;
		usuariosCreados.push(userId);

		// 2) El admin reinicia la contraseña (sin correo).
		const rr = await peticion<RespuestaRegistro>(`/api/domiciliarios?id=${domiId}`, {
			metodo: 'PUT',
			cuerpo: { password: 'clave-nueva-777' },
			jar: sesionAdmin.jar
		});
		expect(rr.status, rr.data?.error).toBe(200);

		// 3) La clave anterior deja de funcionar y la nueva entra de inmediato.
		const vieja = await clienteAnon().auth.signInWithPassword({ email, password: 'clave-original' });
		expect(vieja.error).not.toBeNull();
		const sesion = await loginEnApp(email, 'clave-nueva-777');
		expect(sesion.esDomiciliario).toBe(true);
	});

	test('reinicio de contraseña: clave corta o sin password → 400', async () => {
		const email = emailNuevo('reinicio-corto');
		const r = await registrar(
			{ nombre: `Repartidor Corto ${PREFIJO}`, email, password: 'clave-original' },
			sesionAdmin.jar
		);
		expect(r.status, r.data?.error).toBe(200);
		const domiId = r.data!.data!.id;
		usuariosCreados.push(r.data!.data!.user_id);

		const corta = await peticion<{ error?: string }>(`/api/domiciliarios?id=${domiId}`, {
			metodo: 'PUT',
			cuerpo: { password: '123' },
			jar: sesionAdmin.jar
		});
		expect(corta.status).toBe(400);
		expect(corta.data?.error).toMatch(/al menos 6 caracteres/);

		const sinClave = await peticion(`/api/domiciliarios?id=${domiId}`, {
			metodo: 'PUT',
			cuerpo: { activo: true },
			jar: sesionAdmin.jar
		});
		expect(sinClave.status).toBe(200); // activo sigue funcionando
	});

	test('validaciones: falta nombre/email o email inválido → 400', async () => {
		const sinNombre = await registrar({ email: emailNuevo('x') }, sesionAdmin.jar);
		expect(sinNombre.status).toBe(400);
		expect(sinNombre.data?.error).toMatch(/nombre es obligatorio/);

		const sinEmail = await registrar({ nombre: 'X' }, sesionAdmin.jar);
		expect(sinEmail.status).toBe(400);

		const invalido = await registrar({ nombre: 'X', email: 'no-es-un-email' }, sesionAdmin.jar);
		expect(invalido.status).toBe(400);
		expect(invalido.data?.error).toMatch(/email no es válido/);
	});

	test('seguridad: anónimo → 401 y cliente sin rol → 403', async () => {
		const rAnon = await registrar({ nombre: 'X', email: emailNuevo('anon'), password: 'clave12345' });
		expect(rAnon.status).toBe(401);

		const rCliente = await registrar(
			{ nombre: 'X', email: emailNuevo('cliente'), password: 'clave12345' },
			sesionCliente.jar
		);
		expect(rCliente.status).toBe(403);
		expect(rCliente.data?.error ?? rCliente.data?.message ?? '').toMatch(/No eres administrador/);
	});
});
