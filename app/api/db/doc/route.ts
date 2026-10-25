import type { NextRequest } from 'next/server';
import { checkDelete, checkWrite, readFilter } from '@/lib/access';
import { BadRequest, checkCol, checkId } from '@/lib/db';
import { authed } from '@/lib/route';
import { deleteDoc, getDoc, setDoc } from '@/lib/store';

export const dynamic = 'force-dynamic';

const params = (req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  return { col: checkCol(p.get('col')), id: checkId(p.get('id')) };
};

export const GET = authed(async (req, me) => {
  const { col, id } = params(req);
  const data = await getDoc(col, id);
  if (!data) return { data: null };
  const [doc] = await readFilter(me, col, [{ id, data }]);
  return { data: doc ? doc.data : null };
});

export const PUT = authed(async (req, me) => {
  const body = await req.json().catch(() => null);
  const col = checkCol(body?.col), id = checkId(body?.id);
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new BadRequest('datos inválidos');
  await setDoc(col, id, await checkWrite(me, col, id, body.data));
  return { ok: true };
});

export const DELETE = authed(async (req, me) => {
  const { col, id } = params(req);
  const r = await checkDelete(me, col, id);
  if (r?.replace) await setDoc(col, id, r.replace);
  else await deleteDoc(col, id);
  return { ok: true };
});
