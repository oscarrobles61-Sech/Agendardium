import { sql } from '@/lib/db';
import { handler } from '@/lib/route';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const rows = await sql()`SELECT col, v FROM doc_versions`;
  return Object.fromEntries(rows.map(r => [r.col, String(r.v)]));
});
