import { DNI_OK, type Me, normDni, profilesOf, usersWithDni } from './auth';
import { getDoc, getDocsRaw } from './store';

// Permisos por perfil, aplicados en el servidor:
//  - Administración (secretaría / administrador): ve y edita todo.
//  - Profesionales: solo su agenda, su registro mensual y sus pacientes (y de cada paciente, solo sus
//    tratamientos y sus notas). Cada profesional es independiente: no ve ni toca lo de otro.
//  - Coordinación: noticias.

type Obj = Record<string, unknown>;

export class Forbidden extends Error {}

const ADMIN_ONLY = new Set(['backups', 'backupidx', 'meta']);

const agendaPro = (id: string) => /^\d{4}-\d{2}-\d{2}_(.+)$/.exec(id)?.[1] ?? null;
const billingPro = (id: string) => /^(.+)_\d{4}-\d{2}$/.exec(id)?.[1] ?? null;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/* ---------------- pacientes ---------------- */

// Notas visibles para un profesional: las suyas y las de administración.
async function adminIds() {
  const users = await getDocsRaw('users');
  return new Set(users.filter(u => profilesOf(u.data).some(r => r === 'secretaria' || r === 'administrador')).map(u => u.id));
}

function patientVisibleTo(me: Me, p: Obj) {
  const pros = Array.isArray(p.pros) ? p.pros : [];
  const plans = isObj(p.plans) ? Object.values(p.plans) : [];
  return pros.includes(me.id) || plans.some(pl => isObj(pl) && pl.proId === me.id);
}

function patientFor(me: Me, p: Obj, admins: Set<string>): Obj {
  const plans: Obj = {};
  if (isObj(p.plans)) for (const [tid, pl] of Object.entries(p.plans)) if (isObj(pl) && pl.proId === me.id) plans[tid] = pl;
  const out: Obj = { ...p, plans, pros: [me.id] };
  if (Array.isArray(p.history)) out.history = p.history.filter(n => isObj(n) && (n.by === me.id || admins.has(n.by as string)));
  return out;
}

// Une lo que manda un profesional con lo que ya hay de otros profesionales en la ficha.
function mergePatient(me: Me, stored: Obj | null, sent: Obj, admins: Set<string>): Obj {
  const mine: Obj = {};
  if (isObj(sent.plans)) for (const [tid, pl] of Object.entries(sent.plans)) {
    if (!isObj(pl)) continue;
    const prev = stored && isObj(stored.plans) ? stored.plans[tid] : undefined;
    if (isObj(prev) && prev.proId !== me.id) continue; // tratamiento de otro profesional: no se toca
    mine[tid] = { ...pl, proId: me.id };
  }
  if (!stored) return { ...sent, plans: mine, pros: [me.id] };
  const others: Obj = {};
  if (isObj(stored.plans)) for (const [tid, pl] of Object.entries(stored.plans)) if (!(isObj(pl) && pl.proId === me.id)) others[tid] = pl;
  const storedPros = Array.isArray(stored.pros) ? (stored.pros as string[]) : [];
  const visible = (n: unknown) => isObj(n) && (n.by === me.id || admins.has(n.by as string));
  const hiddenNotes = Array.isArray(stored.history) ? stored.history.filter(n => !visible(n)) : [];
  const sentNotes = Array.isArray(sent.history) ? sent.history.filter(n => isObj(n) && (n.by === me.id || admins.has(n.by as string))) : [];
  const out: Obj = { ...sent, plans: { ...others, ...mine }, pros: storedPros.includes(me.id) ? storedPros : [...storedPros, me.id] };
  if (hiddenNotes.length || sentNotes.length) out.history = [...hiddenNotes, ...sentNotes];
  else delete out.history;
  return out;
}

/* ---------------- lectura ---------------- */

