import { NextResponse } from 'next/server';
import { hasDb, sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Las tablas las crea Prisma (`prisma migrate deploy`, que corre en el build de Vercel).
export async function GET() {
  if (!hasDb()) return NextResponse.json({ db: false });
  try {
    const rows = await sql()`SELECT to_regclass('public.docs') IS NOT NULL AS ok`;
    if (!rows[0]?.ok) return NextResponse.json({ db: false, error: 'faltan las tablas: corré las migraciones' }, { status: 500 });
    return NextResponse.json({ db: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ db: false, error: 'no se pudo conectar a la base' }, { status: 500 });
  }
}
