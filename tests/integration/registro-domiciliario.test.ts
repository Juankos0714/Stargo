import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import { INTEGRACION_DISPONIBLE, peticion } from './http';
import {
	PASSWORD_TEST,
	loginEnApp,
	sesionConToken,
	limpiarIntegracion,
	crearAdmin,
	crearCliente,
	clienteService,
	PREFIJO,
	type SesionApp,
	type UsuarioRol
} from './helpers';

interface RespuestaRegistro {
	error?: string;
	message?: string;
	data?: { id: string; user_id: string; nombre: string; email: string; activo: boolean };
}

/**
 * Enlace de domiciliarios desde el panel admin — flujo por endpoints reales:
 *
 *   POST /api/domiciliarios { nombre, email } enlaza la fila del domiciliario
 *   con una cuenta de Supabase Auth YA EXISTENTE (creada en el dashboard de
 *   Supabase). La app NUNCA crea cuentas: el endpoint solo llama al RPC
 *   registrar_domiciliario (SECURITY DEFINER).
 *
 * Casos: enlace con cuenta existente, email sin cuenta (error claro),
 * validaciones y seguridad.
 */
describe.skipIf(!INTEGRACION_DISPONIBLE)('Enlace de domiciliarios desde el panel', () => {
	let servicio: ReturnType<typeof clienteService>;
	let admin: UsuarioRol;
	let sesionAdmin: SesionApp;
	let cliente: UsuarioRol;
	let sesionCliente: SesionApp;

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
		await limpiarIntegracion();
	});

	test('enlaza la fila del domiciliario con una cuenta existente de Supabase', async () => {
		// Usuario DEDICADO (no reutiliza a `cliente`): así no se muta el
		// fixture de «usuario sin rol» que usan los tests de seguridad.
		const existente = await crearCliente();
		const r = await registrar(
			{
				nombre: `Repartidor Enlazado ${PREFIJO}`,
				email: existente.email,
				telefono: '3001112233'
			},
			sesionAdmin.jar
		);
		expect(r.status, r.data?.error).toBe(200);
		expect(r.data?.data).toMatchObject({ email: existente.email, activo: true });
		expect(r.data?.data?.user_id).toBe(existente.userId);

		// La fila quedó enlazada (verificado contra la BD real) y el usuario
		// entra a la app con su contraseña original (la de Supabase).
		const { data: fila } = await servicio
			.from('domiciliarios')
			.select('id, email')
			.eq('id', r.data!.data!.id)
			.maybeSingle();
		expect(fila?.email).toBe(existente.email);

		const sesion = await loginEnApp(existente.email, PASSWORD_TEST);
		expect(sesion.esDomiciliario).toBe(true);
	});

	test('email sin cuenta de Supabase → 400 con mensaje claro', async () => {
		const r = await registrar({ nombre: `Repartidor Sin Cuenta ${PREFIJO}`, email: emailNuevo('sin-cuenta') }, sesionAdmin.jar);
		expect(r.status).toBe(400);
		expect(r.data?.error).toMatch(/No existe ningún usuario de Supabase/);
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
		const rAnon = await registrar({ nombre: 'X', email: emailNuevo('anon') });
		expect(rAnon.status).toBe(401);

		const rCliente = await registrar({ nombre: 'X', email: emailNuevo('cliente') }, sesionCliente.jar);
		expect(rCliente.status).toBe(403);
		expect(rCliente.data?.error ?? rCliente.data?.message ?? '').toMatch(/No eres administrador/);
	});
});
