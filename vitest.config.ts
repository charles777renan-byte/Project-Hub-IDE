import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Configuração base do Vitest.
 *
 * Convenção de nomes dos arquivos de teste:
 * - `*.test.ts` e `*.test.tsx`: testes unitários, sem recursos reais.
 * - `*.integration.test.ts`: testes com recursos reais (Git ou SQLite).
 *
 * `pnpm test` roda todos os projetos abaixo, menos `integration`. `pnpm test:integration` roda só
 * ele. Um ambiente diferente (por exemplo, jsdom com arquivo de setup) entra aqui como projeto
 * novo, e `pnpm test` já o inclui. Para trocar só o ambiente de um arquivo, use
 * `// @vitest-environment jsdom` na primeira linha dele.
 *
 * Esta configuração vale para a execução pela raiz. `pnpm --filter <pacote> test` roda o Vitest
 * dentro do pacote, com a configuração padrão do Vitest, e inclui os testes de integração dele.
 *
 * Testes de ponta a ponta do Playwright usam `*.spec.ts` e não entram aqui.
 */
export default defineConfig({
  test: {
    // Sem arquivos de teste não é erro: os pacotes ainda estão chegando.
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['{apps,packages}/**/*.test.{ts,tsx}'],
          exclude: [...configDefaults.exclude, '**/out/**', '**/*.integration.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['{apps,packages}/**/*.integration.test.ts'],
          exclude: [...configDefaults.exclude, '**/out/**'],
          // Git e SQLite reais são mais lentos, principalmente no Windows.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
