// Importa datos a la agenda a través de su propia API, así quedan guardados igual que si los cargara la app.
//
//   node scripts/import.mjs datos-agenda.json https://tu-agenda.vercel.app
//
// Acepta el export "datos-agenda.json" (usa la sección "raw") o una copia descargada desde
// Ajustes → Copias de seguridad. No borra nada: agrega o reemplaza cada documento por su id.
import { readFileSync } from 'node:fs';

const [file, base = 'http://localhost:3000'] = process.argv.slice(2);
if (!file) {
  console.error('Uso: node scripts/import.mjs <archivo.json> [url de la agenda]');
  process.exit(1);
}

const json = JSON.parse(readFileSync(file, 'utf8'));
const src = json.raw || json;
const cfg = src.cfg || src.config || null;
const cols = ['users', 'patients', 'agenda', 'billing', 'news'];

async function put(col, id, data) {
  const r = await fetch(new URL('/api/db/doc', base), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
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
