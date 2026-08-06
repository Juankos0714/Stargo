#!/usr/bin/env node
/**
 * Parte 7 — Presupuesto de BUNDLE en CI.
 *
 * Tras `bun run build`, verifica que los assets del CLIENTE no hayan crecido
 * sin control (el bundle crece con cada feature nueva; sin un gate, se degrada
 * silenciosamente el rendimiento de los domiciliarios en móvil).
 *
 * Uso:
 *   bun run build && bun run bundle:budget
 *
 * Presupuestos (gzip, por tipo) configurables por env:
 *   BUNDLE_JS_KB   (default 450)  total JS del cliente en KB gzip
 *   BUNDLE_CSS_KB  (default 120)  total CSS del cliente en KB gzip
 *   BUNDLE_CHUNK_KB (default 250) el chunk JS individual más grande
 *
 * Sale con código 1 si se supera algún límite, 0 si está dentro.
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENTE = join(RAIZ, '.svelte-kit', 'output', 'client');
const LIMITE_JS = Number(process.env.BUNDLE_JS_KB ?? 450);
const LIMITE_CSS = Number(process.env.BUNDLE_CSS_KB ?? 120);
const LIMITE_CHUNK = Number(process.env.BUNDLE_CHUNK_KB ?? 250);

function listar(raiz, exts) {
	const salida = [];
	const pila = [raiz];
	while (pila.length > 0) {
		const dir = pila.pop();
		if (!existsSync(dir)) continue;
		for (const nombre of readdirSync(dir)) {
			const ruta = join(dir, nombre);
			if (statSync(ruta).isDirectory()) {
				pila.push(ruta);
			} else if (exts.some((e) => nombre.endsWith(e))) {
				salida.push(ruta);
			}
		}
	}
	return salida;
}

function kbGzip(ruta) {
	const buf = readFileSync(ruta);
	return gzipSync(buf).length / 1024;
}

if (!existsSync(CLIENTE)) {
	console.error(`[bundle] No se encontró ${CLIENTE}. Corre primero: bun run build`);
	process.exit(1);
}

const js = listar(CLIENTE, ['.js']);
const css = listar(CLIENTE, ['.css']);

const totalJs = js.reduce((acc, f) => acc + kbGzip(f), 0);
const totalCss = css.reduce((acc, f) => acc + kbGzip(f), 0);
const chunkMayor = Math.max(0, ...js.map(kbGzip));
const nroArchivos = js.length + css.length;

console.log(`[bundle] Assets del cliente (gzip):`);
console.log(`[bundle]   JS: ${totalJs.toFixed(1)} KB (${js.length} archivos)`);
console.log(`[bundle]   CSS: ${totalCss.toFixed(1)} KB (${css.length} archivos)`);
console.log(`[bundle]   Chunk JS mayor: ${chunkMayor.toFixed(1)} KB`);

const fallos = [];
if (totalJs > LIMITE_JS) fallos.push(`JS total ${totalJs.toFixed(1)} KB > ${LIMITE_JS} KB`);
if (totalCss > LIMITE_CSS) fallos.push(`CSS total ${totalCss.toFixed(1)} KB > ${LIMITE_CSS} KB`);
if (chunkMayor > LIMITE_CHUNK) fallos.push(`Chunk JS mayor ${chunkMayor.toFixed(1)} KB > ${LIMITE_CHUNK} KB`);

if (fallos.length > 0) {
	console.error(`[bundle] ✗ Presupuesto de bundle superado (${nroArchivos} archivos):`);
	for (const f of fallos) console.error(`[bundle]   - ${f}`);
	console.error('[bundle] Reduce dependencias o divide los imports dinámicamente.');
	process.exit(1);
}
console.log(`[bundle] ✓ Dentro del presupuesto (${nroArchivos} archivos, JS≤${LIMITE_JS} KB, CSS≤${LIMITE_CSS} KB).`);
