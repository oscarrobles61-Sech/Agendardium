-- Perfiles nuevos: nutricionista y psicólogo/a (cada uno con su propia agenda).
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'nutricionista';
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'psicologo';

-- Piso pélvico también se puede dar como práctica diferenciada.
ALTER TABLE "treatment_plans" DROP CONSTRAINT IF EXISTS "treatment_plans_practice";
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_practice"
  CHECK ("practice" IN ('osteopatia', 'rpg', 'evaluacion_funcional', 'atm', 'nutricion', 'vestibular', 'piso_pelvico'));

-- Especialidad del tratamiento (Miembro Superior, Gimnasio, Osteopatía, ...) y, en entrenamiento,
-- hasta qué fecha (sin incluir) cubre el mes cargado.
ALTER TABLE "treatment_plans" ADD COLUMN IF NOT EXISTS "specialty" TEXT;
ALTER TABLE "treatment_plans" ADD COLUMN IF NOT EXISTS "until_date" DATE;
