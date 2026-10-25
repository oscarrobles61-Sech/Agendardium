import { BadRequest, checkCol, FIELD } from '@/lib/db';
import { readFilter } from '@/lib/access';
import { authed } from '@/lib/route';
import { queryDocs, type Where } from '@/lib/store';

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 5000;

// Cuerpo: { col, where?: [[campo, '==', valor]...], orderBy?: [campo, 'asc'|'desc'], limit? }
export const POST = authed(async (req, me) => {
  const body = await req.json().catch(() => null);
  const col = checkCol(body?.col);
  const where: Where[] = [];
  for (const w of Array.isArray(body.where) ? body.where : []) {
    const [field, op, value] = w || [];
    if (typeof field !== 'string' || !FIELD.test(field) || op !== '==') throw new BadRequest('filtro inválido');
    where.push([field, op, value]);
  }
  let orderBy: [string, string] | null = null;
  if (body.orderBy) {
    const [field, dir] = body.orderBy;
    if (typeof field !== 'string' || !FIELD.test(field)) throw new BadRequest('orden inválido');
    orderBy = [field, dir === 'desc' ? 'desc' : 'asc'];
  }
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(body.limit) || MAX_LIMIT));
  // Un profesional solo trae su propia agenda.
  if (col === 'agenda' && !me.admin) where.push(['proId', '==', me.id]);
  return { docs: await queryDocs(col, where, orderBy, limit, docs => readFilter(me, col, docs)) };
});
