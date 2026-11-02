import { authed } from '@/lib/route';
import { unreadCount } from '@/lib/notify';

export const dynamic = 'force-dynamic';

// Cantidad de avisos sin leer (para el contador de la pestaña).
export const GET = authed(async (_req, me) => ({ unread: await unreadCount(me) }));
