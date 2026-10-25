import { type NextRequest, NextResponse } from 'next/server';
import { ADMIN_ROLES, DNI_OK, normDni, profilesOf, setSession, usersWithDni } from '@/lib/auth';
import { hasDb } from '@/lib/db';
import { getDoc, getDocsRaw, setDoc } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Perfiles importados sin DNI: administración elige su perfil y carga su DNI (solo mientras nadie tenga DNI).
export async function POST(req: NextRequest) {
  if (!hasDb()) return NextResponse.json({ error: 'DATABASE_URL no está configurada' }, { status: 503 });
  const body = await req.json().catch(() => null);
  const id = String(body?.id || ''), dni = normDni(body?.dni);
  if (!DNI_OK.test(dni)) return NextResponse.json({ error: 'Revisá el DNI: tiene que tener entre 6 y 12 números.' }, { status: 400 });
  if ((await usersWithDni()).length) return NextResponse.json({ error: 'Ya hay perfiles con DNI: ingresá con el tuyo.' }, { status: 409 });
  const user = await getDoc('users', id);
  if (!user) return NextResponse.json({ error: 'No existe ese perfil.' }, { status: 404 });
  const anyAdmin = (await getDocsRaw('users')).some(u => profilesOf(u.data).some(p => ADMIN_ROLES.includes(p)));
  if (anyAdmin && !profilesOf(user).some(p => ADMIN_ROLES.includes(p))) return NextResponse.json({ error: 'Elegí un perfil de administración.' }, { status: 403 });
  await setDoc('users', id, { ...user, dni });
  return setSession(NextResponse.json({ id }), id);
}
