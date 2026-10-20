import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { createTempRepo, type TempRepo } from '@project-hub/test-utils';

// Fixtures dos testes de ponta a ponta (R188, R189). Cada teste recebe pastas descartáveis (dados do
// aplicativo e `userData` do Chromium) e abre o aplicativo construído em `out/`. Nada toca a pasta de
// dados verdadeira da pessoa.

/** Entrada do processo principal construído (`pnpm test:e2e` roda o `electron-vite build` antes). */
const MAIN_ENTRY = join(import.meta.dirname, '..', 'out', 'main', 'index.js');

/** Executável do Electron instalado no pacote: o `require('electron')` do Node devolve o caminho. */
function electronExecutable(): string {
  const path: unknown = createRequire(import.meta.url)('electron');
  if (typeof path !== 'string') {
    throw new Error('O pacote electron não devolveu o caminho do executável.');
  }
  return path;
}

/**
 * Variáveis do ambiente do teste que não podem vazar para o aplicativo: `ELECTRON_RUN_AS_NODE` faria o
 * executável rodar como Node puro (terminais de editores baseados em Electron a definem),
 * `ELECTRON_RENDERER_URL` faria a janela carregar um servidor de desenvolvimento e
 * `APP_WORKTREES_ROOT` tiraria os worktrees da pasta de dados descartável.
 */
const BLOCKED_ENV = ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'APP_WORKTREES_ROOT'];

export type LaunchedApp = {
  app: ElectronApplication;
  /** Janela principal, com a interface já montada. */
  page: Page;
  /** Fecha o aplicativo e espera o processo terminar. */
  close(): Promise<void>;
};

export type LaunchOptions = {
  /** Valor de `PROJECT_HUB_TEST_DIALOG_PATH`: a pasta que o seletor de pasta devolve. */
  dialogPath?: string;
};

type Fixtures = {
  /** `PROJECT_HUB_DATA_DIR`: banco e worktrees do aplicativo neste teste. */
  dataDir: string;
  /** Pasta de worktrees das missões, dentro da pasta de dados. */
  worktreesDir: string;
  /** Repositório Git com um commit em `main`, fora da pasta de dados. */
  gitRepo: TempRepo;
  /** Abre o aplicativo com a pasta de dados do teste. Pode ser chamada de novo para reiniciar. */
  launchApp: (options?: LaunchOptions) => Promise<LaunchedApp>;
};

function removeFolder(path: string): void {
  // No Windows, o SQLite e o Git podem segurar um arquivo por instantes depois que o processo sai.
  rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- o Playwright exige o primeiro argumento destruturado.
  dataDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'project-hub-e2e-'));
    try {
      await use(dir);
    } finally {
      removeFolder(dir);
    }
  },

  worktreesDir: async ({ dataDir }, use) => {
    await use(join(dataDir, 'worktrees'));
  },

  // eslint-disable-next-line no-empty-pattern -- o Playwright exige o primeiro argumento destruturado.
  gitRepo: async ({}, use) => {
    const repo = createTempRepo();
    try {
      await use(repo);
    } finally {
      repo.cleanup();
    }
  },

  launchApp: async ({ dataDir }, use) => {
    const launched: LaunchedApp[] = [];
    const userDataDir = join(dataDir, 'electron-user-data');

    async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
      const env: Record<string, string> = {};
      for (const [name, value] of Object.entries(process.env)) {
        if (value !== undefined && !BLOCKED_ENV.includes(name)) env[name] = value;
      }
      env['PROJECT_HUB_ENV'] = 'test';
      env['PROJECT_HUB_DATA_DIR'] = dataDir;
      delete env['PROJECT_HUB_TEST_DIALOG_PATH'];
      if (options.dialogPath !== undefined)
        env['PROJECT_HUB_TEST_DIALOG_PATH'] = options.dialogPath;

      const app = await electron.launch({
        executablePath: electronExecutable(),
        // O sandbox do renderer fica ligado, como no uso real: nenhum `--no-sandbox` aqui.
        args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
        env,
      });
      let closed = false;
      const close = async () => {
        if (closed) return;
        closed = true;
        await app.close();
      };
      const page = await app.firstWindow();
      await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();

      const handle = { app, page, close };
      launched.push(handle);
      return handle;
    }

    try {
      await use(launchApp);
    } finally {
      // Fecha o que o teste deixou aberto, para a pasta de dados poder ser apagada.
      for (const handle of launched) {
        await handle.close().catch(() => undefined);
      }
    }
  },
});

export { expect };
