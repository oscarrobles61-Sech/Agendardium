import { type NextRequest, NextResponse } from 'next/server';
import { normDni, setSession, usersWithDni } from '@/lib/auth';
import { hasDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!hasDb()) return NextResponse.json({ error: 'DATABASE_URL no está configurada' }, { status: 503 });
  const body = await req.json().catch(() => null);
  const dni = normDni(body?.dni);
  const found = dni ? (await usersWithDni()).filter(u => u.dni === dni) : [];
  if (found.length !== 1) {
    const error = found.length ? 'Hay más de un perfil con ese DNI. Pedile a administración que lo corrija.' : 'No hay ningún perfil con ese DNI.';
    return NextResponse.json({ error }, { status: 401 });
  }
  return setSession(NextResponse.json({ id: found[0].id }), found[0].id);
}
