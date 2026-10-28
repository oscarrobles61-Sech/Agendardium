// Traducción entre los "documentos" que usa la app (el mismo formato del HTML original)
// y las filas de las tablas relacionales. Es puro: no toca la base.
//
// Regla general: cada dato con columna propia va a esa columna si su valor encaja en el tipo;
// lo que no encaja o no tiene columna va a la columna "extra" (jsonb) de la misma fila,
// así una escritura seguida de una lectura devuelve el mismo documento.
// Un valor null se guarda como columna vacía y al leer simplemente no aparece (la app trata
// igual null y ausente).

export type Row = Record<string, unknown>;
type Obj = Record<string, unknown>;

type Kind =
  | 'text' | 'int' | 'num' | 'bool' | 'date' | 'ym' | 'ms' | 'json' | 'textarr' | 'intarr'
  | readonly string[]                // enum
  | { readonly arrayOf: readonly string[] }; // lista de valores de un enum

// [clave en el documento, columna, tipo]
type Field = readonly [string, string, Kind];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-\d{2}$/;
const MD = /^\d{2}-\d{2}$/;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isSmall = (v: unknown) => Number.isInteger(v) && Math.abs(v as number) <= 32767;

function fits(kind: Kind, v: unknown): boolean {
  if (Array.isArray(kind)) return typeof v === 'string' && kind.includes(v);
  if (typeof kind === 'object' && 'arrayOf' in kind) return Array.isArray(v) && v.every(x => typeof x === 'string' && kind.arrayOf.includes(x));
  switch (kind) {
    case 'text': return typeof v === 'string';
    case 'int': return isSmall(v);
    case 'num': return typeof v === 'number' && Number.isFinite(v);
    case 'bool': return typeof v === 'boolean';
    case 'date': return typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v));
    case 'ym': return typeof v === 'string' && YM.test(v);
    case 'ms': return Number.isInteger(v) && (v as number) >= 0 && (v as number) < 8.64e15;
    case 'json': return v !== undefined;
    case 'textarr': return Array.isArray(v) && v.every(x => typeof x === 'string');
    case 'intarr': return Array.isArray(v) && v.every(isSmall);
  }
  return false;
}

const toCol = (kind: Kind, v: unknown) => (kind === 'ms' ? new Date(v as number).toISOString() : v);
const fromCol = (kind: Kind, v: unknown) => (kind === 'ms' ? Date.parse(v as string) : v);

// Separa un objeto en columnas + extra. `skip` son claves que se manejan aparte (tablas hijas).
function split(o: Obj, fields: readonly Field[], skip: readonly string[] = []): Row {
  const row: Row = {}, extra: Obj = {};
  const byKey = new Map(fields.map(f => [f[0], f]));
  for (const [k, v] of Object.entries(o)) {
    if (skip.includes(k) || v === undefined) continue;
    const f = byKey.get(k);
    if (f && (v === null || fits(f[2], v))) { if (v !== null) row[f[1]] = toCol(f[2], v); }
    else extra[k] = v;
  }
  row.extra = extra;
  return row;
}

// Reconstruye el objeto a partir de una fila leída con row_to_json.
function join(row: Row, fields: readonly Field[]): Obj {
  const o: Obj = {};
  for (const [k, col, kind] of fields) if (row[col] != null) o[k] = fromCol(kind, row[col]);
  return Object.assign(o, (row.extra as Obj) || {});
}

/* ---------------- definiciones por tabla ---------------- */

export const ROLES = [
  'secretaria', 'administrador', 'coordinador',
  'kinesiologo', 'medico', 'profesor_ef', 'fonoaudiologo', 'terapista_ocupacional', 'nutricionista', 'psicologo'
] as const;
const SESSION_TYPES = ['rehabilitacion', 'entrenamiento', 'practica'] as const;
const TRAINING_FREQ = ['1', '2', '3', 'libre'] as const;
const PRACTICES = ['osteopatia', 'rpg', 'evaluacion_funcional', 'atm', 'nutricion', 'vestibular', 'piso_pelvico'] as const;
const SESSION_STATUS = ['prog', 'asist', 'falto', 'rec-done', 'cancel'] as const;
const PLAN_STATUS = ['activo', 'finalizado'] as const;
const HOLIDAY_TYPES = ['nacional', 'provincial', 'festivo', 'nolab'] as const;

