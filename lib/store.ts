import { sql } from './db';
import { COLUMNS, MAPPINGS, type Row } from './docmap';

// Acceso a los documentos de la agenda.
// config, users, patients, agenda, billing y news viven en tablas relacionales (ver lib/docmap.ts);
// el resto (backups, backupidx, meta) y cualquier id con otro formato quedan en la tabla "docs".

type Obj = Record<string, unknown>;
export type Doc = { id: string; data: Obj };
export type Where = [field: string, op: '==', value: unknown];

const isRelational = (col: string) => col in MAPPINGS;

// Columnas con valor por defecto: jsonb_populate_recordset pone NULL en lo que falta.
const DEFAULTS: Record<string, string> = {
  extra: `'{}'::jsonb`, pos: '0', slot_pos: '0', has_amounts: 'false', yearly: 'false', active: 'true'
};

// Expresión que da el id de documento de cada fila, por colección y tabla.
const DOC_ID: Record<string, Record<string, string>> = {
  config: { app_config: `'main'`, holidays: `'main'` },
  users: { users: 'x.id', user_schedules: 'x.user_id' },
  patients: {
    patients: 'x.id', patient_professionals: 'x.patient_id', treatment_plans: 'x.patient_id', patient_notes: 'x.patient_id',
    plan_day_patterns: '(SELECT t.patient_id FROM treatment_plans t WHERE t.id = x.plan_id)'
  },
  agenda: {
    agenda_weeks: `(x.week::text || '_' || x.professional_id)`,
    sessions: `(x.week::text || '_' || x.professional_id)`,
    agenda_blocks: `(x.week::text || '_' || x.professional_id)`
  },
  billing: {
    billing_months: `(x.professional_id || '_' || x.month)`,
    billing_patients: `(x.professional_id || '_' || x.month)`
  },
  news: { news: 'x.id' }
};

type Stmt = { text: string; params: unknown[] };

function insert(table: string, rows: Row[]): Stmt | null {
  if (!rows.length) return null;
  const cols = COLUMNS[table];
  const select = cols.map(c => (DEFAULTS[c] ? `COALESCE(x.${c}, ${DEFAULTS[c]})` : `x.${c}`)).join(', ');
  return {
    text: `INSERT INTO ${table} (${cols.join(', ')}) SELECT ${select} FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb) x`,
    params: [JSON.stringify(rows)]
  };
}

const bump = (col: string): Stmt => ({
  text: `INSERT INTO doc_versions (col, v) VALUES ($1, 1) ON CONFLICT (col) DO UPDATE SET v = doc_versions.v + 1`,
  params: [col]
});

function deleteMain(col: string, key: Row): Stmt[] {
  const m = MAPPINGS[col];
  const cols = Object.keys(key);
  const out: Stmt[] = [{
    text: `DELETE FROM ${m.table} WHERE ${cols.map((c, i) => `${c} = $${i + 1}`).join(' AND ')}`,
    params: cols.map(c => key[c])
  }];
  // Los feriados no cuelgan de app_config por clave foránea.
  if (col === 'config') out.push({ text: 'DELETE FROM holidays', params: [] });
  return out;
}

async function run(stmts: Stmt[]) {
  const q = sql();
  await q.transaction(stmts.map(s => q.query(s.text, s.params)));
}

/* ---------------- escritura ---------------- */

