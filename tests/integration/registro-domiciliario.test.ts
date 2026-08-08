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
 *   POST /api/domiciliarios { op:'registrar', ..., password } crea la cuenta
 *   de Supabase Auth (service role) si no existe y enlaza la fila del
 *   domiciliario; el domi entra a la app con ese email+contraseña.
 *
 * Casos: registro completo, email ya existente (no se resetea la clave),
 * sin password y sin cuenta (error claro), validaciones y seguridad.
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

	test('registro completo: crea la cuenta de Auth y el domiciliario puede entrar', async () => {
		const email = emailNuevo('nuevo');
		const r = await registrar(
			{
				op: 'registrar',
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

		// El domiciliario entra a la app con su email y la contraseña definida.
		const sesion = await loginEnApp(email, 'clave12345');
		expect(sesion.esDomiciliario).toBe(true);
	});

	test('si el email ya tiene cuenta, se enlaza sin crear ni resetear su contraseña', async () => {
		// `cliente` (del beforeAll) es un usuario de Auth sin rol: su cuenta ya existe.
		const existente = cliente;
		const r = await registrar(
			{
				op: 'registrar',
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
			{ op: 'registrar', nombre: `Repartidor Sin Cuenta ${PREFIJO}`, email: emailNuevo('sin-cuenta') },
			sesionAdmin.jar
		);
		expect(r.status).toBe(400);
		expect(r.data?.error).toMatch(/No existe ningún usuario de Supabase/);
	});

	test('contraseña demasiado corta → 400 y no crea nada', async () => {
		const email = emailNuevo('clave-corta');
		const r = await registrar(
			{ op: 'registrar', nombre: `Repartidor Corto ${PREFIJO}`, email, password: '123' },
			sesionAdmin.jar
		);
		expect(r.status).toBe(400);
		expect(r.data?.error).toMatch(/al menos 6 caracteres/);

		// No se creó ni la cuenta ni la fila del domiciliario.
		const { data: usuarios } = await servicio.auth.admin.listUsers({ page: 1, perPage: 1000 });
		expect(usuarios?.users.some((u) => u.email === email) ?? false).toBe(false);
		const { data: fila } = await servicio.from('domiciliarios').select('id').eq('email', email).maybeSingle();
		expect(fila).toBeNull();
	});

	test('seguridad: anónimo → 401 y cliente sin rol → 403', async () => {
		const rAnon = await registrar({ op: 'registrar', nombre: 'X', email: emailNuevo('anon'), password: 'clave12345' });
		expect(rAnon.status).toBe(401);

		const rCliente = await registrar(
			{ op: 'registrar', nombre: 'X', email: emailNuevo('cliente'), password: 'clave12345' },
			sesionCliente.jar
		);
		expect(rCliente.status).toBe(403);
		expect(rCliente.data?.error ?? rCliente.data?.message ?? '').toMatch(/No eres administrador/);
	});
});
