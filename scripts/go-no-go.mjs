#!/usr/bin/env node
/**
 * Parte 10 — CHECKLIST PRE-LANZAMIENTO (go/no-go).
 *
 * Antes de cada release importante a producción: verifica los 10 puntos del
 * checklist, ejecuta las suites que pueden correr aquí y evalúa las
 * verificaciones MANUALES contra fechas registradas con ventana de validez.
 *
 * Uso:
 *   bun run go-no-go                 # evalúa todo + corre los gates locales
 *   bun run go-no-go --check         # solo evalúa los items (sin typecheck/bundle extra)
 *   bun run go-no-go --e2e           # incluye la suite E2E (requiere Supabase/staging)
 *   bun run go-no-go --marcar realtime   # registra la verificación manual de hoy
 *   bun run go-no-go --marcar backup --nota "backup del 6/8 verificado"
 *   bun run go-no-go --json          # salida JSON (para CI/reportes)
 *   bun run go-no-go --reporte reporte.json
 *
 * Automatizados (se ejecutan): typecheck, unitarios+cobertura ≥90%, UI,
 * RLS e integración (si hay Supabase local/staging disponible), bundle.
 * E2E solo con --e2e. Smoke y alertas se auto-ejecutan si están configurados
 * (SMOKE_URL o BASE_URL+CRON_SECRET); si no, se evalúan por fecha manual.
 *
 * Manuales (se evalúan por fecha en .go-no-go-estado.json): realtime, carga,
 * smoke, alertas, backup, rollback. Ventanas de validez configurables con
 * GO_NO_GO_VENTANA_<CLAVE>_DIAS (defaults abajo).
 *
 * Veredicto: GO solo si TODOS los puntos pasan. Cualquier FAIL o PENDIENTE
 * (incluidos los no ejecutables localmente) → NO-GO con la lista de lo que
 * falta. Exit 0 = GO, 1 = NO-GO.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ESTADO_ARCHIVO = join(RAIZ, '.go-no-go-estado.json');

// ---------- Configuración ---------------------------------------------------

const VENTANAS_DEFAULT = {
	realtime: 14, // prueba manual Realtime con dos sesiones
	carga: 14, // prueba de carga: no más vieja que el último cambio estructural
	smoke: 7, // smoke post-deploy: debe haberse corrido hace poco
	alertas: 14, // alertas verificadas con fallo forzado
	backup: 7, // backup de BD reciente confirmado
	rollback: 90 // rollback probado al menos una vez (puede ser hace tiempo)
};

const ventanaDe = (clave) =>
	Number(process.env[`GO_NO_GO_VENTANA_${clave.toUpperCase()}_DIAS`] ?? VENTANAS_DEFAULT[clave]);

// ---------- Estado manual ---------------------------------------------------

function leerEstado() {
	try {
		return JSON.parse(readFileSync(ESTADO_ARCHIVO, 'utf8'));
	} catch {
		return { realtime: null, carga: null, smoke: null, alertas: null, backup: null, rollback: null };
	}
}

function escribirEstado(estado) {
	writeFileSync(ESTADO_ARCHIVO, JSON.stringify(estado, null, 2) + '\n', 'utf8');
}

function diasDesde(iso) {
	if (!iso) return null;
	const d = new Date(iso).getTime();
	if (Number.isNaN(d)) return null;
	return Math.floor((Date.now() - d) / 86_400_000);
}

// ---------- Ejecución de comandos -------------------------------------------

function correr(cmd, args, { envExtra = {}, timeoutMs = 180_000 } = {}) {
	const r = spawnSync(cmd, args, {
		encoding: 'utf8',
		timeout: timeoutMs,
		env: { ...process.env, ...envExtra }
	});
	return { ok: r.status === 0, status: r.status, salida: (r.stdout ?? '') + (r.stderr ?? '') };
}

function haySupabaseLocal() {
	const base = process.env.SUPABASE_URL ?? '';
	if (!base) return false;
	const puertoOk = /127\.0\.0\.1|localhost/.test(base);
	return Boolean(process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) && puertoOk;
}

function hayCredencialesSupabase() {
	return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// ---------- Items del checklist ---------------------------------------------

/**
 * Cada item: { clave, titulo, tipo: 'auto'|'manual', opcional, evaluar() }
 * evaluar() devuelve { estado: 'ok'|'fail'|'pendiente'|'no_ejecutable', detalle, salida? }
 */
