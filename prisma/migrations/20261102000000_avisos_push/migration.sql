-- Avisos entre secretaría y profesionales, con notificaciones push (Web Push).

-- Claves VAPID para firmar los envíos. Las genera la app la primera vez (una sola fila, id = 1).
-- Nunca se mandan al navegador salvo la pública.
CREATE TABLE IF NOT EXISTS "push_keys" (
  "id"          SMALLINT PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "public_key"  TEXT NOT NULL,
  "private_key" TEXT NOT NULL,
  "created_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

-- Un registro por dispositivo (teléfono o navegador) donde alguien activó los avisos.
-- Sin clave foránea a users: la app reescribe la fila del usuario al guardar su perfil y eso borraría las suscripciones.
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "endpoint"   TEXT PRIMARY KEY,
  "user_id"    TEXT NOT NULL,
  "p256dh"     TEXT NOT NULL,
  "auth"       TEXT NOT NULL,
  "user_agent" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");

-- Cada aviso enviado. to_group = 'secretaria' cuando un profesional se lo manda a toda la secretaría.
CREATE TABLE IF NOT EXISTS "notifications" (
  "id"            BIGSERIAL PRIMARY KEY,
  "created_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "from_id"       TEXT NOT NULL,
  "to_id"         TEXT,
  "to_group"      TEXT,
  "message"       TEXT NOT NULL,
  "comment"       TEXT,
  "patient_id"    TEXT,
  "patient_name"  TEXT,
  "session_date"  DATE,
  "session_time"  TEXT,
  "professional_id" TEXT,
  "reply_to"      BIGINT REFERENCES "notifications"("id") ON DELETE SET NULL,
  "handled_by"    TEXT,
  "handled_text"  TEXT,
  "handled_at"    TIMESTAMPTZ(3)
);
CREATE INDEX IF NOT EXISTS "notifications_from_idx" ON "notifications" ("from_id", "created_at" DESC);

-- Quién recibe cada aviso y si ya lo leyó.
CREATE TABLE IF NOT EXISTS "notification_recipients" (
  "notification_id" BIGINT NOT NULL REFERENCES "notifications"("id") ON DELETE CASCADE,
  "user_id"         TEXT NOT NULL,
  "read_at"         TIMESTAMPTZ(3),
  PRIMARY KEY ("notification_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "notification_recipients_user_idx" ON "notification_recipients" ("user_id", "read_at");
