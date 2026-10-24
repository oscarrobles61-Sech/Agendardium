// Crea las tablas en Neon: DATABASE_URL=... npm run db:setup
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL (copiá .env.example a .env.local o exportala).');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);
const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
for (const stmt of schema.split(';').map(s => s.replace(/--.*$/gm, '').trim()).filter(Boolean)) {
  await sql.query(stmt);
}
console.log('Tablas listas.');
