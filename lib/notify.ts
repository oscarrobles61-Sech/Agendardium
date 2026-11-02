import webpush from 'web-push';
import { ADMIN_ROLES, type Me, PRO_ROLES, profilesOf } from './auth';
import { BadRequest, sql } from './db';

// Avisos entre secretaría y profesionales, con notificaciones push (Web Push).
//  - Secretaría le manda un aviso a un profesional.
//  - Un profesional se lo manda a toda la secretaría (to_group = 'secretaria').
// Cada aviso puede enlazar un turno del día. En la pantalla bloqueada solo se ven las iniciales del paciente.

export const TZ = 'America/Argentina/Buenos_Aires';
const MAX_TEXT = 300;

type Row = Record<string, unknown>;

export const cleanText = (v: unknown, max = MAX_TEXT) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// "Juan Carlos Pérez" -> "J. C. P."
export function initials(name: string) {
  return name.split(/\s+/).filter(w => /^\p{L}/u.test(w)).slice(0, 3).map(w => w[0].toUpperCase() + '.').join(' ');
}

/* ---------------- claves VAPID ---------------- */

let keys: { publicKey: string; privateKey: string } | null = null;

// Si están VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en Vercel se usan esas; si no, la app genera un par
// la primera vez y lo guarda en push_keys (así no hay que configurar nada).
export async function vapidKeys() {
  if (keys) return keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    return keys;
  }
  const q = sql();
  let rows = await q.query('SELECT public_key, private_key FROM push_keys WHERE id = 1', []);
  if (!rows.length) {
    const k = webpush.generateVAPIDKeys();
    await q.query('INSERT INTO push_keys (id, public_key, private_key) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING', [k.publicKey, k.privateKey]);
    rows = await q.query('SELECT public_key, private_key FROM push_keys WHERE id = 1', []);
  }
  keys = { publicKey: rows[0].public_key as string, privateKey: rows[0].private_key as string };
  return keys;
}

/* ---------------- usuarios ---------------- */

type U = { id: string; name: string; profiles: string[] };

async function allUsers(): Promise<U[]> {
  const rows = await sql().query('SELECT id, name, role::text AS role, profiles::text[] AS profiles FROM users WHERE active IS NOT FALSE', []);
  return rows.map(r => ({ id: r.id as string, name: (r.name as string) || '', profiles: profilesOf(r) }));
}
const isAdminU = (u: U) => u.profiles.some(p => ADMIN_ROLES.includes(p));
const isProU = (u: U) => u.profiles.some(p => PRO_ROLES.includes(p));

/* ---------------- turnos del día ---------------- */

export type TodayEntry = { pid: string | null; name: string; proId: string; proName: string; date: string; time: string; status: string };

// Pacientes agendados hoy (hora de Buenos Aires). Un profesional ve solo los suyos.
export async function todayPatients(me: Me): Promise<TodayEntry[]> {
  const rows = await sql().query(
    `SELECT s.patient_id, coalesce(p.name, s.patient_name, '') AS name, s.professional_id, u.name AS pro_name,
            s.date::text AS date, s.hour, coalesce(s.minute, 0) AS minute, coalesce(s.status::text, 'prog') AS status
       FROM sessions s
       LEFT JOIN patients p ON p.id = s.patient_id
       LEFT JOIN users u ON u.id = s.professional_id
      WHERE s.date = (now() AT TIME ZONE $1)::date
        AND coalesce(s.status::text, 'prog') NOT IN ('cancel', 'rec-done')
        AND ($2::text IS NULL OR s.professional_id = $2)
      ORDER BY s.hour, s.minute NULLS FIRST, name`,
    [TZ, me.admin ? null : me.id]
  );
  const seen = new Set<string>();
  const out: TodayEntry[] = [];
  for (const r of rows) {
    const name = cleanText(r.name, 120);
    if (!name) continue;
    const time = String(r.hour).padStart(2, '0') + ':' + String(r.minute).padStart(2, '0');
    const key = [r.patient_id || name, r.professional_id, time].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ pid: (r.patient_id as string) || null, name, proId: r.professional_id as string, proName: (r.pro_name as string) || '', date: r.date as string, time, status: r.status as string });
  }
  return out;
}

/* ---------------- envío ---------------- */

type Push = { title: string; body: string; tag: string; url: string; id: number };

