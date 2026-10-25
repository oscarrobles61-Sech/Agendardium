-- Perfiles múltiples por usuario, nuevos perfiles profesionales y tipos de sesión.
-- No borra ni cambia datos existentes: cada usuario queda con un solo perfil, el que ya tenía.

-- Nuevos perfiles
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'administrador';
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'profesor_ef';            -- Profesor/a de Educación Física
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'fonoaudiologo';
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'terapista_ocupacional';

-- Un usuario puede tener varios perfiles (ej. kinesiólogo y administrador). "role" queda como perfil principal.
ALTER TABLE "users" ADD COLUMN "profiles" "user_role"[];
UPDATE "users" SET "profiles" = ARRAY["role"] WHERE "role" IS NOT NULL AND "profiles" IS NULL;

-- Tipo de sesión de cada tratamiento
ALTER TABLE "treatment_plans"
  ADD COLUMN "session_type" TEXT,          -- rehabilitacion | entrenamiento | practica
  ADD COLUMN "training_frequency" TEXT,    -- entrenamiento: 1, 2 o 3 veces por semana, o libre (pase libre)
  ADD COLUMN "practice" TEXT,              -- práctica diferenciada
  ADD CONSTRAINT "treatment_plans_session_type" CHECK ("session_type" IN ('rehabilitacion', 'entrenamiento', 'practica')),
  ADD CONSTRAINT "treatment_plans_training_frequency" CHECK ("training_frequency" IN ('1', '2', '3', 'libre')),
  ADD CONSTRAINT "treatment_plans_practice" CHECK ("practice" IN ('osteopatia', 'rpg', 'evaluacion_funcional', 'atm', 'nutricion', 'vestibular'));
