import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

// Colecciones que usa la agenda. Cualquier otra se rechaza.
export const COLLECTIONS = new Set([
  'config', 'users', 'agenda', 'patients', 'billing', 'news', 'backups', 'backupidx', 'meta'
]);

let client: NeonQueryFunction<false, false> | null = null;
let schemaReady: Promise<void> | null = null;

export const hasDb = () => !!process.env.DATABASE_URL;

export function sql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está configurada');
  if (!client) client = neon(process.env.DATABASE_URL);
  return client;
}

// Crea las tablas la primera vez (idempotente). También se puede correr `npm run db:setup`.
export function ensureSchema() {
  if (!schemaReady) {
    const q = sql();
    schemaReady = (async () => {
      await q`CREATE TABLE IF NOT EXISTS docs (
        col text NOT NULL,
        id text NOT NULL,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (col, id)
      )`;
      await q`CREATE INDEX IF NOT EXISTS docs_agenda_week ON docs ((data->>'week')) WHERE col = 'agenda'`;
      await q`CREATE TABLE IF NOT EXISTS doc_versions (col text PRIMARY KEY, v bigint NOT NULL DEFAULT 0)`;
    })().catch(e => { schemaReady = null; throw e; });
  }
  return schemaReady;
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
