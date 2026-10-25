-- Migración inicial. Usa IF NOT EXISTS para que también sirva en bases donde
-- la versión anterior de la app ya había creado estas tablas.

-- CreateTable
CREATE TABLE IF NOT EXISTS "docs" (
    "col" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "docs_pkey" PRIMARY KEY ("col","id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "doc_versions" (
    "col" TEXT NOT NULL,
    "v" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "doc_versions_pkey" PRIMARY KEY ("col")
);

-- Índice para buscar la agenda por semana (Prisma no puede expresarlo en el schema).
CREATE INDEX IF NOT EXISTS "docs_agenda_week" ON "docs" (("data"->>'week')) WHERE "col" = 'agenda';
