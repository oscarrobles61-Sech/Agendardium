import { type NextRequest, NextResponse } from 'next/server';
import { DNI_OK, normDni, setSession } from '@/lib/auth';
import { hasDb, sql } from '@/lib/db';
import { getDoc, setDoc } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Primer ingreso con la base vacía: crea la cuenta de secretaría y la configuración inicial.
export async function POST(req: NextRequest) {
  if (!hasDb()) return NextResponse.json({ error: 'DATABASE_URL no está configurada' }, { status: 503 });
  const body = await req.json().catch(() => null);
  const name = String(body?.name || '').trim().slice(0, 80), dni = normDni(body?.dni);
  if (!name || !DNI_OK.test(dni)) return NextResponse.json({ error: 'Revisá el nombre y el DNI.' }, { status: 400 });
  const [{ n }] = await sql().query('SELECT count(*)::int AS n FROM users', []);
  if (n > 0) return NextResponse.json({ error: 'La agenda ya tiene usuarios.' }, { status: 409 });
  const cfg = body?.cfg && typeof body.cfg === 'object' && !Array.isArray(body.cfg) ? body.cfg : {};
  if (!(await getDoc('config', 'main'))) await setDoc('config', 'main', cfg);
  const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  await setDoc('users', id, { name, title: '', role: 'secretaria', profiles: ['secretaria'], dni, schedule: {} });
  return setSession(NextResponse.json({ id }), id);
}
