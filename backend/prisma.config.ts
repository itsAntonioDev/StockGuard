import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// O Prisma 7 não carrega .env automaticamente. Em produção as variáveis vêm do ambiente.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Migrações rodam com o papel dono do schema; a API usa DATABASE_URL (papel restrito).
    url: process.env.MIGRATION_DATABASE_URL ?? '',
  },
});
