-- Segunda franja horaria por día (ej. 8 a 12 y 17 a 20). Vacía = el día tiene una sola franja.
ALTER TABLE "user_schedules" ADD COLUMN IF NOT EXISTS "from_hour2" SMALLINT;
ALTER TABLE "user_schedules" ADD COLUMN IF NOT EXISTS "to_hour2" SMALLINT;