const CONFIG: Field[] = [
  ['name', 'center_name', 'text'], ['open', 'open_hour', 'int'], ['close', 'close_hour', 'int'],
  ['cap', 'capacity_per_hour', 'int'], ['days', 'work_days', 'intarr'], ['medMin', 'med_minutes', 'int'],
  ['sobre', 'max_overbooks', 'int'], ['maxRec', 'max_recoveries', 'int'], ['endReminder', 'end_reminder_sessions', 'int'],
  ['roles', 'kine_roles', 'textarr'], ['catPrices', 'category_prices', 'json'],
  ['holAuto', 'holidays_auto', 'bool'], ['nolabClose', 'nolab_closes_center', 'bool']
];
const HOLIDAY: Field[] = [
  ['name', 'name', 'text'], ['type', 'type', HOLIDAY_TYPES], ['closed', 'closed', 'bool'],
  ['removed', 'removed', 'bool'], ['from', 'from_year', 'int']
];
const USER: Field[] = [
  ['name', 'name', 'text'], ['dni', 'dni', 'text'], ['title', 'title', 'text'], ['role', 'role', ROLES],
  ['profiles', 'profiles', { arrayOf: ROLES }],
  ['roles', 'kine_roles', 'textarr'], ['photo', 'photo', 'text']
];
const SCHEDULE: Field[] = [
  ['on', 'works', 'bool'], ['from', 'from_hour', 'int'], ['to', 'to_hour', 'int'],
  ['from2', 'from_hour2', 'int'], ['to2', 'to_hour2', 'int'] // 2ª franja del día (opcional)
];
const PATIENT: Field[] = [
  ['name', 'name', 'text'], ['dni', 'dni', 'text'], ['phone', 'phone', 'text'], ['insurance', 'insurance', 'text'],
  ['affiliate', 'affiliate_no', 'text'], ['payCat', 'pay_category', 'int'], ['notes', 'notes', 'text'],
  ['created', 'created_at', 'ms'], ['updated', 'updated_at', 'ms']
];
const PLAN: Field[] = [
  ['proId', 'professional_id', 'text'], ['total', 'total_sessions', 'int'], ['placed', 'placed_sessions', 'int'],
  ['recUsed', 'recoveries_used', 'int'], ['dx', 'diagnosis', 'text'], ['start', 'start_date', 'date'],
  ['lastDate', 'last_date', 'date'], ['status', 'status', PLAN_STATUS], ['billMonth', 'bill_month', 'ym'],
  ['endNote', 'end_note', 'text'], ['endAt', 'ended_at', 'ms'], ['created', 'created_at', 'ms'],
  ['type', 'session_type', SESSION_TYPES], ['freq', 'training_frequency', TRAINING_FREQ], ['practice', 'practice', PRACTICES],
  ['spec', 'specialty', 'text'], ['until', 'until_date', 'date']
];
const PATTERN: Field[] = [['h', 'hour', 'int'], ['m', 'minute', 'int']];
const NOTE: Field[] = [
  ['id', 'id', 'text'], ['by', 'author_id', 'text'], ['byName', 'author_name', 'text'], ['text', 'text', 'text'],
  ['date', 'session_date', 'date'], ['n', 'session_number', 'int'], ['ts', 'created_at', 'ms']
];
const SESSION: Field[] = [
  ['id', 'id', 'text'], ['name', 'patient_name', 'text'], ['phone', 'phone', 'text'], ['note', 'note', 'text'],
  ['pid', 'patient_id', 'text'], ['tid', 'plan_id', 'text'], ['series', 'series_id', 'text'],
  ['n', 'session_number', 'int'], ['status', 'status', SESSION_STATUS], ['rec', 'is_recovery', 'bool'],
  ['recFrom', 'recovery_from_date', 'date'], ['recTo', 'recovery_to', 'text'], ['sob', 'is_overbook', 'bool'],
  ['cancelReason', 'cancel_reason', 'text'], ['cancelGid', 'cancel_group_id', 'text'], ['by', 'created_by', 'text']
];
const BLOCK: Field[] = [
  ['id', 'id', 'text'], ['gid', 'group_id', 'text'], ['date', 'date', 'date'], ['from', 'from_hour', 'int'],
  ['to', 'to_hour', 'int'], ['reason', 'reason', 'text'], ['by', 'created_by', 'text'],
  ['byName', 'created_by_name', 'text'], ['at', 'created_at', 'ms']
];
const BILLING: Field[] = [
  ['note', 'note', 'text'], ['pct', 'percent', 'num'], ['billed', 'billed_total', 'num'], ['paid', 'paid_total', 'num'],
  ['prices', 'category_prices', 'json'], ['updated', 'updated_at', 'ms']
];
const BILLING_PAT: Field[] = [['billed', 'billed', 'num'], ['paid', 'paid', 'num']];
const NEWS: Field[] = [
  ['title', 'title', 'text'], ['text', 'text', 'text'], ['aud', 'audience', 'json'], ['from', 'from_date', 'date'],
  ['to', 'to_date', 'date'], ['pin', 'pinned', 'bool'], ['by', 'author_id', 'text'], ['byName', 'author_name', 'text'],
  ['role', 'author_role', 'text'], ['created', 'created_at', 'ms'], ['updated', 'updated_at', 'ms']
];

