-- Tablas relacionales de la agenda (basadas en schema.sql de INSTRUCCIONES.md).
-- Cambios respecto de ese archivo:
--   * users: sin pin_hash_legacy / password_hash / must_change_pin; se agrega "dni" (texto plano, se usa para ingresar).
--   * Columnas "extra" (jsonb): guardan cualquier dato que la app use y no tenga columna propia, para no perder nada.
--   * Columnas de datos sin NOT NULL ni DEFAULT: la app distingue "no cargado" de un valor por defecto.
--   * Sin claves foráneas hacia users ni entre agenda y pacientes: la app permite borrar un perfil o
--     un paciente y conservar su historial de turnos y facturación.
--   * sessions y agenda_blocks guardan la semana (lunes) y la posición del renglón, como la planilla.
-- La tabla "docs" queda solo para las copias de seguridad (backups, backupidx, meta).

CREATE TYPE "user_role" AS ENUM ('secretaria', 'kinesiologo', 'medico', 'coordinador');
CREATE TYPE "session_status" AS ENUM ('prog', 'asist', 'falto', 'rec-done', 'cancel');
CREATE TYPE "plan_status" AS ENUM ('activo', 'finalizado');
CREATE TYPE "holiday_type" AS ENUM ('nacional', 'provincial', 'festivo', 'nolab');

-- Configuración general (una sola fila)
CREATE TABLE "app_config" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "center_name" TEXT,
    "open_hour" SMALLINT,
    "close_hour" SMALLINT,
    "capacity_per_hour" SMALLINT,
    "work_days" SMALLINT[],                 -- 0=domingo ... 6=sábado
    "med_minutes" SMALLINT,                 -- duración de consulta médica
    "max_overbooks" SMALLINT,               -- sobreturnos por turno médico
    "max_recoveries" SMALLINT,              -- recuperos por tratamiento
    "end_reminder_sessions" SMALLINT,       -- avisar cuando quedan N sesiones
    "kine_roles" TEXT[],                    -- especialidades de kinesiología
    "category_prices" JSONB,                -- {"1":1000,"2":2000,...}
    "holidays_auto" BOOLEAN,
    "nolab_closes_center" BOOLEAN,
    "extra" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "app_config_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "app_config_single_row" CHECK ("id" = 1)
);

-- Feriados cargados a mano (los nacionales se calculan en la app)
CREATE TABLE "holidays" (
    "id" SERIAL NOT NULL,
    "date" DATE,                            -- fecha puntual (null si se repite todos los años)
    "month_day" CHAR(5),                    -- 'MM-DD' si yearly = true
    "name" TEXT,
    "type" "holiday_type",
    "closed" BOOLEAN,
    "removed" BOOLEAN,                      -- true = desactiva un feriado automático en esa fecha
    "yearly" BOOLEAN NOT NULL DEFAULT false,
    "from_year" SMALLINT,
    "extra" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "holidays_date_or_month_day" CHECK (("yearly" AND "month_day" IS NOT NULL) OR (NOT "yearly" AND "date" IS NOT NULL))
);

CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "dni" TEXT,                             -- DNI en texto plano: es el dato con el que la persona ingresa
    "title" TEXT,                           -- ej. "Lic. en Kinesiología MP 1234"
    "role" "user_role",
    "kine_roles" TEXT[],                    -- especialidades (solo kinesiólogos)
    "photo" TEXT,                           -- foto de perfil (data URL)
    "active" BOOLEAN NOT NULL DEFAULT true,
    "extra" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "users_dni_idx" ON "users" ("dni");

-- Horario de trabajo de cada profesional por día de la semana
CREATE TABLE "user_schedules" (
    "user_id" TEXT NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "works" BOOLEAN,
    "from_hour" SMALLINT,
    "to_hour" SMALLINT,
    "extra" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "user_schedules_pkey" PRIMARY KEY ("user_id", "weekday"),
    CONSTRAINT "user_schedules_weekday" CHECK ("weekday" BETWEEN 0 AND 6),
    CONSTRAINT "user_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "dni" TEXT,
    "phone" TEXT,
    "insurance" TEXT,                       -- obra social
    "affiliate_no" TEXT,
    "pay_category" SMALLINT,                -- 1 a 4 (0 = sin categoría)
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3),
    "extra" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- Profesionales que atendieron/atienden al paciente
CREATE TABLE "patient_professionals" (
    "patient_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "pos" SMALLINT NOT NULL DEFAULT 0,
    CONSTRAINT "patient_professionals_pkey" PRIMARY KEY ("patient_id", "user_id"),
    CONSTRAINT "patient_professionals_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Un tratamiento = un plan de N sesiones con un profesional
CREATE TABLE "treatment_plans" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "professional_id" TEXT,
    "total_sessions" SMALLINT,
    "placed_sessions" SMALLINT,             -- sesiones ya agendadas
    "recoveries_used" SMALLINT,
    "diagnosis" TEXT,
    "start_date" DATE,
    "last_date" DATE,                       -- fecha de la última sesión agendada
    "status" "plan_status",
    "bill_month" CHAR(7),                   -- 'YYYY-MM' del mes en que se factura
    "end_note" TEXT,
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3),
    "pos" SMALLINT NOT NULL DEFAULT 0,
    "extra" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "treatment_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "treatment_plans_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "treatment_plans_patient_idx" ON "treatment_plans" ("patient_id");

