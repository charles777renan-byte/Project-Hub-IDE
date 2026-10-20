import { defineConfig } from '@playwright/test';

/**
 * Testes de ponta a ponta do desktop (R188). O Playwright abre o aplicativo construído em `out/`
 * pela API `_electron`, sem baixar navegador. `pnpm test:e2e` constrói e roda; o Vitest e o CI da
 * Tarefa 12 não rodam esta pasta. Os testes são `*.spec.ts` em `e2e/`.
 *
 * Um teste por vez: cada um abre o Electron com a própria pasta de dados, e o fluxo vertical grava
 * Git e SQLite de verdade. Sem repetição automática, porque uma falha intermitente é um defeito a
 * investigar, não algo a esconder.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  // `out/` já está no .gitignore, e o ESLint e o Prettier o ignoram.
  outputDir: './out/e2e-results',
});
