import { authed } from '@/lib/route';
import { removeSubscription, saveSubscription, vapidKeys } from '@/lib/notify';

export const dynamic = 'force-dynamic';

// GET: clave pública para suscribir el dispositivo. POST: guarda la suscripción. DELETE: la borra.
export const GET = authed(async () => ({ key: (await vapidKeys()).publicKey }));
export const POST = authed(async (req, me) => {
  const b = (await req.json().catch(() => null)) || {};
  return saveSubscription(me, b.subscription, req.headers.get('user-agent'));
});
export const DELETE = authed(async (req, me) => {
  const b = (await req.json().catch(() => null)) || {};
  return removeSubscription(me, b.endpoint);
});
