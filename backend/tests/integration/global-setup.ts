import { execSync } from 'node:child_process';

/** Banco local stockguard_test ou schema stockguard_test (Supabase). */
export function isTestDatabase(): boolean {
  const { DATABASE_URL = '', MIGRATION_DATABASE_URL = '', DATABASE_SCHEMA } = process.env;
  const dedicatedDatabase = DATABASE_URL.includes('/stockguard_test') && MIGRATION_DATABASE_URL.includes('/stockguard_test');
  return dedicatedDatabase || DATABASE_SCHEMA === 'stockguard_test';
}

/**
 * Aplica as migrações no banco de TESTE antes da suíte.
 * Trava de segurança: os testes limpam tabelas, então só rodam contra stockguard_test.
 */
export default function setup() {
  const { DATABASE_URL, MIGRATION_DATABASE_URL } = process.env;
  if (!DATABASE_URL || !MIGRATION_DATABASE_URL) {
    throw new Error('Banco de teste não configurado. Rode backend/scripts/setup-database.ps1 para gerar backend/.env.test.');
  }
  if (!isTestDatabase()) {
    throw new Error('Por segurança, os testes de integração só executam contra o banco ou schema stockguard_test.');
  }
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
}
