/**
 * Genera src/lib/components/iconos-data.ts a partir de los iconos Font
 * Awesome (solid) usados por la app.
 *
 * Renderizar los iconos como SVG estático (datos en un módulo TS) elimina el
 * runtime de FontAwesome (@fortawesome/fontawesome-svg-core + svelte-fontawesome)
 * del bundle del cliente: menos JS que descargar y menos trabajo en el hilo
 * principal (TBT/LCP).
 *
 *   bun scripts/generar-iconos.ts
 *
 * Para añadir un icono: agrégalo a la lista de abajo (nombre kebab → export FA)
 * y vuelve a ejecutar el script.
 */
import { writeFileSync } from 'node:fs';
import {
	faArrowRight,
	faArrowRightArrowLeft,
	faArrowRotateRight,
	faArrowTrendUp,
	faBan,
	faBars,
	faBell,
	faBolt,
	faCalendarDays,
	faCartShopping,
	faChartColumn,
	faCheck,
	faCircleCheck,
	faCircleInfo,
	faClipboardList,
	faClock,
	faClockRotateLeft,
	faCoins,
	faCommentSms,
	faDownload,
	faFaceSmileBeam,
	faFloppyDisk,
	faGaugeHigh,
	faHouse,
	faLayerGroup,
	faLightbulb,
	faLocationDot,
	faMagnifyingGlass,
	faMagnifyingGlassLocation,
	faMapLocationDot,
	faPenToSquare,
	faPhone,
	faPlus,
	faReceipt,
	faRightFromBracket,
	faSun,
	faTableCells,
	faTicket,
	faTriangleExclamation,
	faTruck,
	faTruckFast,
	faUsers,
	faVolumeHigh,
	faVolumeXmark,
	faXmark
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';

const ICONOS: Array<[string, IconDefinition]> = [
	['arrow-right', faArrowRight],
	['arrows-left-right', faArrowRightArrowLeft],
	['arrow-rotate-right', faArrowRotateRight],
	['arrow-trend-up', faArrowTrendUp],
	['ban', faBan],
	['bars', faBars],
	['bell', faBell],
	['bolt', faBolt],
	['calendar-days', faCalendarDays],
	['cart-shopping', faCartShopping],
	['chart-column', faChartColumn],
	['check', faCheck],
	['circle-check', faCircleCheck],
	['circle-info', faCircleInfo],
	['clipboard-list', faClipboardList],
	['clock', faClock],
	['clock-rotate-left', faClockRotateLeft],
	['coins', faCoins],
	['comment-sms', faCommentSms],
	['download', faDownload],
	['face-smile-beam', faFaceSmileBeam],
	['floppy-disk', faFloppyDisk],
	['gauge-high', faGaugeHigh],
	['house', faHouse],
	['layer-group', faLayerGroup],
	['lightbulb', faLightbulb],
	['location-dot', faLocationDot],
	['magnifying-glass', faMagnifyingGlass],
	['magnifying-glass-location', faMagnifyingGlassLocation],
	['map-location-dot', faMapLocationDot],
	['pen-to-square', faPenToSquare],
	['phone', faPhone],
	['plus', faPlus],
	['receipt', faReceipt],
	['right-from-bracket', faRightFromBracket],
	['sun', faSun],
	['table-cells', faTableCells],
	['ticket', faTicket],
	['triangle-exclamation', faTriangleExclamation],
	['truck', faTruck],
	['truck-fast', faTruckFast],
	['users', faUsers],
	['volume-high', faVolumeHigh],
	['volume-xmark', faVolumeXmark],
	['xmark', faXmark]
];

const lineas: string[] = [];
lineas.push('// GENERADO por scripts/generar-iconos.ts — NO editar a mano.');
lineas.push('// Datos SVG de Font Awesome (solid) para renderizar iconos como');
lineas.push('// SVG estático, sin el runtime de FontAwesome en el cliente.');
lineas.push('');
lineas.push('export interface Icono {');
lineas.push('\ticonName: string;');
lineas.push('\tprefix: string;');
lineas.push('\tw: number;');
lineas.push('\th: number;');
lineas.push('\td: string | string[];');
lineas.push('}');
lineas.push('');
lineas.push('export const iconos: Record<string, Icono> = {');
for (const [nombre, icono] of ICONOS) {
	const [w, h, , , d] = icono.icon;
	const dTexto = Array.isArray(d) ? `[${d.map((x) => JSON.stringify(x)).join(', ')}]` : JSON.stringify(d);
	lineas.push(
		`\t${JSON.stringify(nombre)}: { iconName: ${JSON.stringify(icono.iconName)}, prefix: ${JSON.stringify(icono.prefix)}, w: ${w}, h: ${h}, d: ${dTexto} },`
	);
}
lineas.push('};');
lineas.push('');
writeFileSync(new URL('../src/lib/components/iconos-data.ts', import.meta.url), lineas.join('\n'), 'utf8');
console.log(`✔ iconos-data.ts generado (${ICONOS.length} iconos)`);
