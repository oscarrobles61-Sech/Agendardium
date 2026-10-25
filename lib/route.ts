import { type NextRequest, NextResponse } from 'next/server';
import { Forbidden } from './access';
import { currentUser, type Me } from './auth';
import { BadRequest, hasDb } from './db';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

function fail(e: unknown) {
  if (e instanceof BadRequest) return json({ error: e.message }, 400);
  if (e instanceof Forbidden) return json({ error: e.message }, 403);
  console.error(e);
  return json({ error: 'error de base de datos' }, 500);
}

// Envuelve un handler: verifica que haya base configurada y traduce errores a JSON.
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A) => {
    if (!hasDb()) return json({ error: 'DATABASE_URL no está configurada' }, 503);
    try { return json(await fn(...args)); } catch (e) { return fail(e); }
  };
}

// Igual que handler, pero exige una sesión iniciada y pasa el usuario actual.
export function authed(fn: (req: NextRequest, me: Me) => Promise<unknown>) {
  return async (req: NextRequest) => {
    if (!hasDb()) return json({ error: 'DATABASE_URL no está configurada' }, 503);
    try {
      const me = await currentUser(req);
      if (!me) return json({ error: 'Tenés que ingresar con tu DNI.' }, 401);
      return json(await fn(req, me));
    } catch (e) { return fail(e); }
  };
}
