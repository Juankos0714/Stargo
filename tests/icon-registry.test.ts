import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iconos } from '../src/lib/components/icon-registry';

// --- Escaneo de la app -----------------------------------------------------

const srcDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../src');

/** Lista recursiva de archivos .svelte bajo un directorio. */
function archivosSvelte(dir: string): string[] {
	const resultado: string[] = [];
	for (const entrada of readdirSync(dir)) {
		const ruta = join(dir, entrada);
		if (statSync(ruta).isDirectory()) {
			resultado.push(...archivosSvelte(ruta));
		} else if (ruta.endsWith('.svelte')) {
			resultado.push(ruta);
		}
	}
	return resultado;
}

const contenidoSvelte = archivosSvelte(srcDir).map((f) => readFileSync(f, 'utf8'));

/** Nombres literales: <Icon name="x" ... /> (usos directos del componente). */
const usosLiterales = contenidoSvelte
	.flatMap((c) => [...c.matchAll(/<Icon\b[^>]*\bname="([^"]+)"/g)])
	.map((m) => m[1]);

/** Nombres en expresiones: <Icon name={... ? 'x' : 'y'} /> (ternarios, como el
 *  control de volumen o el tipo de notificación). Se extraen los strings
 *  citados dentro del atributo `name={...}` y se conservan SOLO los que ya
 *  son iconos del registro (los demás son valores de datos, p. ej. el tipo
 *  de notificación 'nuevo_pedido'). */
const usosEnExpresion = contenidoSvelte
	.flatMap((c) => [...c.matchAll(/name=\{([^}]*)\}/g)])
	.flatMap((m) => [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((s) => s[1]))
	.filter((n) => n in iconos);

/** Nombres dinámicos: icon: 'x' (arrays de navegación/acciones del panel admin). */
const usosDinamicos = contenidoSvelte
	.flatMap((c) => [...c.matchAll(/\bicon:\s*['"]([^'"]+)['"]/g)])
	.map((m) => m[1]);

const nombresUsados = [...new Set([...usosLiterales, ...usosEnExpresion, ...usosDinamicos])];

// --- Tests -----------------------------------------------------------------

describe('registro de iconos (icon-registry.ts)', () => {
	test('todos los iconos usados en la app existen en el registro', () => {
		const faltantes = nombresUsados.filter((n) => !(n in iconos));
		expect(
			faltantes,
			`Icono(s) usado(s) en la app pero no registrado(s) en icon-registry.ts: ${faltantes.join(', ')}`
		).toEqual([]);
	});

	test('todas las entradas del registro son iconos de Font Awesome válidos', () => {
		for (const [nombre, icono] of Object.entries(iconos)) {
			expect(typeof icono?.iconName, `El registro «${nombre}» no tiene iconName`).toBe('string');
			expect(typeof icono?.prefix, `El registro «${nombre}» no tiene prefix`).toBe('string');
		}
	});

	test('no hay iconos registrados que no se usen en la app (entradas muertas)', () => {
		const sinUso = Object.keys(iconos).filter(
			(n) =>
				!contenidoSvelte.some(
					(c) =>
						new RegExp(`name=["']${n}["']`).test(c) ||
						new RegExp(`name=\\{[^}]*['"]${n}['"][^}]*\\}`).test(c) ||
						new RegExp(`icon:\\s*['"]${n}['"]`).test(c)
				)
		);
		expect(
			sinUso,
			`Icono(s) registrado(s) pero sin uso en la app (¿se borró la vista que lo usaba?): ${sinUso.join(', ')}`
		).toEqual([]);
	});

	test('el escaneo detecta usos reales (hay iconos usados y registrados)', () => {
		expect(nombresUsados.length).toBeGreaterThan(0);
		expect(Object.keys(iconos).length).toBeGreaterThan(0);
	});
});
