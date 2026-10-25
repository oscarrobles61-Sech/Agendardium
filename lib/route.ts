import { NextResponse } from 'next/server';
import { BadRequest, hasDb } from './db';

// Envuelve un handler: verifica que haya base configurada y traduce errores a JSON.
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A) => {
    if (!hasDb()) return NextResponse.json({ error: 'DATABASE_URL no está configurada' }, { status: 503 });
    try {
      return NextResponse.json(await fn(...args), { headers: { 'cache-control': 'no-store' } });
    } catch (e) {
      if (e instanceof BadRequest) return NextResponse.json({ error: e.message }, { status: 400 });
      console.error(e);
      return NextResponse.json({ error: 'error de base de datos' }, { status: 500 });
    }
  };
}
