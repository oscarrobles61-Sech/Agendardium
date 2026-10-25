import { BadRequest, checkCol, checkId, sql } from '@/lib/db';
import { Forbidden } from '@/lib/access';
import { authed } from '@/lib/route';

export const dynamic = 'force-dynamic';

// Toma un candado con vencimiento: lo obtiene quien llega primero o quien ya lo tenía.
export const POST = authed(async (req, me) => {
  if (!me.admin) throw new Forbidden('Solo administración.');
  const body = await req.json().catch(() => null);
  const col = checkCol(body?.col), id = checkId(body?.id);
  const holder = String(body.holder || '').slice(0, 200);
  if (!holder) throw new BadRequest('holder requerido');
  const ttl = Math.max(1000, Math.min(3600_000, Number(body.ttlMs) || 60_000));
  const now = Date.now();
  const data = JSON.stringify({ holder, exp: now + ttl });
  const rows = await sql()`
    INSERT INTO docs (col, id, data) VALUES (${col}, ${id}, ${data}::jsonb)
    ON CONFLICT (col, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
    WHERE COALESCE((docs.data->>'exp')::bigint, 0) < ${now} OR docs.data->>'holder' = ${holder}
    RETURNING id`;
  return { acquired: rows.length > 0 };
});
