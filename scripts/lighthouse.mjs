#!/usr/bin/env node
/**
 * Parte 7 — Auditoría LIGHTHOUSE (opcional, corre en tu máquina).
 *
 * Mide Core Web Vitals (LCP, CLS, TBT) de las vistas críticas con el
 * presupuesto que define la Parte 7: "Core Web Vitals aceptables en mobile
 * con conexión 3G/4G simulada (los domiciliarios usan la app en movimiento)".
 *
 * Requiere Chrome y la app corriendo:
 *   bun run preview          # en otra terminal (o usa la URL desplegada)
 *   LH_URL=http://127.0.0.1:4175 bun run perf:lighthouse
 *
 * Sale con código 1 si algún presupuesto de Core Web Vitals se supera.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.LH_URL || 'http://127.0.0.1:4175';
const VISTAS = (process.env.LH_VISTAS || '/nuevo-pedido,/,/admin').split(',');

// Presupuestos (Core Web Vitals) — Parte 7.
const PRESUPUESTO = {
	'first-contentful-paint': 2000,
	'largest-contentful-paint': 2500,
	'cumulative-layout-shift': 0.1,
	'total-blocking-time': 200
};

const dir = mkdtempSync(join(tmpdir(), 'lh-'));
const rutaSalida = join(dir, 'report.json');

for (const vista of VISTAS) {
	const url = URL + vista.trim();
	console.log(`[perf] Auditando ${url}…`);
	// La Parte 7 pide simular mobile con red 3G/4G: --preset=mobile aplica el
	// throttling por defecto de Lighthouse (CPU 4x + red lenta de mobile).
	const r = spawnSync(
		'npx',
		[
			'lighthouse',
			url,
			'--quiet',
			'--chrome-flags=--headless --no-sandbox',
			'--output=json',
			`--output-path=${rutaSalida}`,
			'--preset=mobile'
		],
		{ stdio: 'inherit' }
	);
	if (r.status !== 0) {
		console.error(`[perf] Lighthouse falló para ${url} (¿Chrome instalado?)`);
		process.exitCode = 1;
		continue;
	}

	const reporte = JSON.parse(readFileSync(rutaSalida, 'utf-8'));
	const a = reporte.audits;
	const leer = (id) => Number(a[id]?.numericValue ?? a[id]?.displayValue ?? NaN);

	const resultados = {
		'first-contentful-paint': leer('first-contentful-paint'),
		'largest-contentful-paint': leer('largest-contentful-paint'),
		'cumulative-layout-shift': leer('cumulative-layout-shift'),
		'total-blocking-time': leer('total-blocking-time')
	};
	console.log(`[perf] ${vista}:`, JSON.stringify(resultados));

	for (const [metrica, limite] of Object.entries(PRESUPUESTO)) {
		const valor = resultados[metrica];
		if (Number.isFinite(valor) && valor > limite) {
			console.error(`[perf] ✗ ${vista}: ${metrica} ${valor} > presupuesto ${limite}`);
			process.exitCode = 1;
		}
	}
}

if (process.exitCode) console.error('[perf] Se superó algún presupuesto de Core Web Vitals.');
else console.log('[perf] ✓ Todas las vistas dentro del presupuesto.');
