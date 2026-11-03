import { configDefaults, defineConfig } from 'vitest/config';
import PartesDaIntegracao from './vitest.partes-integracao.ts';

/**
 * Configuração base do Vitest.
 *
 * Convenção de nomes dos arquivos de teste:
 * - `*.test.ts`: testes unitários, sem recursos reais, no ambiente Node.
 * - `*.test.tsx`: testes do renderer (React). Ficam em `apps/desktop/test/renderer/` e rodam no
 *   projeto `renderer`, em jsdom. Fora dessa pasta nenhum projeto os roda.
 * - `*.integration.test.ts`: testes com recursos reais (Git ou SQLite).
 *
 * `pnpm test` roda todos os projetos abaixo, menos `integration`. `pnpm test:integration` roda só
 * ele. Cada arquivo roda em um projeto só: o `unit` deixa de fora o que o `renderer` já cobre.
 * Outro ambiente (com arquivo de setup, por exemplo) entra aqui como projeto novo, e `pnpm test` já
 * o inclui. Para trocar só o ambiente de um arquivo, use `// @vitest-environment jsdom` na primeira
 * linha dele.
 *
 * Esta configuração vale para a execução pela raiz. `pnpm --filter <pacote> test` roda o Vitest
 * dentro do pacote, com a configuração padrão do Vitest, e inclui os testes de integração dele. Por
 * isso ele não serve para os testes do renderer, que dependem do jsdom e do setup daqui.
 *
 * Testes de ponta a ponta do Playwright usam `*.spec.ts` e não entram aqui.
 */

// Saídas de build não têm testes: ficam fora de todos os projetos.
const buildOutputs = ['**/out/**', '**/dist/**'];

export default defineConfig({
  test: {
    // Sem arquivos de teste não é erro: os pacotes ainda estão chegando.
    passWithNoTests: true,
    // Divide a integração em partes equilibradas pelo tempo (ver `vitest.partes-integracao.ts`).
    sequence: { sequencer: PartesDaIntegracao },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['{apps,packages}/**/*.test.{ts,tsx}'],
          exclude: [
            ...configDefaults.exclude,
            ...buildOutputs,
            '**/*.integration.test.ts',
            // Estes rodam no projeto `renderer`, em jsdom.
            'apps/desktop/test/renderer/**',
            '**/*.test.tsx',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['apps/desktop/test/renderer/**/*.test.{ts,tsx}'],
          exclude: [...configDefaults.exclude, ...buildOutputs],
          // Registra os matchers do jest-dom (toBeInTheDocument e outros) e limpa o DOM entre testes.
          setupFiles: ['apps/desktop/test/renderer/setup.ts'],
          // Dois testes de tela com muitos elementos passavam de 5 s, o padrão, quando a pasta do projeto
          // (que fica no OneDrive) estava ocupada. 15 s dá folga sem esconder um travamento de verdade.
          testTimeout: 15_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['{apps,packages}/**/*.integration.test.ts'],
          exclude: [...configDefaults.exclude, ...buildOutputs],
          // Git e SQLite reais são mais lentos, principalmente no Windows.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
