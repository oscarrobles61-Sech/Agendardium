-- Tipos de sesión que admite cada franja horaria (rehabilitacion, entrenamiento, practica).
-- Vacío o NULL = la franja admite todos los tipos, así que los horarios ya cargados siguen igual.
ALTER TABLE "user_schedules" ADD COLUMN IF NOT EXISTS "session_types" TEXT[];
ALTER TABLE "user_schedules" ADD COLUMN IF NOT EXISTS "session_types2" TEXT[];