/* ---------------- colecciones ---------------- */

// Filas a insertar por tabla, en orden (las tablas hijas después de la principal).
export type Rows = [table: string, rows: Row[]][];

export interface Mapping {
  // Tabla principal y cómo identificar la fila de un documento.
  table: string;
  keyOf(id: string): Row | null;     // null = el id no tiene el formato esperado (se guarda en "docs")
  idOf(row: Row): string;
  toRows(id: string, doc: Obj): Rows;
  // `rows` trae, por tabla, las filas que corresponden a los documentos pedidos.
  fromRows(main: Row, related: (table: string) => Row[]): Obj;
  children: { table: string; fk: string[] }[]; // para leer las tablas hijas
}

const keysOk = (o: unknown, re: RegExp, val: (v: unknown) => boolean) =>
  isObj(o) && Object.entries(o).every(([k, v]) => re.test(k) && val(v));

/* config: solo el documento "main" */
const config: Mapping = {
  table: 'app_config',
  keyOf: id => (id === 'main' ? { id: 1 } : null),
  idOf: () => 'main',
  children: [{ table: 'holidays', fk: [] }],
  toRows(_id, doc) {
    const okHol = keysOk(doc.holidays, DATE, isObj), okYear = keysOk(doc.holYearly, MD, isObj);
    const skip = [...(okHol ? ['holidays'] : []), ...(okYear ? ['holYearly'] : [])];
    const main = { id: 1, ...split(doc, CONFIG, skip) };
    const hol: Row[] = [];
    if (okHol) for (const [date, h] of Object.entries(doc.holidays as Obj)) hol.push({ ...split(h as Obj, HOLIDAY), date, yearly: false });
    if (okYear) for (const [md, h] of Object.entries(doc.holYearly as Obj)) hol.push({ ...split(h as Obj, HOLIDAY), month_day: md, yearly: true });
    return [['app_config', [main]], ['holidays', hol]];
  },
  fromRows(main, related) {
    const doc = join(main, CONFIG);
    const hol = related('holidays').sort((a, b) => (a.id as number) - (b.id as number));
    const holidays: Obj = {}, holYearly: Obj = {};
    for (const h of hol) {
      if (h.yearly) holYearly[h.month_day as string] = join(h, HOLIDAY);
      else holidays[h.date as string] = join(h, HOLIDAY);
    }
    if (Object.keys(holidays).length) doc.holidays = holidays;
    if (Object.keys(holYearly).length) doc.holYearly = holYearly;
    return doc;
  }
};

const users: Mapping = {
  table: 'users',
  keyOf: id => ({ id }),
  idOf: r => r.id as string,
  children: [{ table: 'user_schedules', fk: ['user_id'] }],
  toRows(id, doc) {
    const okSch = keysOk(doc.schedule, /^[0-6]$/, isObj);
    // El ingreso es con DNI: un PIN viejo (hash) no se guarda.
    const main = { id, ...split(doc, USER, ['pin', ...(okSch ? ['schedule'] : [])]) };
    const sch = okSch ? Object.entries(doc.schedule as Obj).map(([d, s]) => ({ ...split(s as Obj, SCHEDULE), user_id: id, weekday: +d })) : [];
    return [['users', [main]], ['user_schedules', sch]];
  },
  fromRows(main, related) {
    const doc = join(main, USER);
    const schedule: Obj = {};
    // Solo los horarios de este integrante (al leer todo el equipo vienen las filas de todos).
    for (const s of related('user_schedules').filter(r => r.user_id === main.id).sort((a, b) => (a.weekday as number) - (b.weekday as number))) schedule[String(s.weekday)] = join(s, SCHEDULE);
    if (!('schedule' in doc)) doc.schedule = schedule;
    return doc;
  }
};