export async function setDoc(col: string, id: string, data: Obj) {
  const m = MAPPINGS[col];
  const key = m?.keyOf(id);
  if (!m || !key) {
    return run([
      { text: `INSERT INTO docs (col, id, data, updated_at) VALUES ($1, $2, $3::jsonb, now())
               ON CONFLICT (col, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, params: [col, id, JSON.stringify(data)] },
      bump(col)
    ]);
  }
  const stmts: Stmt[] = [...deleteMain(col, key), { text: 'DELETE FROM docs WHERE col = $1 AND id = $2', params: [col, id] }];
  for (const [table, rows] of m.toRows(id, data)) { const s = insert(table, rows); if (s) stmts.push(s); }
  stmts.push(bump(col));
  await run(stmts);
}

export async function deleteDoc(col: string, id: string) {
  const key = MAPPINGS[col]?.keyOf(id);
  const stmts: Stmt[] = [{ text: 'DELETE FROM docs WHERE col = $1 AND id = $2', params: [col, id] }];
  if (key) stmts.unshift(...deleteMain(col, key));
  stmts.push(bump(col));
  await run(stmts);
}

/* ---------------- lectura ---------------- */

// Lee los documentos de una colección. `ids` limita a esos documentos; `agendaFilter` filtra por columna
// (solo agenda, para no traer todas las semanas).
async function load(col: string, ids: string[] | null, agendaFilter: { week?: string; proId?: string } = {}): Promise<Doc[]> {
  const q = sql();
  const queries: { table: string; text: string; params: unknown[] }[] = [];
  if (isRelational(col)) {
    for (const [table, idExpr] of Object.entries(DOC_ID[col])) {
      const params: unknown[] = [];
      const conds: string[] = [];
      if (ids) { params.push(ids); conds.push(`${idExpr} = ANY($${params.length}::text[])`); }
      if (col === 'agenda' && agendaFilter.week) { params.push(agendaFilter.week); conds.push(`x.week = $${params.length}::date`); }
      if (col === 'agenda' && agendaFilter.proId) { params.push(agendaFilter.proId); conds.push(`x.professional_id = $${params.length}`); }
      queries.push({ table, text: `SELECT row_to_json(x) AS r FROM ${table} x${conds.length ? ' WHERE ' + conds.join(' AND ') : ''}`, params });
    }
  }
  queries.push({
    table: 'docs',
    text: `SELECT id, data FROM docs WHERE col = $1${ids ? ' AND id = ANY($2::text[])' : ''} ORDER BY id`,
    params: ids ? [col, ids] : [col]
  });
  const results = await q.transaction(queries.map(x => q.query(x.text, x.params)), { readOnly: true, isolationLevel: 'RepeatableRead' });
  const byTable = new Map<string, Row[]>();
  queries.forEach((x, i) => byTable.set(x.table, (results[i] as Row[]).map(r => (x.table === 'docs' ? r : (r.r as Row)))));

  const out: Doc[] = [];
  if (isRelational(col)) {
    const m = MAPPINGS[col];
    const related = (t: string) => byTable.get(t) || [];
    for (const main of related(m.table)) out.push({ id: m.idOf(main), data: m.fromRows(main, related) });
  }
  const seen = new Set(out.map(d => d.id));
  for (const r of byTable.get('docs') || []) if (!seen.has(r.id as string)) out.push({ id: r.id as string, data: r.data as Obj });
  return out;
}

export const getDocsRaw = (col: string) => load(col, null);

export async function getDoc(col: string, id: string): Promise<Obj | null> {
  const docs = await load(col, [id]);
  return docs.length ? docs[0].data : null;
}

const cmp = (a: unknown, b: unknown) =>
  a === b ? 0 : a == null ? 1 : b == null ? -1 : (a as number | string) < (b as number | string) ? -1 : 1;

export async function queryDocs(
  col: string, where: Where[], orderBy: [string, string] | null, limit: number,
  visible: (docs: Doc[]) => Promise<Doc[]> = async d => d
): Promise<Doc[]> {
  const agendaFilter: { week?: string; proId?: string } = {};
  if (col === 'agenda') for (const [f, , v] of where) {
    if (f === 'week' && typeof v === 'string') agendaFilter.week = v;
    if (f === 'proId' && typeof v === 'string') agendaFilter.proId = v;
  }
  // Si la semana no tiene formato de fecha no hay filas relacionales que coincidan; igual se filtra abajo.
  if (agendaFilter.week && !/^\d{4}-\d{2}-\d{2}$/.test(agendaFilter.week)) delete agendaFilter.week;
  let docs = await load(col, null, agendaFilter);
  docs = await visible(docs.filter(d => where.every(([f, , v]) => JSON.stringify(d.data[f] ?? null) === JSON.stringify(v ?? null))));
  if (orderBy) {
    const [f, dir] = orderBy;
    docs.sort((a, b) => cmp(a.data[f], b.data[f]) * (dir === 'desc' && a.data[f] != null && b.data[f] != null ? -1 : 1) || cmp(a.id, b.id));
  } else docs.sort((a, b) => cmp(a.id, b.id));
  return docs.slice(0, limit);
}
