import { authed } from '@/lib/route';
import { markRead } from '@/lib/notify';

export const dynamic = 'force-dynamic';

// Cuerpo: { ids: [1, 2] } o { all: true }
export const POST = authed(async (req, me) => {
  const b = (await req.json().catch(() => null)) || {};
  const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter((n: number) => Number.isSafeInteger(n) && n > 0).slice(0, 500) : [];
  return markRead(me, b.all === true ? 'all' : ids);
});
