import { json, type RequestEvent } from '@sveltejs/kit';
import { getSupabaseAnon, getSupabaseAsUser } from './supabase';
import { requireAdmin } from './auth';

type Tabla = 'zonas' | 'barrios' | 'tarifas' | 'recargos';



function parseFiltros(url: URL): Record<string, string> {
	const filtros: Record<string, string> = {};
	for (const f of url.searchParams.getAll('filtro')) {
		const idx = f.indexOf('=');
		if (idx <= 0) continue;
		filtros[f.slice(0, idx)] = f.slice(idx + 1);
	}
	return filtros;
}

/**
 * Handler CRUD genérico, espejo de `manejadorTabla()` de la app vanilla:
 *
 *   GET    /api/tabla            → lectura pública
 *          ?select=col1,col2     (columnas)
 *          ?orden=col            (orden)
 *          ?filtro=col=val       (repetible)
 *   POST   /api/tabla            → solo admin
 *          { op: 'insert'|'upsert', filas: [...], onConflict?: 'a,b' }
 *   PUT    /api/tabla?filtro=id=x→ solo admin
 *          { datos: {...} }
 *   DELETE /api/tabla?filtro=id=x → solo admin
 */
export async function manejarTabla(tabla: Tabla, event: RequestEvent, opts: { dedupePor?: string } = {}) {
	const url = new URL(event.request.url);
	const method = event.request.method;

	// ---------- LECTURA (pública) ----------
	if (method === 'GET') {
		const select = url.searchParams.get('select') ?? '*';
		const orden = url.searchParams.get('orden');
		let q: any = getSupabaseAnon().from(tabla).select(select);
		for (const [k, v] of Object.entries(parseFiltros(url))) q = q.eq(k, v);
		if (orden) q = q.order(orden);
		const { data, error: err } = await q;
		if (err) return json({ error: err.message }, { status: 500 });
		return json({ data: data ?? [] });
	}

	// ---------- ESCRITURA (solo admin) ----------
	const sesion = await requireAdmin(event);
	const db = getSupabaseAsUser(sesion.accessToken);

	if (method === 'POST') {
		const body = await event.request.json().catch(() => null);
		if (!body) return json({ error: 'Body inválido' }, { status: 400 });

		const op: string = body.op ?? 'insert';
		const filas: Record<string, unknown>[] = Array.isArray(body.filas)
			? body.filas
			: body.datos
				? [body.datos]
				: [];
		if (filas.length === 0) return json({ error: 'No se enviaron filas' }, { status: 400 });

		let aInsertar = filas;

		// Dedupe (barrios se identifican por nombre, sin índice único).
		const campo = opts.dedupePor;
		if (campo) {
			const nombres = filas.map((f) => String(f[campo] ?? ''));
			const { data: existentes, error: errEx } = await db.from(tabla).select(campo).in(campo, nombres);
			if (errEx) return json({ error: errEx.message }, { status: 400 });
			const filasExistentes = (existentes ?? []) as unknown as Array<Record<string, unknown>>;
			const set = new Set(filasExistentes.map((r) => String(r[campo]).toLowerCase()));
			aInsertar = filas.filter((f) => !set.has(String(f[campo] ?? '').toLowerCase()));
			if (aInsertar.length === 0) return json({ data: [], ignoradas: nombres.length });
		}

		if (op === 'upsert') {
			const onConflict = body.onConflict;
			if (!onConflict) return json({ error: 'upsert requiere onConflict' }, { status: 400 });
			const { data, error: err } = await db.from(tabla).upsert(aInsertar, { onConflict }).select();
			if (err) return json({ error: err.message }, { status: 400 });
			return json({ data: data ?? [] });
		}

		const { data, error: err } = await db.from(tabla).insert(aInsertar).select();
		if (err) return json({ error: err.message }, { status: 400 });
		return json({ data: data ?? [] });
	}

	const filtros = parseFiltros(url);
	if (Object.keys(filtros).length === 0) {
		return json({ error: `Falta filtro para ${method}` }, { status: 400 });
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function aplicarFiltros(q: any): any {
		for (const [k, v] of Object.entries(filtros)) q = q.eq(k, v);
		return q;
	}

	if (method === 'PUT') {
		const body = await event.request.json().catch(() => null);
		const datos = body?.datos;
		if (!datos || typeof datos !== 'object') {
			return json({ error: 'Falta datos' }, { status: 400 });
		}
		const { data, error: err } = await aplicarFiltros(db.from(tabla).update(datos)).select();
		if (err) return json({ error: err.message }, { status: 400 });
		return json({ data: data ?? [] });
	}

	if (method === 'DELETE') {
		const { data, error: err } = await aplicarFiltros(db.from(tabla).delete()).select();
		if (err) return json({ error: err.message }, { status: 400 });
		return json({ data: data ?? [] });
	}

	return json({ error: 'Método no soportado' }, { status: 405 });
}
