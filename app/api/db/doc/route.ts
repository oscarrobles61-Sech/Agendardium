import type { NextRequest } from 'next/server';
import { checkDelete, checkWrite, readFilter } from '@/lib/access';
import { BadRequest, checkCol, checkId } from '@/lib/db';
import { authed } from '@/lib/route';
import { deleteDoc, getDoc, getRev, REV_COLS, setDoc } from '@/lib/store';

export const dynamic = 'force-dynamic';

const params = (req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  return { col: checkCol(p.get('col')), id: checkId(p.get('id')) };
};

export const GET = authed(async (req, me) => {
  const { col, id } = params(req);
  // La revisión se lee antes que los datos: si alguien guarda en el medio, lo peor que pasa es un aviso de
  // conflicto de más, nunca pisar un cambio ajeno.
  const rev = await getRev(col, id);
  const data = await getDoc(col, id);
  if (!data) return { data: null, rev };
  const [doc] = await readFilter(me, col, [{ id, data }]);
  return { data: doc ? doc.data : null, rev };
});

export const PUT = authed(async (req, me) => {
  const body = await req.json().catch(() => null);
  const col = checkCol(body?.col), id = checkId(body?.id);
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new BadRequest('datos inválidos');
  // ifRev: la revisión que se leyó. Si otra persona guardó después, se rechaza con 409 en vez de pisarla.
  const ifRev = REV_COLS.has(col) && Number.isInteger(body.ifRev) && body.ifRev >= 0 ? body.ifRev : null;
  const rev = await setDoc(col, id, await checkWrite(me, col, id, body.data), ifRev);
  return { ok: true, rev };
});

export const DELETE = authed(async (req, me) => {
  const { col, id } = params(req);
  const r = await checkDelete(me, col, id);
  if (r?.replace) await setDoc(col, id, r.replace);
  else await deleteDoc(col, id);
  return { ok: true };
});
