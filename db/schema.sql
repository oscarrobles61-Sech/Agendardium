-- Esquema de la agenda. La app lo crea sola al primer uso; este archivo es para referencia
-- o para correrlo a mano en el SQL Editor de Neon.
CREATE TABLE IF NOT EXISTS docs (
  col text NOT NULL,              -- colección: config, users, agenda, patients, billing, news, backups, backupidx, meta
  id text NOT NULL,               -- id del documento dentro de la colección
  data jsonb NOT NULL,            -- contenido del documento
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (col, id)
);
CREATE INDEX IF NOT EXISTS docs_agenda_week ON docs ((data->>'week')) WHERE col = 'agenda';

-- Contador de cambios por colección: el navegador lo consulta para saber cuándo refrescar.
CREATE TABLE IF NOT EXISTS doc_versions (
  col text PRIMARY KEY,
  v bigint NOT NULL DEFAULT 0
);