// Manda el push a todos los dispositivos de esas personas. Los dispositivos dados de baja se borran.
export async function pushTo(userIds: string[], payload: Push) {
  if (!userIds.length) return;
  const q = sql();
  const subs = await q.query('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1::text[])', [userIds]);
  if (!subs.length) return;
  const k = await vapidKeys();
  const subject = process.env.VAPID_SUBJECT || 'mailto:avisos@centrofinochietto.invalid';
  const body = JSON.stringify(payload);
  const gone: string[] = [];
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } },
        body,
        { vapidDetails: { subject, publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 4 * 3600, urgency: 'high', timeout: 8000 }
      );
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410 || code === 403) gone.push(s.endpoint as string);
      else console.error('push', code, (e as Error).message);
    }
  }));
  if (gone.length) await q.query('DELETE FROM push_subscriptions WHERE endpoint = ANY($1::text[])', [gone]);
}

export type SendInput = { message?: unknown; comment?: unknown; to?: unknown; patient?: unknown };

export async function sendNotification(me: Me, input: SendInput) {
  const message = cleanText(input.message);
  const comment = cleanText(input.comment) || null;
  if (!message) throw new BadRequest('Escribí el mensaje.');
  const users = await allUsers();
  const sender = users.find(u => u.id === me.id);
  if (!sender) throw new BadRequest('Usuario inexistente.');

  // Turno enlazado: se busca entre los turnos de hoy que esta persona puede ver.
  let link: TodayEntry | null = null;
  const pin = input.patient as Row | null | undefined;
  if (pin && typeof pin === 'object') {
    const today = await todayPatients(me);
    link = today.find(t => t.proId === pin.proId && t.time === pin.time && (pin.pid ? t.pid === pin.pid : t.name === pin.name)) || null;
    if (!link) throw new BadRequest('Ese paciente no figura en la agenda de hoy.');
  }

  let toId: string | null = null, toGroup: string | null = null, recipients: string[];
  if (me.admin && input.to !== 'secretaria') {
    const target = users.find(u => u.id === input.to && isProU(u));
    if (!target) throw new BadRequest('Elegí a qué profesional se lo mandás.');
    if (link && link.proId !== target.id) throw new BadRequest('Ese turno es de otro profesional.');
    toId = target.id; recipients = [target.id];
  } else if (me.pro || me.admin) {
    toGroup = 'secretaria';
    recipients = users.filter(u => isAdminU(u) && u.id !== me.id).map(u => u.id);
    if (!recipients.length) throw new BadRequest('No hay nadie de secretaría cargado.');
  } else throw new BadRequest('Tu perfil no puede mandar avisos.');

  const q = sql();
  const [row] = await q.query(
    `INSERT INTO notifications (from_id, to_id, to_group, message, comment, patient_id, patient_name, session_date, session_time, professional_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10) RETURNING id`,
    [me.id, toId, toGroup, message, comment, link?.pid ?? null, link?.name ?? null, link?.date ?? null, link?.time ?? null, link?.proId ?? null]
  );
  const id = Number(row.id);
  await q.query(
    'INSERT INTO notification_recipients (notification_id, user_id) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING',
    [id, recipients]
  );
  const body = [message, link ? `${initials(link.name)} ${link.time}` : '', comment || ''].filter(Boolean).join(' · ');
  await pushTo(recipients, { title: 'Aviso de ' + (sender.name || 'la agenda'), body, tag: 'aviso-' + id, url: '/?aviso=' + id, id });
  return { id };
}

