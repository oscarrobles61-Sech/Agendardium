import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ path: ['.env.local', '.env'], quiet: true });

// Para migrar conviene la conexión directa de Neon (sin "-pooler"). Si no está, se usa DATABASE_URL.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || ''
  }
});
