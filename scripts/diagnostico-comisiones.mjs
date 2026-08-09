/**
 * Diagnóstico de comisiones (SOLO LECTURA).
 *
 * Reproduce el cálculo de `obtenerResumenes` ($lib/server/cuenta.ts) contra
 * la BD apuntada por el .env local y muestra el desglose de cada
 * domiciliario: total por día, nivel alcanzado, comisión diaria, total de
 * comisiones, abonos y deuda — además de la escalera vigente y la config.
 *
 * Uso:
 *   bun scripts/diagnostico-comisiones.mjs
 *     (usa SUPABASE_SERVICE_ROLE_KEY del .env; en el .env local la clave
 *     puede ser inválida contra producción → 401. Alternativa:)
 *   STARGO_ADMIN_TOKEN="<token de admin fresco>" bun scripts/diagnostico-comisiones.mjs
 *     (el token se pasa como Bearer y se consultan las tablas que el admin
 *     puede leer: comision_niveles, domiciliarios, pedidos, pagos)
 *
 * No modifica NADA en la BD: solo hace SELECT.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminToken = process.env.STARGO_ADMIN_TOKEN;

if (!url) {
	console.error('Falta PUBLIC_SUPABASE_URL/SUPABASE_URL en el entorno.');
	process.exit(1);
}
if (!serviceKey && !adminToken) {
	console.error(
		'Falta una credencial: SUPABASE_SERVICE_ROLE_KEY (env) o STARGO_ADMIN_TOKEN=<token de admin fresco>.'
	);
	process.exit(1);
}

// En Supabase, un JWT de usuario autenticado vale tanto como `apikey` como
// `Authorization: Bearer`. Si viene STARGO_ADMIN_TOKEN se usa como clave.
const s = createClient(url, adminToken ?? serviceKey ?? 'anon', {
	auth: { persistSession: false },
	...(adminToken ? { global: { headers: { Authorization: `Bearer ${adminToken}` } } } : {})
});

/** Ejecuta una consulta y muestra el error si la credencial no alcanza. */
async function q(fn) {
	const r = await fn();
	if (r.error) {
		console.error(`  (error: ${r.error.message})`);
		return null;
	}
	return r;
}

// ---------- Lógica real de comisiones (bun ejecuta TS): sin drift ------------
// El diagnóstico usa las MISMAS funciones que la app, para que lo que reporta
// sea exactamente lo que vería el panel.
import {
	calcularDeuda,
	comisionDiaria,
	fechaBogota,
	nivelDiario,
	totalPedidoComision,
	totalesDiarios
} from '../src/lib/logic/comisiones.ts';

function totalPedido(total, tarifaBase, recargoTotal) {
	return totalPedidoComision(total ?? null, tarifaBase ?? 0, recargoTotal ?? 0);
}

// ---------------------------------------------------------------------------

const rConfig = await q(() => s.from('comision_config').select('*').maybeSingle());
console.log('=== comision_config ===');
console.log(rConfig?.data ?? '(sin fila o sin permiso)');

const rNiveles = await q(() => s.from('comision_niveles').select('*').order('nivel'));
console.log(`\n=== comision_niveles (${(rNiveles?.data ?? []).length}) ===`);
console.table(
	(rNiveles?.data ?? []).map((n) => ({ nivel: n.nivel, hasta: n.hasta, valor: n.valor }))
);
const niveles = rNiveles?.data ?? [];

const rDomis = await q(() => s.from('domiciliarios').select('id, nombre, activo, bloqueado'));
const domis = rDomis?.data ?? [];
const rPagos = await q(() =>
	s.from('pagos_domiciliarios')
		.select('domiciliario_id, valor, nota, created_at')
		.order('created_at', { ascending: false })
);
const pagos = rPagos?.data ?? [];
const rEntregados = await q(() =>
	s.from('pedidos')
		.select('domiciliario_id, numero, total, tarifa_base, recargo_total, comision, updated_at, created_at')
		.eq('estado', 'entregado')
		.order('updated_at', { ascending: false })
		.limit(500)
);
const entregados = rEntregados?.data ?? [];

const hoyBogota = fechaBogota(new Date().toISOString());
console.log(`\nHoy en Bogotá: ${hoyBogota}\n`);

for (const d of domis ?? []) {
	const misEntregados = (entregados ?? []).filter((p) => p.domiciliario_id === d.id);
	// Agrupar por día (copia de totalesDiarios).
	const porDia = new Map();
	for (const e of misEntregados) {
		const fecha = fechaBogota(e.updated_at);
		if (!fecha) continue;
		porDia.set(fecha, (porDia.get(fecha) ?? 0) + totalPedido(e.total, e.tarifa_base, e.recargo_total));
	}

	let totalComision = 0;
	let hoy = { fecha: hoyBogota, total: 0, nivel: null, comision: 0 };
	const detalleDias = [];
	for (const [fecha, totalDia] of porDia) {
		const comision = comisionDiaria(niveles ?? [], totalDia);
		totalComision += comision;
		detalleDias.push({ fecha, totalDia, nivel: nivelDiario(niveles ?? [], totalDia)?.nivel ?? null, comision });
		if (fecha === hoyBogota) {
			hoy = { fecha, total: totalDia, nivel: nivelDiario(niveles ?? [], totalDia)?.nivel ?? null, comision };
		}
	}

	const misPagos = (pagos ?? []).filter((p) => p.domiciliario_id === d.id);
	const totalPagos = misPagos.reduce((a, p) => a + p.valor, 0);
	const deuda = Math.max(0, totalComision - totalPagos);

	const sumaSnapshots = misEntregados.reduce((a, p) => a + (p.comision ?? 0), 0);
	const sumaTotales = misEntregados.reduce((a, p) => a + totalPedido(p.total, p.tarifa_base, p.recargo_total), 0);

	console.log(`\n================ ${d.nombre} (${d.id}) ================`);
	console.log(`  activo: ${d.activo} · bloqueado: ${d.bloqueado}`);
	console.log(`  pedidos entregados: ${misEntregados.length} · Σ totales: $${sumaTotales} · Σ snapshots pedidos.comision: $${sumaSnapshots}`);
	console.log(`  total_comision (Fase 13, por día): $${totalComision}`);
	console.log(`  hoy: $${hoy.total} → nivel ${hoy.nivel} → comisión $${hoy.comision}`);
	console.log(`  total_pagos: $${totalPagos} (${misPagos.length} abonos)`);
	console.log(`  DEUDA: $${deuda}`);
	if (detalleDias.length > 0) {
		console.log('  desglose por día:');
		console.table(detalleDias);
	}
	console.log('  pedidos (numero · total · comision · updated_at):');
	console.table(
		misEntregados.map((p) => ({
			numero: p.numero,
			total: p.total ?? p.tarifa_base + (p.recargo_total ?? 0),
			comision_snapshot: p.comision,
			updated_at: p.updated_at,
			creado: p.created_at
		}))
	);
	if (misPagos.length > 0) {
		console.log('  abonos:');
		console.table(misPagos.map((p) => ({ valor: p.valor, nota: p.nota ?? '', created_at: p.created_at })));
	}
}
