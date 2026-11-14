import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { signValue, verifyValue } from './auth';
import { sql } from './db';
import { getDoc, setDoc } from './store';

// PIN de acceso: segunda credencial además del DNI.
//  - Se guarda como hash scrypt con sal propia (tabla user_pins); el PIN nunca se guarda ni se muestra.
//  - Límite de intentos: 5 errores seguidos con un DNI lo bloquean 15 minutos (y el doble en cada bloqueo
//    siguiente, hasta 24 h). Además, 30 errores en 15 minutos desde una misma IP (probar muchos DNI) la bloquean
//    15 minutos; es un límite alto a propósito porque todo el centro suele salir por la misma IP.
//    La secretaría puede desbloquear desde Equipo.
//  - Quien todavía no tiene PIN lo crea al ingresar con su DNI, salvo que administración active "Exigir PIN":
//    desde ahí solo entra quien ya tiene PIN o recibió uno temporal de la secretaría.

export const PIN_OK = /^\d{6,8}$/;
const KEYLEN = 32, N = 16384, R = 8, P = 1;

function scryptAsync(pin: string, salt: Buffer, n = N, r = R, p = P): Promise<Buffer> {
  return new Promise((res, rej) => scrypt(pin, salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));
}

export async function hashPin(pin: string) {
  const salt = randomBytes(16);
  const key = await scryptAsync(pin, salt);
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPin(pin: string, stored: string) {
  const [alg, n, r, p, salt, key] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const want = Buffer.from(key, 'base64url');
  const got = await scryptAsync(pin, Buffer.from(salt, 'base64url'), +n, +r, +p);
  return want.length === got.length && timingSafeEqual(want, got);
}

// PIN demasiado fácil de adivinar: todos iguales, escalera, o parte del DNI.
export function weakPin(pin: string, dni?: string) {
  if (/^(\d)\1+$/.test(pin)) return true;
  const up = '01234567890', down = '09876543210';
  if (up.includes(pin) || down.includes(pin)) return true;
  if (dni && dni.includes(pin)) return true;
  return false;
}

export function pinProblem(pin: unknown, dni?: string): string | null {
  const s = String(pin ?? '');
  if (!PIN_OK.test(s)) return 'El PIN tiene que tener entre 6 y 8 números.';
  if (weakPin(s, dni)) return 'Ese PIN es muy fácil de adivinar (números repetidos, en escalera o parte de tu DNI). Elegí otro.';
  return null;
}

export const tempPin = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/* ---------------- PIN guardado ---------------- */

export type Cred = { hash: string; temp: boolean; ver: string };

export async function getCred(userId: string): Promise<Cred | null> {
  const rows = await sql().query('SELECT pin_hash, temp, ver::text AS ver FROM user_pins WHERE user_id = $1', [userId]);
  return rows.length ? { hash: rows[0].pin_hash as string, temp: !!rows[0].temp, ver: rows[0].ver as string } : null;
}

// Guarda el PIN y devuelve la nueva versión de credencial (las sesiones anteriores quedan invalidadas).
export async function savePin(userId: string, pin: string, temp: boolean, by: string) {
  const ver = String(Date.now());
  await sql().query(
    `INSERT INTO user_pins (user_id, pin_hash, temp, ver, set_by, set_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, temp = EXCLUDED.temp, ver = EXCLUDED.ver, set_by = EXCLUDED.set_by, set_at = now()`,
    [userId, await hashPin(pin), temp, ver, by]
  );
  return ver;
}

/* ---------------- exigir PIN ---------------- */

export async function pinRequired() {
  const d = await getDoc('meta', 'auth');
  return !!d?.pinRequired;
}
export async function setPinRequired(v: boolean, by: string) {
  await setDoc('meta', 'auth', { pinRequired: v, by, at: Date.now() });
}

/* ---------------- límite de intentos ---------------- */

// limit: errores hasta el bloqueo; windowMin: tras ese tiempo sin errores el contador vuelve a cero;
// grow: si cada bloqueo siguiente dura el doble.
const RULES = {
  dni: { limit: 5, windowMin: 24 * 60, grow: true },
  uid: { limit: 5, windowMin: 24 * 60, grow: true },
  ip: { limit: 30, windowMin: 15, grow: false }
} as const;
const BASE_MIN = 15, MAX_MIN = 24 * 60;
type Kind = keyof typeof RULES;

export function clientIp(req: NextRequest) {
  return (req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || '').trim() || 'desconocida';
}

// Minutos que faltan para que se levante el bloqueo más largo entre estas claves (0 = sin bloqueo).
export async function lockedFor(keys: string[]): Promise<number> {
  const rows = await sql().query(
    `SELECT ceil(extract(epoch FROM max(locked_until) - now()) / 60)::int AS m FROM login_attempts WHERE key = ANY($1::text[]) AND locked_until > now()`,
    [keys]
  );
  return rows[0]?.m || 0;
}

// Suma un error. Devuelve cuántos intentos quedan antes del próximo bloqueo y, si se bloqueó, por cuántos minutos.
export async function recordFail(kind: Kind, value: string): Promise<{ left: number; lockedMin: number }> {
  const { limit, windowMin, grow } = RULES[kind], key = kind + ':' + value;
  const [{ fails }] = await sql().query(
    `INSERT INTO login_attempts (key, fails, updated_at) VALUES ($1, 1, now())
     ON CONFLICT (key) DO UPDATE SET
       fails = CASE WHEN login_attempts.updated_at < now() - make_interval(mins => $2) THEN 1 ELSE login_attempts.fails + 1 END,
       updated_at = now()
     RETURNING fails`,
    [key, windowMin]
  );
  if (fails % limit !== 0) return { left: limit - (fails % limit), lockedMin: 0 };
  const min = grow ? Math.min(MAX_MIN, BASE_MIN * 2 ** (fails / limit - 1)) : BASE_MIN;
  await sql().query(`UPDATE login_attempts SET locked_until = now() + make_interval(mins => $2) WHERE key = $1`, [key, min]);
  return { left: 0, lockedMin: min };
}

export async function clearFails(kind: Kind, value: string) {
  await sql().query('DELETE FROM login_attempts WHERE key = $1', [kind + ':' + value]);
}

// Desbloqueo manual (secretaría): también levanta los bloqueos por IP, que pueden alcanzar a todo el centro.
export async function clearIpLocks() {
  await sql().query(`DELETE FROM login_attempts WHERE key LIKE 'ip:%'`, []);
}

export const lockMsg = (min: number) =>
  `Demasiados intentos fallidos. Por seguridad el ingreso quedó bloqueado ${min >= 60 ? 'por ' + Math.round(min / 60) + ' h' : min + ' minutos'}. Si no podés esperar, pedile a la secretaría que te desbloquee.`;

/* ---------------- pase para crear o cambiar el PIN ---------------- */
// Lo recibe quien acertó el DNI (sin PIN todavía) o el PIN temporal. Vale 10 minutos y solo para la versión
// de credencial que tenía en ese momento: después de usarlo ya no sirve.

const TICKET_MS = 10 * 60 * 1000;

export const makeTicket = (userId: string, ver: string) =>
  signValue(['pin', Buffer.from(userId).toString('base64url'), ver, Date.now() + TICKET_MS].join('.'));

export function readTicket(t: unknown): { userId: string; ver: string } | null {
  const v = verifyValue(typeof t === 'string' ? t : '');
  if (!v) return null;
  const [kind, uid, ver, exp] = v.split('.');
  if (kind !== 'pin' || !(Number(exp) > Date.now())) return null;
  return { userId: Buffer.from(uid, 'base64url').toString(), ver };
}
