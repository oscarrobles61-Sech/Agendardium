import type { NextRequest } from 'next/server';
import { BadRequest, checkCol, checkId, sql } from '@/lib/db';
import { handler } from '@/lib/route';

export const dynamic = 'force-dynamic';

const params = (req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  return { col: checkCol(p.get('col')), id: checkId(p.get('id')) };
};

export const GET = handler(async (req: NextRequest) => {
  const { col, id } = params(req);
  const rows = await sql()`SELECT data FROM docs WHERE col = ${col} AND id = ${id}`;
  return { data: rows.length ? rows[0].data : null };
});

export const PUT = handler(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const col = checkCol(body?.col), id = checkId(body?.id);
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new BadRequest('datos inválidos');
  const q = sql();
  await q.transaction([
    q`INSERT INTO docs (col, id, data, updated_at) VALUES (${col}, ${id}, ${JSON.stringify(body.data)}::jsonb, now())
      ON CONFLICT (col, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    q`INSERT INTO doc_versions (col, v) VALUES (${col}, 1) ON CONFLICT (col) DO UPDATE SET v = doc_versions.v + 1`
  ]);
  return { ok: true };
});

export const DELETE = handler(async (req: NextRequest) => {
  const { col, id } = params(req);
  const q = sql();
  await q.transaction([
    q`DELETE FROM docs WHERE col = ${col} AND id = ${id}`,
    q`INSERT INTO doc_versions (col, v) VALUES (${col}, 1) ON CONFLICT (col) DO UPDATE SET v = doc_versions.v + 1`
  ]);
  return { ok: true };
});
