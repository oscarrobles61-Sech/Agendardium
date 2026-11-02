import { BadRequest } from '@/lib/db';
import { authed } from '@/lib/route';
import { replyNotification } from '@/lib/notify';

export const dynamic = 'force-dynamic';

// Cuerpo: { id, text: 'Recibido' | 'En eso' | ... }
export const POST = authed(async (req, me) => {
  const b = (await req.json().catch(() => null)) || {};
  const id = Number(b.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new BadRequest('Aviso inválido.');
  return replyNotification(me, id, String(b.text || ''));
});
