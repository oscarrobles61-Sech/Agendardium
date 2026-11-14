import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { sql } from './db';

// Sesión con cookie firmada. Se entra con DNI + PIN (ver lib/pin.ts) y el servidor
// decide qué puede leer y escribir cada perfil (ver lib/access.ts).
// La cookie lleva la versión del PIN de la persona: si se cambia o restablece el PIN, las sesiones abiertas
// con el anterior (por ejemplo en un celular perdido) dejan de valer.

export const COOKIE = 'agenda_sesion';
const TTL_MS = 12 * 3600 * 1000;

export const ADMIN_ROLES = ['secretaria', 'administrador'];
export const PRO_ROLES = ['kinesiologo', 'medico', 'profesor_ef', 'fonoaudiologo', 'terapista_ocupacional', 'nutricionista', 'psicologo'];

export type Me = { id: string; profiles: string[]; admin: boolean; pro: boolean; coord: boolean };

// Clave para firmar: SESSION_SECRET si existe; si no, una derivada de DATABASE_URL (no hace falta configurar nada).
const key = () => process.env.SESSION_SECRET || createHash('sha256').update('agenda-sesion:' + (process.env.DATABASE_URL || '')).digest('hex');
const sign = (payload: string) => createHmac('sha256', key()).update(payload).digest('base64url');

// Firma un valor (payload.firma) y lo verifica: lo usan la cookie de sesión y el pase para crear el PIN.
export const signValue = (payload: string) => payload + '.' + sign(payload);
export function verifyValue(token: string | undefined): string | null {
  if (!token) return null;
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), sig = token.slice(i + 1);
  const good = Buffer.from(sign(payload)), got = Buffer.from(sig);
  if (good.length !== got.length || !timingSafeEqual(good, got)) return null;
  return payload;
}

export function makeToken(userId: string, ver: string) {
  return signValue(Buffer.from(userId).toString('base64url') + '.' + (Date.now() + TTL_MS) + '.' + ver);
}

function readToken(token: string | undefined): { id: string; ver: string } | null {
  const payload = verifyValue(token);
  if (!payload) return null;
  const [uid, exp, ver] = payload.split('.');
  if (!(Number(exp) > Date.now())) return null;
  return { id: Buffer.from(uid, 'base64url').toString(), ver: ver || '0' };
}

export const normDni = (v: unknown) => String(v ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase();
export const DNI_OK = /^[0-9A-Z]{6,12}$/;

export function profilesOf(row: { role?: unknown; profiles?: unknown }): string[] {
  if (Array.isArray(row.profiles) && row.profiles.length) return row.profiles as string[];
  return typeof row.role === 'string' ? [row.role] : [];
}

export function meFrom(id: string, row: { role?: unknown; profiles?: unknown }): Me {
  const profiles = profilesOf(row);
  return {
    id, profiles,
    admin: profiles.some(r => ADMIN_ROLES.includes(r)),
    pro: profiles.some(r => PRO_ROLES.includes(r)),
    coord: profiles.includes('coordinador')
  };
}

export async function currentUser(req: NextRequest): Promise<Me | null> {
  const t = readToken(req.cookies.get(COOKIE)?.value);
  if (!t) return null;
  const rows = await sql().query(
    `SELECT u.id, u.role::text AS role, u.profiles::text[] AS profiles, coalesce(p.ver, 0)::text AS ver
     FROM users u LEFT JOIN user_pins p ON p.user_id = u.id WHERE u.id = $1`, [t.id]);
  if (!rows.length || rows[0].ver !== t.ver) return null;
  return meFrom(t.id, rows[0]);
}

// Abre la sesión con la versión de PIN actual de la persona.
export async function setSession(res: NextResponse, userId: string) {
  const rows = await sql().query('SELECT ver::text AS ver FROM user_pins WHERE user_id = $1', [userId]);
  res.cookies.set(COOKIE, makeToken(userId, rows[0]?.ver || '0'), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: TTL_MS / 1000
  });
  return res;
}

export function clearSession(res: NextResponse) {
  res.cookies.set(COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 });
  return res;
}

// Usuarios con su DNI normalizado (para ingresar y para no repetir DNI).
export async function usersWithDni(): Promise<{ id: string; name: string | null; role: string | null; profiles: string[] | null; dni: string }[]> {
  const rows = await sql().query("SELECT id, name, role::text AS role, profiles::text[] AS profiles, dni FROM users WHERE coalesce(dni, '') <> ''", []);
  return rows.map(r => ({ ...(r as { id: string; name: string | null; role: string | null; profiles: string[] | null }), dni: normDni(r.dni) }));
}
