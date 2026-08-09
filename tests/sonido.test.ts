import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { ATAQUE, COOLDOWN, DURACION, MASTER, NOTAS, PARCIALES } from '../src/lib/sonido';

/**
 * Sintonía sonido.ts ↔ scripts/generar_sonido_notificacion.py.
 *
 * El WAV del push del sistema y la campana de Web Audio comparten la MISMA
 * firma sonora (notas, parciales, ataque, duración y pico). Este test lee el
 * script Python y comprueba que los parámetros exportados de sonido.ts no se
 * han desincronizado — si alguien cambia el sonido en un sitio, el otro debe
 * avisar fallando.
 */
const RUTA_SCRIPT = new URL('../scripts/generar_sonido_notificacion.py', import.meta.url);
const fuente = readFileSync(RUTA_SCRIPT, 'utf8');

/** `NOMBRE = 0.003` → 0.003 */
function extraerEscalar(nombre: string): number {
	const m = fuente.match(new RegExp(`^${nombre}\\s*=\\s*([0-9.]+)`, 'm'));
	if (!m) throw new Error(`No se encontró «${nombre}» en el script Python`);
	return Number(m[1]);
}

/** `NOMBRE: list[...] = [ (a, b), (a, b, c) ]` → filas de números */
function extraerLista(nombre: string): number[][] {
	// Hasta la primera «=» (el tipo `list[tuple[...]]` ya contiene corchetes).
	const bloque = fuente.match(new RegExp(`${nombre}:.*?=\\s*\\[([\\s\\S]*?)\\]`));
	if (!bloque) throw new Error(`No se encontró «${nombre}» en el script Python`);
	// matchAll sobre todo el bloque: aguanta reformateos (varias tuplas por
	// línea) y falla fuerte si la estructura cambia (se pierde una fila).
	return [...bloque[1].matchAll(/\(\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)/g)].map(
		(tupla) => tupla.slice(1).filter((x) => x !== undefined).map(Number)
	);
}

const NOTAS_PY = extraerLista('NOTAS');
const PARCIALES_PY = extraerLista('PARTIALES');
const ATAQUE_PY = extraerEscalar('ATAQUE');
const DURACION_PY = extraerEscalar('DURACION');
const PICO_PY = extraerEscalar('PICO');
const SR_PY = extraerEscalar('SR');

// --- Lector del WAV real ---------------------------------------------------

interface InfoWav {
	sampleRate: number;
	canales: number;
	bitsPorMuestra: number;
	duracion: number;
	pico: number;
}

/** Parser RIFF mínimo (sin dependencias) para el WAV de 16-bit del script. */
function leerWav(ruta: URL): InfoWav {
	const buf = readFileSync(ruta);
	if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
		throw new Error(`No es un WAV RIFF válido: ${ruta.pathname}`);
	}
	// Recorre chunks hasta encontrar `fmt` y `data` (respeta el alineado a 2
	// bytes y no asume que `fmt` sea el primer chunk).
	let offset = 12;
	let fmtInicio = -1;
	let dataInicio = -1;
	let dataBytes = 0;
	while (offset + 8 <= buf.length) {
		const id = buf.toString('ascii', offset, offset + 4);
		const tam = buf.readUInt32LE(offset + 4);
		if (id === 'fmt ' && fmtInicio < 0) fmtInicio = offset + 8;
		if (id === 'data') {
			dataInicio = offset + 8;
			dataBytes = tam;
			break;
		}
		offset += 8 + tam + (tam % 2);
	}
	if (fmtInicio < 0) throw new Error(`Chunk fmt no encontrado en ${ruta.pathname}`);
	if (dataInicio < 0) throw new Error(`Chunk data no encontrado en ${ruta.pathname}`);

	// Campos del chunk fmt (PCM estándar: formato, canales, sample rate, bits).
	// OJO: bits por muestra está en fmtInicio + 14 (byte 34 del archivo).
	// fmtInicio + 10 cae en la parte alta del byteRate (0 para 22050 Hz × 16
	// bits), lo que daba bits=0 → bytesPorMuestra=0 → frames=Infinity → el
	// loop de muestras nunca terminaba (bucle infinito, CPU al 100 %).
	const formato = buf.readUInt16LE(fmtInicio);
	const canales = buf.readUInt16LE(fmtInicio + 2);
	const sampleRate = buf.readUInt32LE(fmtInicio + 4);
	const bitsPorMuestra = buf.readUInt16LE(fmtInicio + 14);
	if (formato !== 1) throw new Error(`Formato de audio no PCM: ${formato}`);

	const bytesPorMuestra = Math.ceil(bitsPorMuestra / 8);
	// Guardia contra `frames = Infinity` (bucle infinito, CPU al 100 %): si
	// canales o bytesPorMuestra fuesen 0 — p. ej. un archivo distinto o un
	// reformateo del chunk fmt — se falla fuerte en vez de colgar.
	if (canales === 0 || bytesPorMuestra === 0) {
		throw new Error(`WAV inválido en ${ruta.pathname}: canales=${canales}, bits=${bitsPorMuestra}`);
	}
	const frames = Math.floor(dataBytes / (canales * bytesPorMuestra));
	let pico = 0;
	for (let i = 0; i < frames * canales; i++) {
		const v = buf.readInt16LE(dataInicio + i * bytesPorMuestra) / 32767;
		pico = Math.max(pico, Math.abs(v));
	}
	return { sampleRate, canales, bitsPorMuestra, duracion: frames / sampleRate, pico };
}

