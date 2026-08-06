/**
 * Parte 7 — Prueba de CARGA: creación de pedidos (hora pico).
 *
 * Simula N pedidos/minuto contra la app real (preview local o desplegada).
 * Usa barrios reales del catálogo (los obtiene de /api/barrios en setup).
 *
 * Uso:
 *   k6 run --vus 10 --duration 1m scripts/k6/carga-crear-pedidos.js
 *
 * Variables de entorno:
 *   K6_BASE_URL   URL de la app (default http://127.0.0.1:4175)
 *
 * Escenario por defecto: rampa hasta 20 VUs en 1 min y meseta de 2 min, con
 * ~1 petición por iteración. El "punto de quiebre" se identifica subiendo
 * VUs/duration hasta que el p95 crece o aparecen errores (ver
 * docs/REPORTE_CARGA.md).
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
				{ duration: '1m', target: 20 },
				{ duration: '2m', target: 20 },
				{ duration: '30s', target: 0 }
			],
			gracefulRampDown: '30s'
		}
	},
	thresholds: {
		http_req_failed: ['rate<0.01'],
		http_req_duration: ['p(95)<1500']
	}
};

/** Obtiene dos barrios con zona asignada para crear pedidos reales. */
export function setup() {
	const res = http.get(`${BASE_URL}/api/barrios?select=id,zona_id`);
	if (res.status !== 200) {
		throw new Error(`No se pudieron cargar los barrios (HTTP ${res.status})`);
	}
	const barrios = JSON.parse(res.body);
	const conZona = barrios.filter((b) => b.zona_id);
	if (conZona.length < 2) {
		throw new Error('El catálogo necesita al menos 2 barrios con zona asignada.');
	}
	return { origen: conZona[0].id, destino: conZona[1].id };
}

export default function (data) {
	const payload = JSON.stringify({
		barrio_origen: data.origen,
		direccion_origen: 'Calle de carga ' + __VU + ' # ' + __ITER,
		barrio_destino: data.destino,
		direccion_destino: 'Carrera de carga ' + __VU,
		observaciones: 'carga k6',
		recargos: []
	});
	const res = http.post(`${BASE_URL}/api/pedidos`, payload, {
		headers: { 'Content-Type': 'application/json' }
	});
	check(res, {
		'crear pedido responde 201/200': (r) => r.status === 200 || r.status === 201,
		'devuelve número de pedido': (r) => {
			try {
				return typeof JSON.parse(r.body).data?.numero === 'string';
			} catch {
				return false;
			}
		}
	});
	sleep(0.5);
}