const patients: Mapping = {
  table: 'patients',
  keyOf: id => ({ id }),
  idOf: r => r.id as string,
  children: [
    { table: 'patient_professionals', fk: ['patient_id'] },
    { table: 'treatment_plans', fk: ['patient_id'] },
    { table: 'plan_day_patterns', fk: [] }, // se filtra por plan_id
    { table: 'patient_notes', fk: ['patient_id'] }
  ],
  toRows(id, doc) {
    const pros = doc.pros;
    const okPros = Array.isArray(pros) && pros.every(x => typeof x === 'string') && new Set(pros).size === pros.length;
    const okPlans = isObj(doc.plans) && Object.values(doc.plans).every(isObj);
    const hist = doc.history;
    const okHist = Array.isArray(hist) && hist.every(n => isObj(n) && typeof n.id === 'string') && new Set(hist.map(n => (n as Obj).id)).size === hist.length;
    const skip = [...(okPros ? ['pros'] : []), ...(okPlans ? ['plans'] : []), ...(okHist ? ['history'] : [])];
    const main = { id, ...split(doc, PATIENT, skip) };
    const proRows = okPros ? (pros as string[]).map((u, pos) => ({ patient_id: id, user_id: u, pos })) : [];
    const planRows: Row[] = [], patRows: Row[] = [];
    if (okPlans) Object.entries(doc.plans as Obj).forEach(([tid, pl], pos) => {
      const p = pl as Obj;
      const okPat = keysOk(p.pat, /^[0-6]$/, isObj);
      planRows.push({ ...split(p, PLAN, okPat ? ['pat'] : []), id: tid, patient_id: id, pos });
      if (okPat) for (const [d, pa] of Object.entries(p.pat as Obj)) patRows.push({ ...split(pa as Obj, PATTERN), plan_id: tid, weekday: +d });
    });
    const noteRows = okHist ? (hist as Obj[]).map((n, pos) => ({ ...split(n, NOTE), patient_id: id, pos })) : [];
    return [['patients', [main]], ['patient_professionals', proRows], ['treatment_plans', planRows], ['plan_day_patterns', patRows], ['patient_notes', noteRows]];
  },
  fromRows(main, related) {
    const id = main.id;
    const doc = join(main, PATIENT);
    const byPos = (a: Row, b: Row) => (a.pos as number) - (b.pos as number);
    if (!('pros' in doc)) doc.pros = related('patient_professionals').filter(r => r.patient_id === id).sort(byPos).map(r => r.user_id);
    if (!('plans' in doc)) {
      const plans: Obj = {};
      const pats = related('plan_day_patterns');
      for (const pr of related('treatment_plans').filter(r => r.patient_id === id).sort(byPos)) {
        const pl = join(pr, PLAN);
        const mine = pats.filter(r => r.plan_id === pr.id).sort((a, b) => (a.weekday as number) - (b.weekday as number));
        if (mine.length && !('pat' in pl)) { const pat: Obj = {}; for (const r of mine) pat[String(r.weekday)] = join(r, PATTERN); pl.pat = pat; }
        plans[pr.id as string] = pl;
      }
      doc.plans = plans;
    }
    const notes = related('patient_notes').filter(r => r.patient_id === id).sort(byPos);
    if (notes.length && !('history' in doc)) doc.history = notes.map(r => join(r, NOTE));
    return doc;
  }
};

const SLOT = /^(\d{4}-\d{2}-\d{2})_(\d{1,2})(?:_(\d{1,2}))?$/;
const EMPTY_SLOTS = '__emptySlots';

