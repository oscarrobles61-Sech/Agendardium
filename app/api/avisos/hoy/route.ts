import { authed } from '@/lib/route';
import { todayPatients } from '@/lib/notify';

export const dynamic = 'force-dynamic';

// Pacientes agendados hoy, para enlazarlos a un aviso. Un profesional ve solo los suyos.
export const GET = authed(async (_req, me) => ({ entries: await todayPatients(me) }));
