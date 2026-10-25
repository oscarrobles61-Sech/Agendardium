import type { NextRequest } from 'next/server';
import { ADMIN_ROLES, currentUser, profilesOf, usersWithDni } from '@/lib/auth';
import { sql } from '@/lib/db';
import { handler } from '@/lib/route';

export const dynamic = 'force-dynamic';

// Qué pantalla de ingreso corresponde: crear la primera cuenta, cargar el primer DNI o ingresar.
export const GET = handler(async (req: NextRequest) => {
  const me = await currentUser(req);
  const [{ n }] = await sql().query('SELECT count(*)::int AS n FROM users', []);
  const hasDni = (await usersWithDni()).length > 0;
  let claim: { id: string; name: string; profiles: string[] }[] = [];
  if (n > 0 && !hasDni) {
    const rows = await sql().query('SELECT id, name, role::text AS role, profiles::text[] AS profiles FROM users ORDER BY name', []);
    const all = rows.map(r => ({ id: r.id as string, name: (r.name as string) || '', profiles: profilesOf(r) }));
    const admins = all.filter(u => u.profiles.some(p => ADMIN_ROLES.includes(p)));
    claim = admins.length ? admins : all;
  }
  return { me: me?.id ?? null, hasUsers: n > 0, hasDni, claim };
});
