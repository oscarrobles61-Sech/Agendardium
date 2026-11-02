import { authed } from '@/lib/route';
import { listNotifications, sendNotification } from '@/lib/notify';

export const dynamic = 'force-dynamic';

// GET: avisos recibidos y enviados de los últimos 30 días. POST: manda un aviso.
export const GET = authed(async (_req, me) => listNotifications(me));
export const POST = authed(async (req, me) => sendNotification(me, (await req.json().catch(() => null)) || {}));