/* agenda: un documento por semana y profesional, id = "YYYY-MM-DD_<proId>" */
const agenda: Mapping = {
  table: 'agenda_weeks',
  keyOf(id) {
    const m = /^(\d{4}-\d{2}-\d{2})_(.+)$/.exec(id);
    return m && fits('date', m[1]) ? { week: m[1], professional_id: m[2] } : null;
  },
  idOf: r => r.week + '_' + r.professional_id,
  children: [{ table: 'sessions', fk: ['week', 'professional_id'] }, { table: 'agenda_blocks', fk: ['week', 'professional_id'] }],
  toRows(id, doc) {
    const key = agenda.keyOf(id)!;
    const slots = doc.slots;
    const okSlots = isObj(slots) && Object.entries(slots).every(([k, arr]) => SLOT.test(k) && Array.isArray(arr) && arr.every(isObj));
    const okBlocks = Array.isArray(doc.blocks) && doc.blocks.every(isObj);
    const skip = ['week', 'proId', ...(okSlots ? ['slots'] : []), ...(okBlocks ? ['blocks'] : [])];
    const extra: Obj = split(doc, [], skip).extra as Obj;
    if (doc.week !== undefined && doc.week !== key.week) extra.week = doc.week;
    if (doc.proId !== undefined && doc.proId !== key.professional_id) extra.proId = doc.proId;
    const sess: Row[] = [], empty: string[] = [];
    if (okSlots) for (const [k, arr] of Object.entries(slots as Obj)) {
      const [, date, h, m] = SLOT.exec(k)!;
      if (!(arr as Obj[]).length) empty.push(k);
      (arr as Obj[]).forEach((e, slot_pos) => sess.push({ ...split(e, SESSION), ...key, date, hour: +h, minute: m == null ? null : +m, slot_pos }));
    }
    if (empty.length) extra[EMPTY_SLOTS] = empty;
    const blocks = okBlocks ? (doc.blocks as Obj[]).map((b, pos) => ({ ...split(b, BLOCK), ...key, pos })) : [];
    return [['agenda_weeks', [{ ...key, extra }]], ['sessions', sess], ['agenda_blocks', blocks]];
  },
  fromRows(main, related) {
    const extra = { ...((main.extra as Obj) || {}) };
    const empty = (extra[EMPTY_SLOTS] as string[]) || [];
    delete extra[EMPTY_SLOTS];
    const doc: Obj = { week: main.week, proId: main.professional_id };
    const same = (r: Row) => r.week === main.week && r.professional_id === main.professional_id;
    const sess = related('sessions').filter(same).sort((a, b) =>
      (a.date as string).localeCompare(b.date as string) || (a.hour as number) - (b.hour as number) ||
      ((a.minute as number) ?? -1) - ((b.minute as number) ?? -1) || (a.slot_pos as number) - (b.slot_pos as number));
    const slots: Obj = {};
    for (const s of sess) {
      const k = s.date + '_' + s.hour + (s.minute == null ? '' : '_' + s.minute);
      ((slots[k] as Obj[]) ||= []).push(join(s, SESSION));
    }
    for (const k of empty) if (!slots[k]) slots[k] = [];
    doc.slots = slots;
    const blocks = related('agenda_blocks').filter(same).sort((a, b) => (a.pos as number) - (b.pos as number));
    if (blocks.length) doc.blocks = blocks.map(b => join(b, BLOCK));
    return Object.assign(doc, extra);
  }
};

/* billing: un documento por profesional y mes, id = "<proId>_YYYY-MM" */
const billing: Mapping = {
  table: 'billing_months',
  keyOf(id) {
    const m = /^(.+)_(\d{4}-\d{2})$/.exec(id);
    return m ? { professional_id: m[1], month: m[2] } : null;
  },
  idOf: r => r.professional_id + '_' + r.month,
  children: [{ table: 'billing_patients', fk: ['professional_id', 'month'] }],
  toRows(id, doc) {
    const key = billing.keyOf(id)!;
    const okCats = keysOk(doc.cats, /^.+$/, isSmall);
    const okPats = keysOk(doc.pats, /^.+$/, isObj);
    const skip = ['proId', 'month', ...(okCats ? ['cats'] : []), ...(okPats ? ['pats'] : [])];
    const main = { ...split(doc, BILLING, skip), ...key };
    const extra = main.extra as Obj;
    if (doc.proId !== undefined && doc.proId !== key.professional_id) extra.proId = doc.proId;
    if (doc.month !== undefined && doc.month !== key.month) extra.month = doc.month;
    const rows = new Map<string, Row>();
    const get = (pid: string) => { if (!rows.has(pid)) rows.set(pid, { ...key, patient_id: pid, pos: rows.size, has_amounts: false, extra: {} }); return rows.get(pid)!; };
    if (okCats) for (const [pid, c] of Object.entries(doc.cats as Obj)) get(pid).category = c;
    if (okPats) for (const [pid, p] of Object.entries(doc.pats as Obj)) Object.assign(get(pid), split(p as Obj, BILLING_PAT), { has_amounts: true });
    return [['billing_months', [main]], ['billing_patients', [...rows.values()]]];
  },
  fromRows(main, related) {
    const doc: Obj = { proId: main.professional_id, month: main.month, ...join(main, BILLING) };
    const cats: Obj = {}, pats: Obj = {};
    const mine = related('billing_patients').filter(r => r.professional_id === main.professional_id && r.month === main.month)
      .sort((a, b) => (a.pos as number) - (b.pos as number));
    for (const r of mine) {
      if (r.category != null) cats[r.patient_id as string] = r.category;
      if (r.has_amounts) pats[r.patient_id as string] = join(r, BILLING_PAT);
    }
    if (!('cats' in doc)) doc.cats = cats;
    if (!('pats' in doc)) doc.pats = pats;
    return doc;
  }
};

