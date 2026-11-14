import { Forbidden } from '@/lib/access';
import { normDni } from '@/lib/auth';
import { BadRequest, sql } from '@/lib/db';
import { clearFails, clearIpLocks, pinRequired, savePin, setPinRequired, tempPin } from '@/lib/pin';
import { authed } from '@/lib/route';
import { getDoc } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Administración de PINs (solo secretaría / administrador). Nunca devuelve PINs guardados:
// solo el PIN temporal recién generado, una única vez, para dárselo a la persona.

export const GET = authed(async (_req, me) => {
  if (!me.admin) throw new Forbidden('Solo administración.');
  const rows = await sql().query(
    `SELECT u.id, p.temp, p.user_id IS NOT NULL AS has_pin,
            ceil(extract(epoch FROM a.locked_until - now()) / 60)::int AS locked_min
     FROM users u
     LEFT JOIN user_pins p ON p.user_id = u.id
     LEFT JOIN login_attempts a ON a.key = 'dni:' || upper(regexp_replace(coalesce(u.dni, ''), '[^0-9a-zA-Z]', '', 'g')) AND a.locked_until > now()`, []);
  const users = Object.fromEntries(rows.map(r => [r.id, { hasPin: !!r.has_pin, temp: !!r.temp, lockedMin: r.locked_min || 0 }]));
  return { required: await pinRequired(), users };
});

export const POST = authed(async (req, me) => {
  if (!me.admin) throw new Forbidden('Solo administración.');
  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action === 'require') {
    await setPinRequired(!!body.value, me.id);
    return { ok: true, required: !!body.value };
  }
  const id = String(body?.id || '');
  const user = id && (await getDoc('users', id));
  if (!user) throw new BadRequest('No existe ese perfil.');
  const dni = normDni(user.dni);
  if (action === 'unlock') {
    if (dni) await clearFails('dni', dni);
    await clearIpLocks();
    return { ok: true };
  }
  if (action === 'temp') {
    // PIN temporal: sirve para un solo ingreso, en el que la persona elige su PIN propio.
    const pin = tempPin();
    await savePin(id, pin, true, me.id);
    if (dni) await clearFails('dni', dni);
    return { pin };
  }
  throw new BadRequest('acción inválida');
});
