import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Testes de integração usam um banco separado (stockguard_test).
if (existsSync('.env.test')) process.loadEnvFile('.env.test');
// Limites altos para a suíte; o teste de rate limit cria uma instância com limites próprios.
process.env.RATE_LIMIT_MAX ??= '100000';
process.env.LOGIN_RATE_LIMIT_MAX ??= '100000';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/integration/global-setup.ts'],
          // Um único banco compartilhado: arquivos rodam em sequência.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
