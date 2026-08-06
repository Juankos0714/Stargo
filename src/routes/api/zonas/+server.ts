import type { RequestHandler } from './$types';
import { manejarTabla } from '$lib/server/crud';

export const GET: RequestHandler = (event) => manejarTabla('zonas', event);
export const POST: RequestHandler = (event) => manejarTabla('zonas', event);
export const PUT: RequestHandler = (event) => manejarTabla('zonas', event);
export const DELETE: RequestHandler = (event) => manejarTabla('zonas', event);
