// Aplica las migraciones de Prisma (corre en cada build de Vercel y con `npm run db:migrate`).
// Si la base ya tenía las tablas creadas por la versión anterior de la app y nunca se migró con
// Prisma (error P3005), aplica la migración inicial, que es idempotente, la marca como hecha y sigue.
import { spawnSync } from 'node:child_process';

const INIT = '20261025000000_init';

if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_UNPOOLED) {
  console.error('Falta DATABASE_URL: no se aplican migraciones.');
  process.exit(1);
}

const prisma = args => {
  const r = spawnSync('npx', ['prisma', ...args], { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
};

let r = prisma(['migrate', 'deploy']);
if (!r.ok && r.out.includes('P3005')) {
  console.log('Base existente sin historial de Prisma: se adopta la migración inicial.');
  if (!prisma(['db', 'execute', '--file', `prisma/migrations/${INIT}/migration.sql`]).ok) process.exit(1);
  if (!prisma(['migrate', 'resolve', '--applied', INIT]).ok) process.exit(1);
  r = prisma(['migrate', 'deploy']);
}
process.exit(r.ok ? 0 : 1);
