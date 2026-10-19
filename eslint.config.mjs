import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/node_modules/', '**/dist/', '**/out/', '**/coverage/', '.superpowers/']),

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      // Prefixo _ marca parâmetros e variáveis ignorados de propósito.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  {
    // Seção 8.3: os pacotes de packages/ não importam Electron.
    files: ['packages/**/*.{ts,tsx,mts,cts}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron', 'electron/*'],
              message: 'Pacotes em packages/ não importam Electron (seção 8.3 do planejamento).',
            },
          ],
        },
      ],
    },
  },

  // Deve vir por último: desliga regras de estilo que conflitam com o Prettier.
  prettier,
]);
