import type { NextRequest } from 'next/server';
import { BadRequest, checkCol, FIELD, sql } from '@/lib/db';
import { handler } from '@/lib/route';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 5000;

// Cuerpo: { col, where?: [[campo, '==', valor]...], orderBy?: [campo, 'asc'|'desc'], limit? }
export const POST = handler(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const col = checkCol(body?.col);
  const params: unknown[] = [col];
  const conds = ['col = $1'];
  for (const w of Array.isArray(body.where) ? body.where : []) {
    const [field, op, value] = w || [];
    if (typeof field !== 'string' || !FIELD.test(field) || op !== '==') throw new BadRequest('filtro inválido');
    params.push(field, JSON.stringify(value ?? null));
    conds.push(`data -> $${params.length - 1} = $${params.length}::jsonb`);
  }
  let order = 'id';
  if (body.orderBy) {
    const [field, dir] = body.orderBy;
    if (typeof field !== 'string' || !FIELD.test(field)) throw new BadRequest('orden inválido');
    params.push(field);
    order = `data -> $${params.length} ${dir === 'desc' ? 'DESC NULLS LAST' : 'ASC NULLS LAST'}, id`;
  }
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(body.limit) || MAX_LIMIT));
  const rows = await sql().query(
    `SELECT id, data FROM docs WHERE ${conds.join(' AND ')} ORDER BY ${order} LIMIT ${limit}`,
    params
  );
  return { docs: rows.map(r => ({ id: r.id, data: r.data })) };
});
