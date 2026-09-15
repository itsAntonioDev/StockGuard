import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// O Prisma 7 não carrega .env automaticamente. Em produção as variáveis vêm do ambiente.
// Se a URL já veio do ambiente (ex.: testes com .env.test), o .env de desenvolvimento é ignorado.
if (!process.env.MIGRATION_DATABASE_URL && existsSync('.env')) process.loadEnvFile('.env');

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
