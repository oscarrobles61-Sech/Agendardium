import { type NextRequest, NextResponse } from 'next/server';
import { normDni, setSession, usersWithDni } from '@/lib/auth';
import { hasDb } from '@/lib/db';
import { clearFails, clientIp, getCred, lockedFor, lockMsg, makeTicket, pinRequired, recordFail, verifyPin } from '@/lib/pin';

export const dynamic = 'force-dynamic';

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

// Ingreso con DNI + PIN.
//  - Con PIN propio: si es correcto abre la sesión.
//  - Con PIN temporal (lo generó la secretaría): devuelve { step: 'change' } y un pase para elegir uno propio.
//  - Sin PIN todavía: devuelve { step: 'create' } y un pase para crearlo, salvo que administración exija PIN.
export async function POST(req: NextRequest) {
  if (!hasDb()) return err('DATABASE_URL no está configurada', 503);
  const body = await req.json().catch(() => null);
  const dni = normDni(body?.dni), pin = String(body?.pin ?? '').trim(), ip = clientIp(req);
  if (!dni) return err('Ingresá tu DNI.', 400);

  const locked = await lockedFor(['dni:' + dni, 'ip:' + ip]);
  if (locked) return err(lockMsg(locked), 429);

  const found = (await usersWithDni()).filter(u => u.dni === dni);
  if (found.length > 1) return err('Hay más de un perfil con ese DNI. Pedile a administración que lo corrija.', 409);
  const user = found[0];
  if (!user) {
    await recordFail('ip', ip);
    const r = await recordFail('dni', dni);
    return err(r.lockedMin ? lockMsg(r.lockedMin) : 'DNI o PIN incorrectos.', r.lockedMin ? 429 : 401);
  }

  const cred = await getCred(user.id);
  if (!cred) {
    if (await pinRequired()) return err('Todavía no tenés PIN. Pedile a la secretaría que te genere uno temporal.', 403);
    return NextResponse.json({ step: 'create', ticket: makeTicket(user.id, '0'), name: user.name || '' });
  }
  if (!pin) return err('Ingresá tu PIN.', 400);
  if (!(await verifyPin(pin, cred.hash))) {
    await recordFail('ip', ip);
    const r = await recordFail('dni', dni);
    if (r.lockedMin) return err(lockMsg(r.lockedMin), 429);
    return err(`DNI o PIN incorrectos. ${r.left === 1 ? 'Te queda 1 intento' : `Te quedan ${r.left} intentos`} antes de un bloqueo temporal.`, 401);
  }
  await clearFails('dni', dni);
  if (cred.temp) return NextResponse.json({ step: 'change', ticket: makeTicket(user.id, cred.ver), name: user.name || '' });
  return setSession(NextResponse.json({ id: user.id }), user.id);
}