// "Recibido" / "En eso": marca el aviso como atendido y le avisa a quien lo mandó.
export async function replyNotification(me: Me, id: number, text: string) {
  const q = sql();
  const rows = await q.query(
    `SELECT n.id, n.from_id, n.message, n.patient_name, n.session_time FROM notifications n
       JOIN notification_recipients r ON r.notification_id = n.id AND r.user_id = $2
      WHERE n.id = $1`, [id, me.id]);
  if (!rows.length) throw new BadRequest('Aviso inexistente.');
  const n = rows[0];
  const reply = cleanText(text, 60) || 'Recibido';
  await q.query('UPDATE notifications SET handled_by = $2, handled_text = $3, handled_at = now() WHERE id = $1', [id, me.id, reply]);
  await q.query('UPDATE notification_recipients SET read_at = coalesce(read_at, now()) WHERE notification_id = $1 AND user_id = $2', [id, me.id]);
  const [me2] = await q.query('SELECT name FROM users WHERE id = $1', [me.id]);
  const who = (me2?.name as string) || 'Alguien';
  const [nr] = await q.query(
    `INSERT INTO notifications (from_id, to_id, message, reply_to) VALUES ($1, $2, $3, $4) RETURNING id`,
    [me.id, n.from_id, `${reply}: ${n.message}`, id]);
  const rid = Number(nr.id);
  await q.query('INSERT INTO notification_recipients (notification_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [rid, n.from_id]);
  const pat = n.patient_name ? ` · ${initials(n.patient_name as string)} ${n.session_time || ''}`.trimEnd() : '';
  await pushTo([n.from_id as string], { title: `${who}: ${reply}`, body: `${n.message}${pat}`, tag: 'aviso-' + rid, url: '/?aviso=' + rid, id: rid });
  return { ok: true };
}

/* ---------------- bandeja ---------------- */

const FIELDS = `n.id, n.created_at, n.from_id, n.to_id, n.to_group, n.message, n.comment, n.patient_id, n.patient_name,
  n.session_date::text AS session_date, n.session_time, n.professional_id, n.reply_to, n.handled_by, n.handled_text, n.handled_at`;

const shape = (r: Row) => ({
  id: Number(r.id), at: Date.parse(r.created_at as string), from: r.from_id, to: r.to_id, group: r.to_group,
  message: r.message, comment: r.comment, pid: r.patient_id, patient: r.patient_name, date: r.session_date, time: r.session_time,
  proId: r.professional_id, replyTo: r.reply_to == null ? null : Number(r.reply_to),
  handledBy: r.handled_by, handled: r.handled_text, handledAt: r.handled_at ? Date.parse(r.handled_at as string) : null,
  read: r.read_at === undefined ? true : r.read_at != null
});

export async function listNotifications(me: Me) {
  const q = sql();
  const [inbox, sent, [{ n }]] = await Promise.all([
    q.query(`SELECT ${FIELDS}, r.read_at FROM notifications n JOIN notification_recipients r ON r.notification_id = n.id
              WHERE r.user_id = $1 AND n.created_at > now() - interval '30 days' ORDER BY n.created_at DESC LIMIT 150`, [me.id]),
    q.query(`SELECT ${FIELDS} FROM notifications n WHERE n.from_id = $1 AND n.created_at > now() - interval '30 days'
              ORDER BY n.created_at DESC LIMIT 150`, [me.id]),
    q.query('SELECT count(*)::int AS n FROM notification_recipients WHERE user_id = $1 AND read_at IS NULL', [me.id])
  ]);
  return { inbox: inbox.map(shape), sent: sent.map(shape), unread: n as number };
}

export async function unreadCount(me: Me) {
  const [{ n }] = await sql().query('SELECT count(*)::int AS n FROM notification_recipients WHERE user_id = $1 AND read_at IS NULL', [me.id]);
  return n as number;
}

export async function markRead(me: Me, ids: number[] | 'all') {
  if (ids === 'all') await sql().query('UPDATE notification_recipients SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [me.id]);
  else if (ids.length) await sql().query('UPDATE notification_recipients SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND notification_id = ANY($2::bigint[])', [me.id, ids]);
  return { unread: await unreadCount(me) };
}

/* ---------------- dispositivos ---------------- */

export async function saveSubscription(me: Me, sub: unknown, ua: string | null) {
  const s = sub as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const endpoint = typeof s?.endpoint === 'string' ? s.endpoint : '';
  const p256dh = typeof s?.keys?.p256dh === 'string' ? s.keys.p256dh : '';
  const auth = typeof s?.keys?.auth === 'string' ? s.keys.auth : '';
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) throw new BadRequest('Suscripción inválida.');
  // Un dispositivo pertenece a quien ingresó por última vez en él.
  await sql().query(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent, updated_at = now()`,
    [endpoint, me.id, p256dh, auth, ua ? ua.slice(0, 300) : null]);
  return { ok: true };
}

export async function removeSubscription(me: Me, endpoint: unknown) {
  if (typeof endpoint !== 'string') throw new BadRequest('Suscripción inválida.');
  await sql().query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, me.id]);
  return { ok: true };
}

export async function testPush(me: Me) {
  const [{ n }] = await sql().query('SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1', [me.id]);
  if (!n) throw new BadRequest('Este usuario no tiene dispositivos con avisos activados.');
  await pushTo([me.id], { title: 'Prueba de avisos', body: 'Si ves esto, los avisos funcionan en este dispositivo.', tag: 'prueba', url: '/?aviso=0', id: 0 });
  return { ok: true, devices: n as number };
}