-- Patrón original de días/horas del tratamiento (para reprogramar "corriendo")
CREATE TABLE "plan_day_patterns" (
    "plan_id" TEXT NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "hour" SMALLINT,
    "minute" SMALLINT,                      -- solo médicos (turnos de 20 min)
    "extra" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "plan_day_patterns_pkey" PRIMARY KEY ("plan_id", "weekday"),
    CONSTRAINT "plan_day_patterns_weekday" CHECK ("weekday" BETWEEN 0 AND 6),
    CONSTRAINT "plan_day_patterns_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "treatment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Notas tipo historia clínica
CREATE TABLE "patient_notes" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "author_id" TEXT,
    "author_name" TEXT,
    "text" TEXT,
    "session_date" DATE,
    "session_number" SMALLINT,
    "created_at" TIMESTAMPTZ(3),
    "pos" SMALLINT NOT NULL DEFAULT 0,
    "extra" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "patient_notes_pkey" PRIMARY KEY ("patient_id", "id"),
    CONSTRAINT "patient_notes_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Semana de agenda de un profesional (existe aunque no tenga turnos)
CREATE TABLE "agenda_weeks" (
    "week" DATE NOT NULL,                   -- lunes de la semana
    "professional_id" TEXT NOT NULL,
    "extra" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "agenda_weeks_pkey" PRIMARY KEY ("week", "professional_id")
);

-- Cada turno de la agenda. Ocupan lugar las sesiones cuyo estado no es falto, rec-done ni cancel
CREATE TABLE "sessions" (
    "row_id" BIGSERIAL NOT NULL,
    "id" TEXT,
    "week" DATE NOT NULL,
    "professional_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hour" SMALLINT NOT NULL,
    "minute" SMALLINT,                      -- null salvo médicos
    "slot_pos" SMALLINT NOT NULL DEFAULT 0, -- renglón dentro de la hora
    "patient_id" TEXT,
    "plan_id" TEXT,
    "series_id" TEXT,
    "patient_name" TEXT,                    -- se conserva aunque falte la ficha
    "phone" TEXT,
    "note" TEXT,
    "session_number" SMALLINT,              -- 1 = primera sesión (se resalta en amarillo)
    "status" "session_status",              -- null = programada
    "is_recovery" BOOLEAN,
    "recovery_from_date" DATE,
    "recovery_to" TEXT,                     -- turno donde se recuperó una falta ('YYYY-MM-DD_HH')
    "is_overbook" BOOLEAN,
    "cancel_reason" TEXT,
    "cancel_group_id" TEXT,
    "created_by" TEXT,
    "extra" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("row_id"),
    CONSTRAINT "sessions_week_fkey" FOREIGN KEY ("week", "professional_id") REFERENCES "agenda_weeks"("week", "professional_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "sessions_agenda_idx" ON "sessions" ("professional_id", "date", "hour");
CREATE INDEX "sessions_week_idx" ON "sessions" ("week", "professional_id");
CREATE INDEX "sessions_plan_idx" ON "sessions" ("plan_id");
CREATE INDEX "sessions_patient_idx" ON "sessions" ("patient_id");

-- Bloqueos de agenda (función "Cancelar agenda")
CREATE TABLE "agenda_blocks" (
    "row_id" BIGSERIAL NOT NULL,
    "id" TEXT,
    "week" DATE NOT NULL,
    "professional_id" TEXT NOT NULL,
    "group_id" TEXT,
    "date" DATE,
    "from_hour" SMALLINT,
    "to_hour" SMALLINT,
    "reason" TEXT,
    "created_by" TEXT,
    "created_by_name" TEXT,
    "created_at" TIMESTAMPTZ(3),
    "pos" SMALLINT NOT NULL DEFAULT 0,
    "extra" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "agenda_blocks_pkey" PRIMARY KEY ("row_id"),
    CONSTRAINT "agenda_blocks_week_fkey" FOREIGN KEY ("week", "professional_id") REFERENCES "agenda_weeks"("week", "professional_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "agenda_blocks_idx" ON "agenda_blocks" ("professional_id", "date");

-- Registro mensual por profesional
CREATE TABLE "billing_months" (
    "professional_id" TEXT NOT NULL,
    "month" CHAR(7) NOT NULL,               -- 'YYYY-MM'
    "note" TEXT,
    "percent" NUMERIC,                      -- % que corresponde al profesional
    "billed_total" NUMERIC,
    "paid_total" NUMERIC,                   -- monto liquidado
    "category_prices" JSONB,                -- precio por sesión de cada categoría 1-4 en ese mes
    "updated_at" TIMESTAMPTZ(3),
    "extra" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "billing_months_pkey" PRIMARY KEY ("professional_id", "month")
);

CREATE TABLE "billing_patients" (
    "professional_id" TEXT NOT NULL,
    "month" CHAR(7) NOT NULL,
    "patient_id" TEXT NOT NULL,
    "category" SMALLINT,                    -- categoría de pago 1-4
    "has_amounts" BOOLEAN NOT NULL DEFAULT false,
    "billed" NUMERIC,                       -- facturado
    "paid" NUMERIC,                         -- liquidado
    "pos" SMALLINT NOT NULL DEFAULT 0,
    "extra" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "billing_patients_pkey" PRIMARY KEY ("professional_id", "month", "patient_id"),
    CONSTRAINT "billing_patients_month_fkey" FOREIGN KEY ("professional_id", "month") REFERENCES "billing_months"("professional_id", "month") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Noticias de la pantalla de inicio
CREATE TABLE "news" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "text" TEXT,
    "audience" JSONB,                       -- "all" o lista de ids de usuarios
    "from_date" DATE,
    "to_date" DATE,
    "pinned" BOOLEAN,
    "author_id" TEXT,
    "author_name" TEXT,
    "author_role" TEXT,
    "created_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3),
    "extra" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "news_pkey" PRIMARY KEY ("id")
);
