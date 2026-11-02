import { authed } from '@/lib/route';
import { testPush } from '@/lib/notify';

export const dynamic = 'force-dynamic';

// Manda un aviso de prueba a los dispositivos de quien lo pide.
export const POST = authed(async (_req, me) => testPush(me));
