-- Usuarios en línea: una fila por persona con la agenda abierta (se pisa, no crece).
-- last_seen: última señal (llega con el sondeo de cambios que la agenda ya hace cada pocos segundos).
-- last_input: última vez que tocó la pantalla (para mostrar "inactivo").
-- state: qué está mirando o qué turno tiene abierto ({ tab, proId, week, ed: { proId, date, h, m, eid, add } }).
CREATE TABLE IF NOT EXISTS "presence" (
    "user_id" TEXT NOT NULL,
    "last_seen" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "last_input" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "device" TEXT NOT NULL DEFAULT 'pc',
    "state" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "presence_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "presence_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
