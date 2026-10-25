import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

// Colecciones que usa la agenda. Cualquier otra se rechaza.
export const COLLECTIONS = new Set([
  'config', 'users', 'agenda', 'patients', 'billing', 'news', 'backups', 'backupidx', 'meta'
]);

let client: NeonQueryFunction<false, false> | null = null;

export const hasDb = () => !!process.env.DATABASE_URL;

export function sql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está configurada');
  if (!client) client = neon(process.env.DATABASE_URL);
  return client;
}

export class BadRequest extends Error {}

export function checkCol(col: unknown): string {
  if (typeof col !== 'string' || !COLLECTIONS.has(col)) throw new BadRequest('colección inválida');
  return col;
}

export function checkId(id: unknown): string {
  if (typeof id !== 'string' || !id || id.length > 200) throw new BadRequest('id inválido');
  return id;
}

export const FIELD = /^[A-Za-z0-9_]{1,64}$/;
