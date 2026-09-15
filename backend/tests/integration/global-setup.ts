import { execSync } from 'node:child_process';

/**
 * Aplica as migrações no banco de TESTE antes da suíte.
 * Trava de segurança: os testes limpam tabelas, então só rodam contra stockguard_test.
 */
export default function setup() {
  const { DATABASE_URL, MIGRATION_DATABASE_URL } = process.env;
  if (!DATABASE_URL || !MIGRATION_DATABASE_URL) {
    throw new Error('Banco de teste não configurado. Rode backend/scripts/setup-database.ps1 para gerar backend/.env.test.');
  }
  if (!DATABASE_URL.includes('/stockguard_test') || !MIGRATION_DATABASE_URL.includes('/stockguard_test')) {
    throw new Error('Por segurança, os testes de integração só executam contra o banco stockguard_test.');
  }
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
}
