import { type NextRequest, NextResponse } from 'next/server';
import { currentUser, normDni, setSession } from '@/lib/auth';
import { hasDb } from '@/lib/db';
import { clearFails, getCred, lockedFor, lockMsg, pinProblem, readTicket, recordFail, savePin, verifyPin } from '@/lib/pin';
import { getDoc } from '@/lib/store';

export const dynamic = 'force-dynamic';

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

// Crear o cambiar el PIN propio.
//  - Con { ticket, pin }: después de ingresar con el DNI (sin PIN) o con un PIN temporal.
//  - Con sesión iniciada y { current, pin }: cambio de PIN desde Mi perfil.
// En los dos casos se abre una sesión nueva (las otras sesiones de la persona se cierran).
export async function POST(req: NextRequest) {
  if (!hasDb()) return err('DATABASE_URL no está configurada', 503);
  const body = await req.json().catch(() => null);
  const pin = String(body?.pin ?? '').trim();
  let userId: string;

  if (body?.ticket) {
    const t = readTicket(body.ticket);
    const cred = t && (await getCred(t.userId));
    if (!t || (cred?.ver || '0') !== t.ver) return err('El pase para crear el PIN venció. Volvé a ingresar con tu DNI.', 401);
    userId = t.userId;
  } else {
    const me = await currentUser(req);
    if (!me) return err('Tenés que ingresar con tu DNI.', 401);
    userId = me.id;
    const cred = await getCred(userId);
    if (cred) {
      const locked = await lockedFor(['uid:' + userId]);
      if (locked) return err(lockMsg(locked), 429);
      if (!(await verifyPin(String(body?.current ?? '').trim(), cred.hash))) {
        const r = await recordFail('uid', userId);
        return err(r.lockedMin ? lockMsg(r.lockedMin) : 'El PIN actual no es correcto.', r.lockedMin ? 429 : 401);
      }
      await clearFails('uid', userId);
    }
  }

  const user = await getDoc('users', userId);
  if (!user) return err('No existe ese perfil.', 404);
  const problem = pinProblem(pin, normDni(user.dni));
  if (problem) return err(problem, 400);
  await savePin(userId, pin, false, userId);
  return setSession(NextResponse.json({ id: userId }), userId);
}