function items() {
	const estado = leerEstado();
	const args = process.argv.slice(2);
	const conE2E = args.includes('--e2e');

	const reporte = [];

	// 1. Suite unitaria + cobertura ≥90%
	reporte.push({
		clave: 'unitarios',
		titulo: 'Suite unitaria (Parte 1) + cobertura de lógica ≥ 90%',
		tipo: 'auto',
		opcional: false,
		evaluar: async () => {
			const r = correr('bun', ['run', 'test:coverage'], { timeoutMs: 180_000 });
			if (!r.ok) return { estado: 'fail', detalle: `bun run test:coverage salió con status ${r.status} (el gate de cobertura falla el CI)` };
			// Parsear el resumen de cobertura.
			let pct = null;
			try {
				const resumen = JSON.parse(readFileSync(join(RAIZ, 'coverage', 'coverage-summary.json'), 'utf8'));
				pct = resumen?.total?.lines?.pct ?? null;
			} catch {
				// si no se pudo leer el resumen, el exit 0 de vitest ya valida el gate
			}
			const detalle = pct !== null ? `cobertura de líneas ${pct}% (umbral 90%)` : 'cobertura OK (vitest exit 0)';
			return pct !== null && pct < 90 ? { estado: 'fail', detalle } : { estado: 'ok', detalle };
		}
	});

	// 2. RLS
	reporte.push({
		clave: 'rls',
		titulo: 'Suite de RLS (Parte 2) en verde',
		tipo: 'auto',
		opcional: false,
		evaluar: async () => {
			if (!hayCredencialesSupabase()) {
				return {
					estado: 'no_ejecutable',
					detalle: 'Sin SUPABASE_URL/ANON/SERVICE_ROLE (levanta Supabase local o apunta a staging en .env.test). Corre en el CI (job rls-tests).'
				};
			}
			const r = correr('bun', ['run', 'test:rls'], { timeoutMs: 600_000 });
			if (!r.ok) return { estado: 'fail', detalle: `test:rls status ${r.status} — revisa la salida` };
			const omitidos = /skipped/.test(r.salida) && /passed/.test(r.salida) === false;
			return omitidos
				? { estado: 'fail', detalle: 'test:rls terminó con tests omitidos (¿faltan credenciales?)' }
				: { estado: 'ok', detalle: 'RLS en verde' };
		}
	});

	// 3. Integración
	reporte.push({
		clave: 'integracion',
		titulo: 'Suite de integración (Parte 3) en verde (local/staging)',
		tipo: 'auto',
		opcional: false,
		evaluar: async () => {
			if (!hayCredencialesSupabase()) {
				return {
					estado: 'no_ejecutable',
					detalle: 'Sin credenciales de Supabase (local o staging). Corre en el CI (job integration-tests).'
				};
			}
			const r = correr('bun', ['run', 'test:integration'], { timeoutMs: 900_000 });
			if (!r.ok) return { estado: 'fail', detalle: `test:integration status ${r.status}` };
			return /suite omitida/.test(r.salida)
				? { estado: 'fail', detalle: 'test:integration se omitió (no se verificó)' }
				: { estado: 'ok', detalle: 'Integración en verde' };
		}
	});

	// 4. E2E (solo con --e2e; requiere credenciales)
	reporte.push({
		clave: 'e2e',
		titulo: 'Suite E2E (Parte 5) en verde contra staging/preview',
		tipo: 'auto',
		opcional: true,
		evaluar: async () => {
			if (!conE2E) {
				return { estado: 'pendiente', detalle: 'No se pidió E2E (usa --e2e). Debe correr en CI o contra el preview de staging.' };
			}
			if (!hayCredencialesSupabase()) {
				return { estado: 'no_ejecutable', detalle: '--e2e requiere SUPABASE_URL/ANON/SERVICE_ROLE (local o staging).' };
			}
			const r = correr('bun', ['run', 'test:e2e'], { timeoutMs: 2_700_000 });
			if (!r.ok) return { estado: 'fail', detalle: `test:e2e status ${r.status}` };
			return /suite omitida/.test(r.salida)
				? { estado: 'fail', detalle: 'test:e2e se omitió (no se verificó)' }
				: { estado: 'ok', detalle: 'E2E en verde' };
		}
	});

	// 5. Realtime manual (dos sesiones simultáneas)
	reporte.push({
		clave: 'realtime',
		titulo: 'Prueba manual de Realtime (Parte 6) con dos sesiones',
		tipo: 'manual',
		opcional: false,
		evaluar: async () => {
			const dias = diasDesde(estado.realtime?.fecha ?? null);
			if (dias === null) return { estado: 'pendiente', detalle: 'No registrada. `bun run go-no-go --marcar realtime` tras la prueba (docs/CHECKLIST_REALTIME.md).' };
			if (dias > ventanaDe('realtime')) return { estado: 'fail', detalle: `Vencida: hace ${dias} días (máx ${ventanaDe('realtime')}).` };
			return { estado: 'ok', detalle: `Verificada el ${estado.realtime.fecha}${estado.realtime.nota ? ` — ${estado.realtime.nota}` : ''}` };
		}
	});

	// 6. Carga reciente
	reporte.push({
		clave: 'carga',
		titulo: 'Última prueba de carga (Parte 7) no más vieja que el último cambio estructural',
		tipo: 'manual',
		opcional: false,
		evaluar: async () => {
			// El reporte de carga debe estar completado (no en plantilla pendiente).
			const ruta = join(RAIZ, 'docs', 'REPORTE_CARGA.md');
			let completado = true;
			try {
				const contenido = readFileSync(ruta, 'utf8');
				completado = !contenido.includes('pendiente de ejecutar');
			} catch {
				completado = false;
			}
			const dias = diasDesde(estado.carga?.fecha ?? null);
			if (dias === null) return { estado: 'pendiente', detalle: 'No registrada. Completa docs/REPORTE_CARGA.md y `--marcar carga`.' };
			if (!completado) return { estado: 'fail', detalle: 'docs/REPORTE_CARGA.md sigue en plantilla pendiente.' };
			if (dias > ventanaDe('carga')) return { estado: 'fail', detalle: `Hace ${dias} días (máx ${ventanaDe('carga')}) — repite si hubo cambio estructural.` };
			return { estado: 'ok', detalle: `Verificada el ${estado.carga.fecha}` };
		}
	});

	// 7. Smoke post-deploy
	reporte.push({
		clave: 'smoke',
		titulo: 'Smoke test post-deploy (Parte 8) configurado y funcionando',
		tipo: 'auto',
		opcional: false,
		evaluar: async () => {
			const configurado = Boolean(process.env.SMOKE_URL && process.env.SMOKE_ADMIN_EMAIL && process.env.SMOKE_ADMIN_PASSWORD);
			if (configurado) {
				const r = correr('bun', ['run', 'test:smoke'], { timeoutMs: 180_000 });
				if (!r.ok) return { estado: 'fail', detalle: `test:smoke status ${r.status}` };
				return /omitido/.test(r.salida)
					? { estado: 'fail', detalle: 'test:smoke se omitió a pesar de estar configurado' }
					: { estado: 'ok', detalle: 'Smoke post-deploy OK contra ' + process.env.SMOKE_URL };
			}
			const dias = diasDesde(estado.smoke?.fecha ?? null);
			if (dias === null) return { estado: 'pendiente', detalle: 'Sin SMOKE_* ni verificación manual. Configúralo o `--marcar smoke`.' };
			if (dias > ventanaDe('smoke')) return { estado: 'fail', detalle: `Vencida: hace ${dias} días (máx ${ventanaDe('smoke')}).` };
			return { estado: 'ok', detalle: `Verificada el ${estado.smoke.fecha}${estado.smoke.nota ? ` — ${estado.smoke.nota}` : ''}` };
		}
	});

	// 8. Alertas con fallo forzado
	reporte.push({
		clave: 'alertas',
		titulo: 'Alertas (Parte 9) verificadas con una prueba real de fallo forzado',
		tipo: 'auto',
		opcional: false,
		evaluar: async () => {
			const configurado = Boolean(process.env.BASE_URL && process.env.CRON_SECRET);
			if (configurado) {
				const r = correr('bun', ['run', 'test:alertas'], { timeoutMs: 180_000 });
				if (!r.ok) return { estado: 'fail', detalle: `test:alertas status ${r.status}` };
				return { estado: 'ok', detalle: `Alertas verificadas contra ${process.env.BASE_URL}` };
			}
			const dias = diasDesde(estado.alertas?.fecha ?? null);
			if (dias === null) return { estado: 'pendiente', detalle: 'Sin BASE_URL+CRON_SECRET ni verificación manual. Correlo o `--marcar alertas`.' };
			if (dias > ventanaDe('alertas')) return { estado: 'fail', detalle: `Vencida: hace ${dias} días (máx ${ventanaDe('alertas')}).` };
			return { estado: 'ok', detalle: `Verificada el ${estado.alertas.fecha}${estado.alertas.nota ? ` — ${estado.alertas.nota}` : ''}` };
		}
	});

	// 9. Backup de BD reciente
	reporte.push({
		clave: 'backup',
		titulo: 'Backup de base de datos reciente confirmado',
		tipo: 'manual',
		opcional: false,
		evaluar: async () => {
			const dias = diasDesde(estado.backup?.fecha ?? null);
			if (dias === null) return { estado: 'pendiente', detalle: 'No confirmado. Supabase: Database → Backups (PITR/continuos en planes pagos). `--marcar backup`.' };
			if (dias > ventanaDe('backup')) return { estado: 'fail', detalle: `Hace ${dias} días (máx ${ventanaDe('backup')}).` };
			return { estado: 'ok', detalle: `Backup confirmado el ${estado.backup.fecha}${estado.backup.nota ? ` — ${estado.backup.nota}` : ''}` };
		}
	});

	// 10. Rollback probado
	reporte.push({
		clave: 'rollback',
		titulo: 'Plan de rollback documentado y probado al menos una vez',
		tipo: 'manual',
		opcional: false,
		evaluar: async () => {
			const dias = diasDesde(estado.rollback?.fecha ?? null);
			if (dias === null) return { estado: 'pendiente', detalle: 'No probado. Ejecuta el plan de docs/CHECKLIST_GO_NO_GO.md y `--marcar rollback`.' };
			if (dias > ventanaDe('rollback')) return { estado: 'fail', detalle: `Hace ${dias} días (máx ${ventanaDe('rollback')}).` };
			return { estado: 'ok', detalle: `Rollback probado el ${estado.rollback.fecha}${estado.rollback.nota ? ` — ${estado.rollback.nota}` : ''}` };
		}
	});

	return reporte;
}

