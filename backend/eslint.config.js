import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist/**', 'src/generated/**', 'coverage/**', 'storage/**']),
  js.configs.recommended,
  tseslint.configs.recommended,
  security.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      // Falso positivo em todo acesso obj[chave] tipado; entradas externas já passam por Zod.
      'security/detect-object-injection': 'off',
      // SQL sempre parametrizado: proíbe as variantes "Unsafe" do Prisma no código da API.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name=/^\\$(queryRawUnsafe|executeRawUnsafe)$/]',
          message: 'Use $queryRaw/$executeRaw com template literal (consulta parametrizada).',
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
]);
