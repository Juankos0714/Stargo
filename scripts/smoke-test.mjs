#!/usr/bin/env node
/**
 * Parte 8 — SMOKE TEST post-deploy.
 *
 * Detecta en segundos si un deploy rompió algo en producción real, a través
 * de la app REAL (HTTP de verdad, sin mocks):
 *   1. GET /api/health              → la app responde y Supabase conecta.
 *   2. POST /api/login (admin)      → sesión de un usuario de prueba admin.
 *   3. GET /api/barrios + POST /api/calcular_tarifa → el cálculo responde.
 *   4. POST /api/pedidos            → crear un pedido de prueba.
 *   5. POST /api/pedidos/cancelar   → cancelarlo (limpia datos).
 *   6. POST /api/login (domiciliario) → el rol domiciliario también entra.
 *
 * Configuración (env):
 *   SMOKE_URL                  base de la app (producción).
 *   SMOKE_ADMIN_EMAIL/PASSWORD credenciales del usuario de prueba admin.
 *   SMOKE_DOM_EMAIL/PASSWORD   credenciales del usuario de prueba domiciliario.
 *
 * Sin credenciales → se omite (exit 0) para que el job de CI no falle cuando
 * aún no están configuradas. Con ellas, cualquier fallo → exit 1.
 *
 * El CI lo corre en .github/workflows/smoke-postdeploy.yml inmediatamente
 * después de cada deploy a producción (Vercel + GitHub Actions).
 */
const URL_BASE = (process.env.SMOKE_URL || '').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD;
const DOM_EMAIL = process.env.SMOKE_DOM_EMAIL;
const DOM_PASSWORD = process.env.SMOKE_DOM_PASSWORD;

if (!URL_BASE || !ADMIN_EMAIL || !ADMIN_PASSWORD || !DOM_EMAIL || !DOM_PASSWORD) {
	console.log('[smoke] Faltan SMOKE_URL / SMOKE_ADMIN_* / SMOKE_DOM_* — smoke test omitido.');
	console.log('[smoke]   Configúralos como secretos del repo y corre el workflow smoke-postdeploy.');
	process.exit(0);
}

let fallos = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const falla = (msg) => {
	fallos++;
	console.error(`  ✗ ${msg}`);
};

async function peticion(path, { metodo = 'GET', cuerpo, cookies = '' } = {}) {
	const res = await fetch(`${URL_BASE}${path}`, {
		method: metodo,
		headers: {
			Accept: 'application/json',
			...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
			...(cookies ? { Cookie: cookies } : {})
		},
		body: cuerpo ? JSON.stringify(cuerpo) : undefined
	});
	let data = null;
	try {
		data = await res.json();
	} catch {
		// cuerpo no JSON
	}
	return { res, data, setCookie: res.headers.get('set-cookie') ?? '' };
}

console.log(`[smoke] Smoke test contra ${URL_BASE}`);

// 1. Health: la app responde y Supabase conecta.
try {
	const { res, data } = await peticion('/api/health');
	if (res.status === 200 && data?.ok === true) ok(`/api/health → ok (Supabase ${data.supabase}, ${data.latencia_ms}ms)`);
	else falla(`/api/health → HTTP ${res.status}, ok=${data?.ok} (${data?.supabase})`);
} catch (e) {
	falla(`/api/health → sin respuesta: ${e.message}`);
}

// 2. Login admin.
try {
	const { res, data } = await peticion('/api/login', {
		metodo: 'POST',
		cuerpo: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
	});
	if (res.status === 200 && data?.data?.esAdmin) {
		ok('login admin OK');
	} else {
		falla(`login admin → HTTP ${res.status}: ${data?.error ?? 'sin datos'}`);
	}
} catch (e) {
	falla(`login admin → ${e.message}`);
}

// 3. Cálculo de tarifa (path más transitado).
let barrios = [];
try {
	const { res, data } = await peticion('/api/barrios?select=id,zona_id&orden=nombre');
	if (res.status === 200 && Array.isArray(data)) {
		barrios = data.filter((b) => b.zona_id);
		if (barrios.length >= 2) {
			const { res: r2, data: d2 } = await peticion('/api/calcular_tarifa', {
				metodo: 'POST',
				cuerpo: { barrio_origen: barrios[0].id, barrio_destino: barrios[1].id }
			});
			if (r2.status === 200 && typeof d2?.valor === 'number') ok(`cálculo de tarifa OK (${d2.valor})`);
			else falla(`calcular_tarifa → HTTP ${r2.status}`);
		} else {
			falla('no hay ≥2 barrios con zona para probar la tarifa');
		}
	} else {
		falla(`/api/barrios → HTTP ${res.status}`);
	}
} catch (e) {
	falla(`cálculo de tarifa → ${e.message}`);
}

// 4. Crear y 5. cancelar un pedido de prueba (la cancelación es best-effort
// para no dejar datos reales en producción aunque algo falle en el camino).
let numeroPrueba = '';
if (barrios.length >= 2) {
	try {
		const marca = `SMOKE ${Date.now()}`;
		const { res, data } = await peticion('/api/pedidos', {
			metodo: 'POST',
			cuerpo: {
				barrio_origen: barrios[0].id,
				direccion_origen: `Smoke origen ${marca}`,
				barrio_destino: barrios[1].id,
				direccion_destino: `Smoke destino ${marca}`,
				observaciones: marca,
				recargos: [],
				// Fase 19: el teléfono es obligatorio al crear el pedido.
				telefono: '3001234567'
			}
		});
		if (res.status === 200 && data?.data?.numero) {
			numeroPrueba = data.data.numero;
			ok(`pedido de prueba creado (${numeroPrueba})`);
		} else {
			falla(`crear pedido → HTTP ${res.status}: ${data?.error ?? ''}`);
		}
	} catch (e) {
		falla(`crear pedido → ${e.message}`);
	}
}

try {
	if (numeroPrueba) {
		const { res } = await peticion('/api/pedidos/cancelar', {
			metodo: 'POST',
			cuerpo: { numero: numeroPrueba, motivo: 'Smoke test post-deploy' }
		});
		if (res.status === 200) ok('pedido de prueba cancelado (datos limpios)');
		else falla(`cancelar pedido → HTTP ${res.status}`);
	}
} catch (e) {
	falla(`cancelar pedido → ${e.message}`);
}

// 6. Login domiciliario (segundo rol).
try {
	const { res, data } = await peticion('/api/login', {
		metodo: 'POST',
		cuerpo: { email: DOM_EMAIL, password: DOM_PASSWORD }
	});
	if (res.status === 200 && data?.data?.esDomiciliario) ok('login domiciliario OK');
	else falla(`login domiciliario → HTTP ${res.status}: ${data?.error ?? ''}`);
} catch (e) {
	falla(`login domiciliario → ${e.message}`);
}

if (fallos > 0) {
	console.error(`[smoke] ✗ ${fallos} chequeo(s) fallaron — el deploy no está sano.`);
	process.exit(1);
}
console.log('[smoke] ✓ Todos los chequeos pasaron.');