// ---------- --marcar <clave> ------------------------------------------------

const args = process.argv.slice(2);
const idxMarcar = args.indexOf('--marcar');
if (idxMarcar !== -1) {
	const clave = args[idxMarcar + 1];
	const notaIdx = args.indexOf('--nota');
	const nota = notaIdx !== -1 ? args[notaIdx + 1] : undefined;
	const validas = Object.keys(VENTANAS_DEFAULT);
	if (!clave || !validas.includes(clave)) {
		console.error(`[go-no-go] --marcar requiere una clave válida: ${validas.join(', ')}`);
		process.exit(2);
	}
	const estado = leerEstado();
	estado[clave] = { fecha: new Date().toISOString().slice(0, 10), nota: nota ?? null };
	escribirEstado(estado);
	console.log(`[go-no-go] ✓ ${clave} registrada el ${estado[clave].fecha}${nota ? ` (${nota})` : ''} en ${ESTADO_ARCHIVO}`);
	process.exit(0);
}

// ---------- Ejecución y veredicto -------------------------------------------

const salidaJson = args.includes('--json');
const soloEval = args.includes('--check');
const reportePath = (() => {
	const i = args.indexOf('--reporte');
	return i !== -1 ? args[i + 1] : null;
})();

async function main() {
	console.log('[go-no-go] Checklist pre-lanzamiento (Parte 10)');
	console.log('');

	const lista = items();
	const resultados = [];

	for (const item of lista) {
		process.stdout.write(`  ${item.tipo === 'manual' ? '◌' : '▶'} ${item.titulo}… `);
		const r = await item.evaluar();
		const emoji = r.estado === 'ok' ? '✓' : r.estado === 'fail' ? '✗' : r.estado === 'pendiente' ? '◌' : '—';
		console.log(`${emoji} ${r.detalle}`);
		resultados.push({ ...item, resultado: r });
	}

	// Resumen de gates rápidos extra (typecheck + bundle) si no --check.
	if (!soloEval) {
		process.stdout.write('  ▶ Typecheck (svelte-check)… ');
		const t = correr('bun', ['run', 'check'], { timeoutMs: 180_000 });
		console.log(t.ok ? '✓' : `✗ status ${t.status}`);
		resultados.push({
			clave: 'typecheck',
			titulo: 'Typecheck (svelte-check)',
			tipo: 'auto',
			opcional: false,
			resultado: t.ok ? { estado: 'ok', detalle: 'sin errores' } : { estado: 'fail', detalle: `status ${t.status}` }
		});

		process.stdout.write('  ▶ Presupuesto de bundle (Parte 7)… ');
		const b = correr('bun', ['run', 'bundle:budget'], { timeoutMs: 120_000 });
		console.log(b.ok ? '✓ dentro del presupuesto' : `✗ status ${b.status}`);
		resultados.push({
			clave: 'bundle',
			titulo: 'Presupuesto de bundle',
			tipo: 'auto',
			opcional: false,
			resultado: b.ok ? { estado: 'ok', detalle: 'dentro del presupuesto' } : { estado: 'fail', detalle: `status ${b.status}` }
		});
	}

	// Veredicto.
	const fallos = resultados.filter((r) => r.resultado.estado === 'fail');
	const pendientes = resultados.filter((r) => r.resultado.estado === 'pendiente');
	const noEjecutables = resultados.filter((r) => r.resultado.estado === 'no_ejecutable');

	console.log('');
	console.log('──────────────────────────────────────────────');
	if (fallos.length === 0 && pendientes.length === 0 && noEjecutables.length === 0) {
		console.log('  ✅ GO — todos los puntos del checklist pasan.');
		console.log('  Puedes proceder con el release a producción.');
		guardarReporte(resultados, { veredicto: 'GO' });
		process.exit(0);
	} else {
		console.log('  🚫 NO-GO — faltan puntos por verificar:');
		for (const r of fallos) console.log(`    ✗ ${r.titulo}`);
		for (const r of pendientes) console.log(`    ◌ ${r.titulo}`);
		for (const r of noEjecutables) console.log(`    — ${r.titulo} (no ejecutable aquí)`);
		console.log('');
		if (noEjecutables.length > 0) {
			console.log('  (—) Los items "no ejecutable" corren en el CI o requieren el entorno de staging.');
		}
		guardarReporte(resultados, { veredicto: 'NO-GO', fallos: fallos.length, pendientes: pendientes.length, noEjecutables: noEjecutables.length });
		process.exit(1);
	}
}

function guardarReporte(resultados, resumen) {
	if (!reportePath && !salidaJson) return;
	const doc = { generado_en: new Date().toISOString(), resumen, items: resultados.map((r) => ({ clave: r.clave, titulo: r.titulo, tipo: r.tipo, estado: r.resultado.estado, detalle: r.resultado.detalle })) };
	if (reportePath) {
		writeFileSync(join(RAIZ, reportePath), JSON.stringify(doc, null, 2) + '\n', 'utf8');
		console.log(`\n[go-no-go] Reporte guardado en ${reportePath}`);
	}
	if (salidaJson) {
		console.log('\n' + JSON.stringify(doc, null, 2));
	}
}

main();
