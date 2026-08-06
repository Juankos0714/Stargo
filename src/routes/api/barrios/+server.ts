import type { RequestHandler } from './$types';
import { manejarTabla } from '$lib/server/crud';

export const GET: RequestHandler = (event) => manejarTabla('barrios', event);
export const POST: RequestHandler = (event) => manejarTabla('barrios', event, { dedupePor: 'nombre' });
export const PUT: RequestHandler = (event) => manejarTabla('barrios', event);
export const DELETE: RequestHandler = (event) => manejarTabla('barrios', event);
