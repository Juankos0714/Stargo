import type { RequestHandler } from './$types';
import { manejarTabla } from '$lib/server/crud';

/**
 * CRUD de recargos (Fase 7):
 *   GET    /api/recargos             → lectura pública (?select=, ?orden=, ?filtro=col=val)
 *   POST   /api/recargos             → solo admin ({ op:'insert'|'upsert', filas:[...] })
 *   PUT    /api/recargos?filtro=codigo=x → solo admin ({ datos:{...} })
 *   DELETE /api/recargos?filtro=codigo=x → solo admin
 */
export const GET: RequestHandler = (event) => manejarTabla('recargos', event);
export const POST: RequestHandler = (event) => manejarTabla('recargos', event);
export const PUT: RequestHandler = (event) => manejarTabla('recargos', event);
export const DELETE: RequestHandler = (event) => manejarTabla('recargos', event);
