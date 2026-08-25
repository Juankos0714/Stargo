import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import {
	RLS_DISPONIBLE,
	clienteAnon,
	clienteService,
	clienteComo,
	crearAdmin,
	crearDomiciliario,
	crearCliente,
	sembrarCatalogo,
	seleccion,
	esperaPermitido,
	limpiarTodo,
	type Catalogo,
	type UsuarioRol
} from './helpers';
import { fechaBogota } from '../../src/lib/logic/comisiones';

/**
 * Fase 13 — Horarios de operación.
 *
 *  1) RLS de horario_operacion / horario_excepcion: lectura pública (anon),
 *     escritura solo admin.
 *  2) horario_hoy(): resuelve excepción primero, luego el día de la semana;
 *     un día desactivado (o una excepción activo=false) deja la app cerrada.
 *  3) crear_pedido() BLOQUEA la creación cuando la app está fuera de horario
 *     y la permite cuando está abierta.
 *
 * sembrarCatalogo() deja el horario PERMISIVO (00:00–23:59); estos tests lo
 * anulan con filas/excepciones propias y limpiarTodo() restaura el default.
 */
describe.skipIf(!RLS_DISPONIBLE)('Horarios de operación (Fase 13)', () => {
	let servicio: ReturnType<typeof clienteService>;
	let anon: ReturnType<typeof clienteAnon>;
	let cat: Catalogo;
	let admin: UsuarioRol;
	let domA: UsuarioRol & { domiciliarioId: string };
	let cliente: UsuarioRol;

	const HOY = () => fechaBogota(new Date().toISOString());

	/** Devuelve el estado de hoy calculado por la BD (service_role o anon). */
	async function estadoHoy(cliente: { rpc: (fn: string, p?: object) => PromiseLike<{ data: unknown; error: unknown }> }) {
		const r = await cliente.rpc('horario_hoy');
		expect(r.error, `horario_hoy: ${String((r.error as { message?: string })?.message ?? r.error)}`).toBeNull();
		return r.data as {
			fecha: string;
			dia_semana: number;
			apertura: string;
			cierre: string;
			abierto: boolean;
			motivo: string | null;
			fuente: string;
			hora_actual: string;
		};
	}

	beforeAll(async () => {
		servicio = clienteService();
		anon = clienteAnon();
		cat = await sembrarCatalogo();
		admin = await crearAdmin();
		domA = await crearDomiciliario();
		cliente = await crearCliente();
		// Una excepción FUTURA (no interfiere con horario_hoy(), que solo
		// consulta la fecha de hoy) para que la lectura pública de
		// horario_excepcion tenga filas que verificar.
		await servicio.from('horario_excepcion').upsert({
			fecha: '2099-12-31',
			apertura: '08:00',
			cierre: '14:00',
			activo: true,
			motivo: 'Excepción futura de prueba'
		});
	});

	afterAll(async () => {
		await limpiarTodo();
	});

	describe('RLS de las tablas de horario', () => {
		test('lectura pública: anon, admin y domiciliario leen; escritura solo admin', async () => {
			esperaPermitido(await seleccion(anon, 'horario_operacion'), 'anon SELECT horario_operacion');
			esperaPermitido(await seleccion(anon, 'horario_excepcion'), 'anon SELECT horario_excepcion');
			esperaPermitido(await seleccion(clienteComo(admin.token), 'horario_operacion'), 'admin SELECT');
			esperaPermitido(await seleccion(clienteComo(domA.token), 'horario_operacion'), 'domiciliario SELECT');
		});

		test('anon NO puede escribir; el domiciliario no puede editar (0 filas); el admin sí', async () => {
			const { error: errAnon } = await anon
				.from('horario_operacion')
				.upsert({ dia_semana: 1, apertura: '09:00', cierre: '18:00', activo: true });
			expect(errAnon, 'anon UPSERT debería estar denegado').not.toBeNull();

			const rDomi = await clienteComo(domA.token)
				.from('horario_operacion')
				.update({ apertura: '10:00' })
				.eq('dia_semana', 1)
				.select();
			expect(rDomi.error).toBeNull();
			expect((rDomi.data ?? []).length, 'el domi NO debe poder editar el horario').toBe(0);

			const rAdmin = await clienteComo(admin.token)
				.from('horario_operacion')
				.update({ apertura: '09:00', cierre: '18:00' })
				.eq('dia_semana', 1)
				.select();
			expect(rAdmin.error, `admin update falló: ${rAdmin.error?.message}`).toBeNull();
			expect((rAdmin.data ?? []).length, 'el admin SÍ debe poder editar el horario').toBe(1);

			// El horario es LECTURA PÚBLICA: cualquier autenticado (cliente,
			// domiciliario) puede ver cuándo está abierta la app.
			esperaPermitido(await seleccion(clienteComo(cliente.token), 'horario_operacion'), 'cliente SELECT horario');
			// Restaura el día para no contaminar las pruebas siguientes.
			await servicio.from('horario_operacion').update({ apertura: '00:00', cierre: '23:59' }).eq('dia_semana', 1);
		});
	});

	describe('horario_hoy()', () => {
		test('con horario semanal permisivo la app está abierta (fuente semanal)', async () => {
			const hoy = await estadoHoy(anon);
			expect(hoy.fecha).toBe(HOY());
			expect(hoy.fuente).toBe('semanal');
			expect(hoy.abierto).toBe(true);
			expect(hoy.apertura).toBe('00:00');
			expect(hoy.cierre).toBe('23:59');
		});

		test('una excepción con activo=false cierra la app hoy (fuente excepcion)', async () => {
			await servicio.from('horario_excepcion').upsert({
				fecha: HOY(),
				apertura: '08:00',
				cierre: '20:00',
				activo: false,
				motivo: 'Cierre por inventario'
			});
			const hoy = await estadoHoy(anon);
			expect(hoy.fuente).toBe('excepcion');
			expect(hoy.motivo).toBe('Cierre por inventario');
			expect(hoy.abierto).toBe(false);
		});

		test('una excepción con horario propio anula el semanal', async () => {
			await servicio
				.from('horario_excepcion')
				.upsert({ fecha: HOY(), apertura: '00:00', cierre: '23:59', activo: true, motivo: null });
			const hoy = await estadoHoy(anon);
			expect(hoy.fuente).toBe('excepcion');
			expect(hoy.abierto).toBe(true);
			// Sin excepción para mañana… solo se valida la fuente del día.
		});

		test('un día de la semana desactivado (sin excepción) cierra la app', async () => {
			await servicio.from('horario_excepcion').delete().eq('fecha', HOY());
			const hoy = await estadoHoy(anon);
			const dia = hoy.dia_semana;
			await servicio.from('horario_operacion').update({ activo: false }).eq('dia_semana', dia);

			const cerrado = await estadoHoy(anon);
			expect(cerrado.fuente).toBe('semanal');
			expect(cerrado.abierto).toBe(false);

			// Restaura el día.
			await servicio.from('horario_operacion').update({ activo: true }).eq('dia_semana', dia);
		});
	});

	describe('crear_pedido bloquea fuera de horario', () => {
		test('fuera de horario (excepción cerrada) NO se crea el pedido', async () => {
			await servicio.from('horario_excepcion').upsert({
				fecha: HOY(),
				apertura: '08:00',
				cierre: '20:00',
				activo: false,
				motivo: null
			});
			const { data, error } = await anon.rpc('crear_pedido', {
				p_barrio_origen_id: cat.barrioA,
				p_direccion_origen: 'Dir origen horario',
				p_barrio_destino_id: cat.barrioB,
				p_direccion_destino: 'Dir destino horario',
				p_observaciones: null,
				p_recargos: null,
				p_telefono: '3001234567'
			});
			expect(data).toBeNull();
			expect(error?.message ?? '').toMatch(/fuera de horario/i);
		});

		test('dentro del horario (permisivo) el pedido se crea normalmente', async () => {
			await servicio.from('horario_excepcion').upsert({
				fecha: HOY(),
				apertura: '00:00',
				cierre: '23:59',
				activo: true,
				motivo: null
			});
			const { data, error } = await anon.rpc('crear_pedido', {
				p_barrio_origen_id: cat.barrioA,
				p_direccion_origen: 'Dir origen horario ok',
				p_barrio_destino_id: cat.barrioB,
				p_direccion_destino: 'Dir destino horario ok',
				p_observaciones: null,
				p_recargos: null,
				p_telefono: '3001234567'
			});
			expect(error, `crear_pedido falló: ${error?.message}`).toBeNull();
			expect(data).not.toBeNull();
		});

		test('los pedidos en curso y su seguimiento NO se bloquean (consultar_pedido sigue)', async () => {
			// Cerrar hoy NO afecta consultar_pedido (el bloqueo es solo creación).
			await servicio.from('horario_excepcion').upsert({
				fecha: HOY(),
				apertura: '08:00',
				cierre: '20:00',
				activo: false,
				motivo: null
			});
			// Crea un pedido directo (sin pasar por crear_pedido) y consúltalo.
			const { data: pedido } = await servicio
				.from('pedidos')
				.insert({
					numero: `H${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
					barrio_origen_id: cat.barrioA,
					direccion_origen: 'Dir origen consulta',
					barrio_destino_id: cat.barrioB,
					direccion_destino: 'Dir destino consulta',
					tarifa_base: 6000,
					recargos: null,
					recargo_total: 0,
					total: 6000,
					estado: 'pendiente'
				})
				.select('numero')
				.single();
			const r = await anon.rpc('consultar_pedido', { p_numero: pedido?.numero ?? '' });
			expect(r.error).toBeNull();
			expect((r.data as { pedido: unknown } | null)?.pedido).toBeTruthy();
		});

		test('excepción 00:00–23:00 (activo=true) permite crear pedido', async () => {
			// Escenario del usuario: excepción "casi todo el día" -> la app debe estar abierta.
			await servicio.from('horario_excepcion').upsert({
				fecha: HOY(),
				apertura: '00:00',
				cierre: '23:00',
				activo: true,
				motivo: 'Prueba 00-23'
			});
			const hoy = await estadoHoy(anon);
			// Solo passa si estamos antes de las 23:00 hora Bogotá.
			if (hoy.abierto) {
				const { data, error } = await anon.rpc('crear_pedido', {
					p_barrio_origen_id: cat.barrioA,
					p_direccion_origen: 'Dir origen 00-23',
					p_barrio_destino_id: cat.barrioB,
					p_direccion_destino: 'Dir destino 00-23',
					p_observaciones: null,
					p_recargos: null,
					p_telefono: '3001234567'
				});
				expect(error, `crear_pedido falló: ${error?.message}`).toBeNull();
				expect(data).not.toBeNull();
			} else {
				// Después de las 23:00 Bogotá, 00:00–23:00 ya no cubre la hora.
				const { data, error } = await anon.rpc('crear_pedido', {
					p_barrio_origen_id: cat.barrioA,
					p_direccion_origen: 'Dir origen 00-23',
					p_barrio_destino_id: cat.barrioB,
					p_direccion_destino: 'Dir destino 00-23',
					p_observaciones: null,
					p_recargos: null,
					p_telefono: '3001234567'
				});
				expect(data).toBeNull();
				expect(error?.message ?? '').toMatch(/fuera de horario/i);
			}
		});

		test('excepción con rango que no cubre la hora actual bloquea el pedido', async () => {
			// Excepción activa pero de 02:00 a 03:00: a menos que sean las 02:xx,
			// la app debe estar cerrada.
			await servicio.from('horario_excepcion').upsert({
				fecha: HOY(),
				apertura: '02:00',
				cierre: '03:00',
				activo: true,
				motivo: 'Madrugada solamente'
			});
			const hoy = await estadoHoy(anon);
			if (!hoy.abierto) {
				const { data, error } = await anon.rpc('crear_pedido', {
					p_barrio_origen_id: cat.barrioA,
					p_direccion_origen: 'Dir origen rango acotado',
					p_barrio_destino_id: cat.barrioB,
					p_direccion_destino: 'Dir destino rango acotado',
					p_observaciones: null,
					p_recargos: null,
					p_telefono: '3001234567'
				});
				expect(data).toBeNull();
				expect(error?.message ?? '').toMatch(/fuera de horario/i);
			}
		});

		test('sin excepción + día semanal desactivado bloquea el pedido', async () => {
			await servicio.from('horario_excepcion').delete().eq('fecha', HOY());
			const dia = (await estadoHoy(anon)).dia_semana;
			await servicio.from('horario_operacion').update({ activo: false }).eq('dia_semana', dia);

			const { data, error } = await anon.rpc('crear_pedido', {
				p_barrio_origen_id: cat.barrioA,
				p_direccion_origen: 'Dir origen cerrado semanal',
				p_barrio_destino_id: cat.barrioB,
				p_direccion_destino: 'Dir destino cerrado semanal',
				p_observaciones: null,
				p_recargos: null,
				p_telefono: '3001234567'
			});
			expect(data).toBeNull();
			expect(error?.message ?? '').toMatch(/fuera de horario/i);

			// Restaura el día.
			await servicio.from('horario_operacion').update({ activo: true }).eq('dia_semana', dia);
		});
	});
});
