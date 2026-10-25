import type { NextRequest } from 'next/server';
import { BadRequest, checkCol, checkId } from '@/lib/db';
import { handler } from '@/lib/route';
import { deleteDoc, getDoc, setDoc } from '@/lib/store';

export const dynamic = 'force-dynamic';

const params = (req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  return { col: checkCol(p.get('col')), id: checkId(p.get('id')) };
};

export const GET = handler(async (req: NextRequest) => {
  const { col, id } = params(req);
  return { data: await getDoc(col, id) };
});

export const PUT = handler(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const col = checkCol(body?.col), id = checkId(body?.id);
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new BadRequest('datos inválidos');
  await setDoc(col, id, body.data);
  return { ok: true };
});

export const DELETE = handler(async (req: NextRequest) => {
  const { col, id } = params(req);
  await deleteDoc(col, id);
  return { ok: true };
});
