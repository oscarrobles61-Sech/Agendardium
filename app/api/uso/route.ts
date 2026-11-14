import { Forbidden } from '@/lib/access';
import { sql } from '@/lib/db';
import { authed } from '@/lib/route';

export const dynamic = 'force-dynamic';

// Uso de Neon frente a los límites del plan gratuito (solo administración), para avisar antes de quedarse sin cuota.
//  - Tamaño de la base: siempre (se mide desde la propia base).
//  - Horas de cómputo y transferencia del mes: solo si en Vercel están NEON_API_KEY y NEON_PROJECT_ID.
// Los límites se pueden cambiar con NEON_STORAGE_MB, NEON_CU_HOURS y NEON_TRANSFER_GB si se cambia de plan.
const num = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d);

export const GET = authed(async (_req, me) => {
  if (!me.admin) throw new Forbidden('Solo administración.');
  const limits = { storageMb: num(process.env.NEON_STORAGE_MB, 1024), cuHours: num(process.env.NEON_CU_HOURS, 100), transferGb: num(process.env.NEON_TRANSFER_GB, 5) };
  const [{ bytes }] = await sql().query('SELECT pg_database_size(current_database())::bigint::text AS bytes', []);
  const out: Record<string, unknown> = { limits, storageMb: Math.round(Number(bytes) / 1048576) };

  const key = process.env.NEON_API_KEY, project = process.env.NEON_PROJECT_ID;
  if (key && project) {
    try {
      const r = await fetch(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(project)}`, {
        headers: { authorization: `Bearer ${key}`, accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(5000)
      });
      if (!r.ok) throw new Error('Neon API ' + r.status);
      const p = (await r.json()).project || {};
      out.cuHours = Math.round((Number(p.compute_time_seconds) || 0) / 360) / 10;
      out.transferGb = Math.round((Number(p.data_transfer_bytes) || 0) / 1e8) / 10;
      out.periodStart = p.consumption_period_start || null;
      out.periodEnd = p.consumption_period_end || null;
    } catch (e) {
      console.error(e);
      out.apiError = 'No se pudo consultar la API de Neon: revisá NEON_API_KEY y NEON_PROJECT_ID.';
    }
  }
  return out;
});