const news: Mapping = {
  table: 'news',
  keyOf: id => ({ id }),
  idOf: r => r.id as string,
  children: [],
  toRows: (id, doc) => [['news', [{ id, ...split(doc, NEWS) }]]],
  fromRows: main => join(main, NEWS)
};

export const MAPPINGS: Record<string, Mapping> = { config, users, patients, agenda, billing, news };

// Columnas que se insertan en cada tabla (las autonuméricas quedan afuera).
export const COLUMNS: Record<string, string[]> = {
  app_config: ['id', 'center_name', 'open_hour', 'close_hour', 'capacity_per_hour', 'work_days', 'med_minutes', 'max_overbooks', 'max_recoveries', 'end_reminder_sessions', 'kine_roles', 'category_prices', 'holidays_auto', 'nolab_closes_center', 'extra'],
  holidays: ['date', 'month_day', 'name', 'type', 'closed', 'removed', 'yearly', 'from_year', 'extra'],
  users: ['id', 'name', 'dni', 'title', 'role', 'profiles', 'kine_roles', 'photo', 'active', 'extra'],
  user_schedules: ['user_id', 'weekday', 'works', 'from_hour', 'to_hour', 'from_hour2', 'to_hour2', 'extra'],
  patients: ['id', 'name', 'dni', 'phone', 'insurance', 'affiliate_no', 'pay_category', 'notes', 'created_at', 'updated_at', 'extra'],
  patient_professionals: ['patient_id', 'user_id', 'pos'],
  treatment_plans: ['id', 'patient_id', 'professional_id', 'total_sessions', 'placed_sessions', 'recoveries_used', 'diagnosis', 'start_date', 'last_date', 'status', 'bill_month', 'end_note', 'ended_at', 'created_at', 'session_type', 'training_frequency', 'practice', 'specialty', 'until_date', 'pos', 'extra'],
  plan_day_patterns: ['plan_id', 'weekday', 'hour', 'minute', 'extra'],
  patient_notes: ['id', 'patient_id', 'author_id', 'author_name', 'text', 'session_date', 'session_number', 'created_at', 'pos', 'extra'],
  agenda_weeks: ['week', 'professional_id', 'extra'],
  sessions: ['id', 'week', 'professional_id', 'date', 'hour', 'minute', 'slot_pos', 'patient_id', 'plan_id', 'series_id', 'patient_name', 'phone', 'note', 'session_number', 'status', 'is_recovery', 'recovery_from_date', 'recovery_to', 'is_overbook', 'cancel_reason', 'cancel_group_id', 'created_by', 'extra'],
  agenda_blocks: ['id', 'week', 'professional_id', 'group_id', 'date', 'from_hour', 'to_hour', 'reason', 'created_by', 'created_by_name', 'created_at', 'pos', 'extra'],
  billing_months: ['professional_id', 'month', 'note', 'percent', 'billed_total', 'paid_total', 'category_prices', 'updated_at', 'extra'],
  billing_patients: ['professional_id', 'month', 'patient_id', 'category', 'has_amounts', 'billed', 'paid', 'pos', 'extra'],
  news: ['id', 'title', 'text', 'audience', 'from_date', 'to_date', 'pinned', 'author_id', 'author_name', 'author_role', 'created_at', 'updated_at', 'extra']
};