export async function readFilter(me: Me, col: string, docs: { id: string; data: Obj }[]) {
  if (me.admin) return docs;
  if (ADMIN_ONLY.has(col)) return [];
  switch (col) {
    case 'config': return docs;
    case 'users':
      // Los DNI de los demás no se muestran.
      return docs.map(d => (d.id === me.id ? d : { id: d.id, data: { ...d.data, dni: undefined } }));
    case 'news':
      return docs.filter(d => me.coord || d.data.aud === 'all' || (Array.isArray(d.data.aud) && d.data.aud.includes(me.id)));
    case 'agenda':
      return me.pro ? docs.filter(d => agendaPro(d.id) === me.id) : [];
    case 'billing':
      return me.pro ? docs.filter(d => billingPro(d.id) === me.id) : [];
    case 'patients': {
      if (!me.pro) return [];
      const admins = await adminIds();
      return docs.filter(d => patientVisibleTo(me, d.data)).map(d => ({ id: d.id, data: patientFor(me, d.data, admins) }));
    }
  }
  return [];
}

/* ---------------- escritura ---------------- */

async function checkDni(id: string, data: Obj) {
  if (data.dni === undefined || data.dni === null || data.dni === '') return;
  const dni = normDni(data.dni);
  if (!DNI_OK.test(dni)) throw new Forbidden('El DNI tiene que tener entre 6 y 12 números.');
  if ((await usersWithDni()).some(u => u.id !== id && u.dni === dni)) throw new Forbidden('Ese DNI ya está cargado en otro perfil.');
  data.dni = dni;
}

// Devuelve el documento a guardar (puede cambiar respecto del enviado) o lanza Forbidden.
export async function checkWrite(me: Me, col: string, id: string, data: Obj): Promise<Obj> {
  if (col === 'users') {
    if (!me.admin && id !== me.id) throw new Forbidden('Solo podés editar tu propio perfil.');
    const out = { ...data };
    if (!me.admin) {
      // Un profesional no puede cambiarse los perfiles ni el DNI (lo carga administración).
      const stored = await getDoc('users', id);
      for (const k of ['role', 'profiles', 'dni']) { if (stored?.[k] === undefined) delete out[k]; else out[k] = stored[k]; }
    }
    await checkDni(id, out);
    return out;
  }
  if (me.admin) return data;
  if (ADMIN_ONLY.has(col) || col === 'config') throw new Forbidden('Solo administración puede hacer esto.');
  if (col === 'news') {
    if (!me.coord) throw new Forbidden('No tenés permiso para publicar noticias.');
    const stored = await getDoc('news', id);
    if (stored && stored.by !== me.id) throw new Forbidden('Solo podés editar tus noticias.');
    return { ...data, by: me.id };
  }
  if (!me.pro) throw new Forbidden('No tenés permiso.');
  if (col === 'agenda') {
    if (agendaPro(id) !== me.id || (data.proId !== undefined && data.proId !== me.id)) throw new Forbidden('Solo podés modificar tu agenda.');
    return data;
  }
  if (col === 'billing') {
    if (billingPro(id) !== me.id || (data.proId !== undefined && data.proId !== me.id)) throw new Forbidden('Solo podés modificar tu registro.');
    return data;
  }
  if (col === 'patients') {
    const stored = await getDoc('patients', id);
    if (stored && !patientVisibleTo(me, stored)) throw new Forbidden('Ese paciente no es tuyo.');
    return mergePatient(me, stored, data, await adminIds());
  }
  throw new Forbidden('No tenés permiso.');
}

// Borrar: un profesional que borra un paciente compartido solo saca lo suyo.
export async function checkDelete(me: Me, col: string, id: string): Promise<{ replace?: Obj } | null> {
  if (me.admin) return null;
  if (col === 'news') {
    const stored = await getDoc('news', id);
    if (!me.coord || (stored && stored.by !== me.id)) throw new Forbidden('Solo podés borrar tus noticias.');
    return null;
  }
  if (me.pro && col === 'agenda' && agendaPro(id) === me.id) return null;
  if (me.pro && col === 'patients') {
    const stored = await getDoc('patients', id);
    if (!stored) return null;
    if (!patientVisibleTo(me, stored)) throw new Forbidden('Ese paciente no es tuyo.');
    const others = isObj(stored.plans) ? Object.entries(stored.plans).filter(([, pl]) => !(isObj(pl) && pl.proId === me.id)) : [];
    const pros = (Array.isArray(stored.pros) ? (stored.pros as string[]) : []).filter(p => p !== me.id);
    if (!others.length && !pros.length) return null;
    return { replace: { ...stored, plans: Object.fromEntries(others), pros } };
  }
  throw new Forbidden('No tenés permiso.');
}
