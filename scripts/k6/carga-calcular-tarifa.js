/**
 * Parte 7 — Prueba de CARGA: cálculo de tarifa (el path más transitado).
 *
 * Dispara POST /api/calcular_tarifa con barrios reales. Es la query más
 * frecuente del sistema: no debe degradarse bajo carga.
 *
 * Uso:
 *   k6 run --vus 30 --duration 1m scripts/k6/carga-calcular-tarifa.js
 *
 * Variables de entorno:
 *   K6_BASE_URL   URL de la app (default http://127.0.0.1:4175)
 *
 * El punto de quiebre se identifica subiendo VUs hasta que el p95 de
 * latencia crece de forma no lineal o aparecen errores (docs/REPORTE_CARGA.md).
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.K6_BASE_URL || 'http://127.0.0.1:4175';

export const options = {
	scenarios: {
		rampa: {
			executor: 'ramping-vus',
			startVUs: 0,
			stages: [
				{ duration: '1m', target: 50 },
				{ duration: '2m', target: 50 },
				{ duration: '30s', target: 0 }
			],
			gracefulRampDown: '30s'
		}
	},
	thresholds: {
		http_req_failed: ['rate<0.005'],
		http_req_duration: ['p(95)<1000']
	}
};

export function setup() {
	const res = http.get(`${BASE_URL}/api/barrios?select=id,zona_id`);
	if (res.status !== 200) {
		throw new Error(`No se pudieron cargar los barrios (HTTP ${res.status})`);
	}
	const barrios = JSON.parse(res.body).filter((b) => b.zona_id);
	if (barrios.length < 2) {
		throw new Error('El catálogo necesita al menos 2 barrios con zona asignada.');
	}
	return { pares: barrios };
}

export default function (data) {
	const b = data.pares;
	const origen = b[__VU % b.length].id;
	const destino = b[(__VU + 1) % b.length].id;
	const res = http.post(
		`${BASE_URL}/api/calcular_tarifa`,
		JSON.stringify({ barrio_origen: origen, barrio_destino: destino }),
		{ headers: { 'Content-Type': 'application/json' } }
	);
	check(res, {
		'calcular_tarifa responde 200': (r) => r.status === 200,
		'respuesta con valor o meta': (r) => {
			try {
				const body = JSON.parse(r.body);
				return typeof body.valor === 'number' || typeof body.meta === 'object';
			} catch {
				return false;
			}
		}
	});
	sleep(0.2);
}
