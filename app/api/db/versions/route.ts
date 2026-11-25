import type { NextRequest } from 'next/server';
import type { Me } from '@/lib/auth';
import { sql } from '@/lib/db';
import { authed } from '@/lib/route';

export const dynamic = 'force-dynamic';

const versionsOf = (rows: Record<string, unknown>[]) => Object.fromEntries(rows.map(r => [r.col, String(r.v)]));

// Sondeo de cambios (cliente viejo): solo las versiones de cada colección.
export const GET = authed(async () => versionsOf(await sql()`SELECT col, v FROM doc_versions`));

/* ---------- usuarios en línea ----------
 * El mismo sondeo que la agenda ya hace cada pocos segundos lleva la señal de "estoy acá" y trae la lista de
 * quién más está conectado: no suma pedidos a Vercel ni horas de cómputo a Neon (la base ya está despierta).
 * La fila de cada persona solo se reescribe si cambió lo que está haciendo o pasaron 20 s, para no escribir de más.
 * Se considera en línea a quien mandó señal en los últimos 90 s (con la pestaña oculta el sondeo se corta).
 */
const ONLINE_S = 90;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TABS = new Set(['home', 'agenda', 'month', 'patients', 'avisos', 'team', 'config', 'profile']);
const str = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : null);
const int = (v: unknown, lo: number, hi: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : null);
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

// Solo se guarda lo necesario para mostrar la lista: ningún dato de pacientes.
function cleanState(v: unknown): Obj {
  if (!isObj(v)) return {};
  const out: Obj = {};
  const tab = str(v.tab, 20); if (tab && TABS.has(tab)) out.tab = tab;
  const proId = str(v.proId, 64); if (proId) out.proId = proId;
  const week = str(v.week, 10); if (week && DATE.test(week)) out.week = week;
  if (isObj(v.ed)) {
    const e = v.ed, ep = str(e.proId, 64), date = str(e.date, 10), h = int(e.h, 0, 23);
    if (ep && date && DATE.test(date) && h != null) {
      const ed: Obj = { proId: ep, date, h, m: int(e.m, 0, 59), add: e.add === true };
      const eid = str(e.eid, 64); if (eid) ed.eid = eid;
      out.ed = ed;
    }
  }
  return out;
}

// Un profesional no ve las agendas de otros: de los demás solo ve en qué sección están,
// salvo que estén mirando o cargando un turno en SU agenda.
function stateFor(me: Me, st: Obj): Obj {
  if (me.admin) return st;
  const out: Obj = {};
  if (st.tab) out.tab = st.tab;
  if (st.proId === me.id) { out.proId = st.proId; if (st.week) out.week = st.week; }
  if (isObj(st.ed) && st.ed.proId === me.id) out.ed = st.ed;
  return out;
}

export const POST = authed(async (req: NextRequest, me) => {
  const body: Obj = await req.json().catch(() => ({}));
  const q = sql();
  if (body.leave === true) {
    await q`DELETE FROM presence WHERE user_id = ${me.id}`;
    return { ok: true };
  }
  if (!isObj(body.p)) return { versions: versionsOf(await q`SELECT col, v FROM doc_versions`) };

  const state = JSON.stringify(cleanState(body.p));
  const idleS = int(Math.round(Number(body.idleMs) / 1000), 0, 7 * 86400) ?? 0;
  const device = body.device === 'tel' ? 'tel' : 'pc';
  const [vers, , online] = await q.transaction([
    q`SELECT col, v FROM doc_versions`,
    q`INSERT INTO presence (user_id, last_seen, last_input, device, state)
      VALUES (${me.id}, now(), now() - make_interval(secs => ${idleS}), ${device}, ${state}::jsonb)
      ON CONFLICT (user_id) DO UPDATE SET last_seen = now(), last_input = EXCLUDED.last_input,
        device = EXCLUDED.device, state = EXCLUDED.state
      WHERE presence.last_seen < now() - interval '20 seconds'
         OR presence.state IS DISTINCT FROM EXCLUDED.state
         OR presence.device IS DISTINCT FROM EXCLUDED.device
         OR presence.last_input < EXCLUDED.last_input - interval '60 seconds'`,
    q`SELECT user_id, extract(epoch FROM now() - last_seen)::int AS seen,
        extract(epoch FROM now() - last_input)::int AS idle, device, state
      FROM presence WHERE last_seen > now() - make_interval(secs => ${ONLINE_S}) ORDER BY user_id`
  ]);
  return {
    versions: versionsOf(vers as Obj[]),
    online: (online as Obj[]).map(r => ({
      id: r.user_id, seen: Number(r.seen) || 0, idle: Math.max(0, Number(r.idle) || 0), device: r.device,
      state: r.user_id === me.id ? r.state : stateFor(me, isObj(r.state) ? r.state : {})
    }))
  };
});
