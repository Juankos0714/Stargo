import type { RequestHandler } from './$types';
import { manejarTabla } from '$lib/server/crud';

export const GET: RequestHandler = (event) => manejarTabla('tarifas', event);
export const POST: RequestHandler = (event) => manejarTabla('tarifas', event);
export const PUT: RequestHandler = (event) => manejarTabla('tarifas', event);
export const DELETE: RequestHandler = (event) => manejarTabla('tarifas', event);
