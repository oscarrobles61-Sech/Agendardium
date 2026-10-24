import { NextResponse } from 'next/server';
import { ensureSchema, hasDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!hasDb()) return NextResponse.json({ db: false });
  try {
    await ensureSchema();
    return NextResponse.json({ db: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ db: false, error: 'no se pudo conectar a la base' }, { status: 500 });
  }
}
