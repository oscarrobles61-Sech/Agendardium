// Importa datos a la agenda a través de su propia API, así quedan guardados igual que si los cargara la app.
//
//   node scripts/import.mjs datos-agenda.json https://tu-agenda.vercel.app <DNI de administración>
//
// Hace falta el DNI de un perfil de secretaría o administración: la API solo deja escribir con sesión.
// Acepta el export "datos-agenda.json" (usa la sección "raw") o una copia descargada desde
// Ajustes → Copias de seguridad. No borra nada: agrega o reemplaza cada documento por su id.
import { readFileSync } from 'node:fs';

const [file, base = 'http://localhost:3000', dni] = process.argv.slice(2);
if (!file || !dni) {
  console.error('Uso: node scripts/import.mjs <archivo.json> <url de la agenda> <DNI de administración>');
  process.exit(1);
}

const json = JSON.parse(readFileSync(file, 'utf8'));
const src = json.raw || json;
const cfg = src.cfg || src.config || null;
const cols = ['users', 'patients', 'agenda', 'billing', 'news'];

const login = await fetch(new URL('/api/auth/login', base), {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dni })
});
if (!login.ok) throw new Error(`No se pudo ingresar con ese DNI: ${await login.text()}`);
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];

async function get(col, id) {
  const r = await fetch(new URL(`/api/db/doc?col=${encodeURIComponent(col)}&id=${encodeURIComponent(id)}`, base), { headers: { cookie } });
  return r.ok ? (await r.json()).data : null;
}

async function put(col, id, data) {
  // El export no trae DNI ni perfiles múltiples: se conservan los que ya estén cargados
  // (si se borrara el DNI, esa persona no podría volver a ingresar).
  if (col === 'users' && (!data.dni || !data.profiles)) {
    const prev = await get(col, id);
    if (prev && prev.dni && !data.dni) data = { ...data, dni: prev.dni };
    if (prev && prev.profiles && !data.profiles) data = { ...data, profiles: prev.profiles };
  }
  const r = await fetch(new URL('/api/db/doc', base), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ col, id, data })
  });
  if (!r.ok) throw new Error(`${col}/${id}: HTTP ${r.status} ${await r.text()}`);
}

let n = 0;
if (cfg) { await put('config', 'main', cfg); n++; }
for (const col of cols) {
  for (const [id, data] of Object.entries(src[col] || {})) { await put(col, id, data); n++; }
}
console.log(`Listo: ${n} documentos importados en ${base}.`);