describe('sonido.ts — sintonía con scripts/generar_sonido_notificacion.py', () => {
	test('NOTAS: mismas notas (frecuencia y retraso del ding-dong)', () => {
		expect(NOTAS).toHaveLength(NOTAS_PY.length);
		NOTAS.forEach(([frec, retraso], i) => {
			expect(frec).toBeCloseTo(NOTAS_PY[i][0], 6);
			expect(retraso).toBeCloseTo(NOTAS_PY[i][1], 6);
		});
	});

	test('PARCIALES: mismo timbre (multiplicador, amplitud y decaimiento)', () => {
		expect(PARCIALES).toHaveLength(PARCIALES_PY.length);
		PARCIALES.forEach(([mult, amp, tau], i) => {
			expect(mult).toBeCloseTo(PARCIALES_PY[i][0], 6);
			expect(amp).toBeCloseTo(PARCIALES_PY[i][1], 6);
			expect(tau).toBeCloseTo(PARCIALES_PY[i][2], 6);
		});
	});

	test('ATAQUE y DURACION coinciden con el script', () => {
		expect(ATAQUE).toBeCloseTo(ATAQUE_PY, 6);
		expect(DURACION).toBeCloseTo(DURACION_PY, 6);
	});

	test('MASTER normaliza la mezcla al pico PICO del script (±0.02)', () => {
		// Replica la síntesis del script con los parámetros de sonido.ts y
		// comprueba que MASTER × picoCrudo ≈ PICO: la campana de Web Audio
		// suena tan fuerte como el WAV, sin recortar.
		// OJO: la fórmula debe espejar `campana()` en el script Python; si
		// cambia la envolvente, actualiza también este test.
		const picoCrudo = (() => {
			const n = Math.floor(DURACION * SR_PY);
			let pico = 0;
			for (let i = 0; i < n; i++) {
				const t = i / SR_PY;
				let valor = 0;
				for (const [f, t0] of NOTAS) {
					const dt = t - t0;
					if (dt < 0) continue;
					const ataque = Math.min(1, dt / ATAQUE);
					for (const [mult, amp, tau] of PARCIALES) {
						valor += amp * ataque * Math.exp(-dt / tau) * Math.sin(2 * Math.PI * f * mult * t);
					}
				}
				pico = Math.max(pico, Math.abs(valor));
			}
			return pico;
		})();
		expect(Math.abs(MASTER * picoCrudo - PICO_PY)).toBeLessThan(0.02);
	});

	test('COOLDOWN es mayor que DURACION (una ráfaga no solapa campanas)', () => {
		expect(COOLDOWN).toBeGreaterThanOrEqual(DURACION_PY * 1000);
	});
});

describe('static/sonidos/notificacion.wav — coincide con los parámetros del script', () => {
	// Un solo parseo para los cuatro tests (lectura + 35k muestras); el
	// cuelgue histórico de este bloque fue un bucle infinito del parser, no
	// la lectura en sí.
	const wav = leerWav(new URL('../static/sonidos/notificacion.wav', import.meta.url));

	test('el sample rate coincide con SR del script', () => {
		expect(wav.sampleRate).toBe(SR_PY);
	});

	test('la duración coincide con DURACION del script', () => {
		expect(wav.duracion).toBeCloseTo(DURACION_PY, 2);
	});

	test('el pico coincide con PICO del script (normalización al 92 %)', () => {
		expect(wav.pico).toBeCloseTo(PICO_PY, 2);
	});

	test('es mono y 16-bit, como declara el script', () => {
		expect(wav.canales).toBe(1);
		expect(wav.bitsPorMuestra).toBe(16);
	});
});
