import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

// Fixtures dos testes de ponta a ponta (R188, R189, R193). Cada teste recebe pastas descartáveis
// (dados do aplicativo e `userData` do Chromium), uma configuração do Git sem nada da máquina e abre
// o aplicativo construído em `out/`. Nada toca a pasta de dados verdadeira da pessoa.

/** Entrada do processo principal construído (`pnpm test:e2e` roda o `electron-vite build` antes). */
const MAIN_ENTRY = join(import.meta.dirname, '..', 'out', 'main', 'index.js');

/** Prazo para o aplicativo fechar sozinho. Passado ele, o processo é encerrado à força. */
const CLOSE_TIMEOUT_MS = 15_000;

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
  /** Fecha o aplicativo e espera o processo terminar (passado o prazo, encerra à força e avisa). */
  close(): Promise<void>;
};

/** Aplicativo aberto sem esperar janela nem interface: o teste decide o que esperar. */
export type LaunchedProcess = Omit<LaunchedApp, 'page'>;

export type LaunchOptions = {
  /** Valor de `PROJECT_HUB_TEST_DIALOG_PATH`: a pasta que o seletor de pasta devolve. */
  dialogPath?: string;
  /** Espera a interface ficar pronta. O padrão confere a navegação principal. */
  waitForReady?: (page: Page) => Promise<void>;
  /** Chamado assim que o processo abre, antes de qualquer espera. */
  onLaunch?: (app: ElectronApplication) => void;
  /** Prazo do fechamento deste app, em ms. O padrão é `CLOSE_TIMEOUT_MS`. */
  closeTimeoutMs?: number;
  /**
   * Endereço a passar em `ELECTRON_RENDERER_URL`, para a janela carregar um servidor (por exemplo um
   * que nunca responde). Sem esta opção a variável continua removida do ambiente do aplicativo.
   */
  rendererUrl?: string;
};

type Fixtures = {
  /** Interno: falhas de fechamento que o teste não viu e que reprovam o teste na limpeza. */
  closeFailures: unknown[];
  /** `PROJECT_HUB_DATA_DIR`: banco e worktrees do aplicativo neste teste. */
  dataDir: string;
  /** Pasta de worktrees das missões, dentro da pasta de dados. */
  worktreesDir: string;
  /**
   * Variáveis que isolam o Git da configuração global e da do sistema da máquina (o arquivo é vazio).
   * Valem para o aplicativo e para os comandos Git do teste.
   */
  gitEnv: Record<string, string>;
  /** Repositório Git com um commit na branch `main` (fixada pelo helper), fora da pasta de dados. */
  gitRepo: TempRepo;
  /** Abre o aplicativo com a pasta de dados do teste. Pode ser chamada de novo para reiniciar. */
  launchApp: (options?: LaunchOptions) => Promise<LaunchedApp>;
  /** Como `launchApp`, mas sem esperar janela nem interface (`waitForReady` não se aplica). */
  launchProcess: (options?: LaunchOptions) => Promise<LaunchedProcess>;
};

function removeFolder(path: string): void {
  // No Windows, o SQLite e o Git podem segurar um arquivo por instantes depois que o processo sai.
  rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

/** Roda `work` com as variáveis dadas no `process.env` e restaura os valores antigos no fim. */
function withEnvironment<T>(values: Record<string, string>, work: () => T): T {
  const previous = Object.keys(values).map((name) => [name, process.env[name]] as const);
  Object.assign(process.env, values);
  try {
    return work();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/**
 * Encerra o processo do aplicativo e os filhos dele (renderer, GPU, rede), que seguram arquivos da
 * pasta de dados enquanto vivem. No Windows, `taskkill /T` leva a árvore inteira.
 */
async function killProcessTree(app: ElectronApplication): Promise<void> {
  const child = app.process();
  if (child.pid !== undefined && process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // O processo já tinha terminado.
    }
  } else {
    child.kill('SIGKILL');
  }
  if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
}

/**
 * Fecha o aplicativo. Se ele não terminar no prazo, encerra a árvore de processos e avisa com erro:
 * um fechamento travado não prende o teardown do teste.
 */
async function closeApp(app: ElectronApplication, timeoutMs: number): Promise<void> {
  const closing = app.close();
  // Se o prazo vencer, o fim tardio (ou o erro) do fechamento não pode virar rejeição solta.
  closing.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<'expired'>((resolve) => {
    timer = setTimeout(() => resolve('expired'), timeoutMs);
  });
  try {
    const outcome = await Promise.race([closing.then(() => 'closed' as const), expired]);
    if (outcome === 'expired') {
      await killProcessTree(app);
      throw new Error(`O aplicativo não fechou em ${timeoutMs} ms; o processo foi encerrado.`);
    }
  } finally {
    clearTimeout(timer);
  }
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

  gitEnv: async ({ dataDir }, use) => {
    const emptyConfig = join(dataDir, 'git-config-vazio');
    writeFileSync(emptyConfig, '');
    await use({
      GIT_CONFIG_GLOBAL: emptyConfig,
      GIT_CONFIG_SYSTEM: emptyConfig,
      GIT_CONFIG_NOSYSTEM: '1',
    });
  },

  gitRepo: async ({ gitEnv }, use) => {
    // O helper fixa `--initial-branch=main` e grava identidade e opções no próprio repositório; o
    // ambiente sem configuração global garante que nada da máquina interfira nos comandos dele.
    const repo = withEnvironment(gitEnv, () => createTempRepo());
    try {
      await use(repo);
    } finally {
      repo.cleanup();
    }
  },

  // Falhas de fechamento que o teste não viu (limpeza, falha na espera). Um encerramento à força ou
  // um erro ao fechar não pode passar em silêncio: a lista é relançada depois da limpeza.
  // eslint-disable-next-line no-empty-pattern -- o Playwright exige o primeiro argumento destruturado.
  closeFailures: async ({}, use) => {
    const failures: unknown[] = [];
    await use(failures);
    if (failures.length > 0) {
      throw new AggregateError(failures, 'O fechamento do aplicativo falhou na limpeza do teste.');
    }
  },

  launchApp: async ({ launchProcess, closeFailures }, use) => {
    async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
      const launched = await launchProcess(options);
      try {
        const page = await launched.app.firstWindow();
        await (options.waitForReady ?? waitForNavigation)(page);
        return { ...launched, page };
      } catch (error) {
        // O processo não pode sobrar. O erro original explica a falha da espera e é o relançado; se o
        // fechamento também falhar, essa falha vai para a lista e reprova o teste na limpeza.
        await launched.close().catch((closeError: unknown) => closeFailures.push(closeError));
        throw error;
      }
    }
    await use(launchApp);
  },

  launchProcess: async ({ dataDir, gitEnv, closeFailures }, use) => {
    /** Um aplicativo aberto. `observed`: o teste chamou `close()` e viu o resultado. */
    type Handle = { closeOnce(): Promise<void>; observed: boolean };
    const opened: Handle[] = [];
    const userDataDir = join(dataDir, 'electron-user-data');

    async function launchProcess(options: LaunchOptions = {}): Promise<LaunchedProcess> {
      const env: Record<string, string> = {};
      for (const [name, value] of Object.entries(process.env)) {
        if (value !== undefined && !BLOCKED_ENV.includes(name)) env[name] = value;
      }
      Object.assign(env, gitEnv);
      env['PROJECT_HUB_ENV'] = 'test';
      env['PROJECT_HUB_DATA_DIR'] = dataDir;
      delete env['PROJECT_HUB_TEST_DIALOG_PATH'];
      if (options.dialogPath !== undefined)
        env['PROJECT_HUB_TEST_DIALOG_PATH'] = options.dialogPath;
      if (options.rendererUrl !== undefined) env['ELECTRON_RENDERER_URL'] = options.rendererUrl;

      const app = await electron.launch({
        executablePath: electronExecutable(),
        // O sandbox do renderer fica ligado, como no uso real: nenhum `--no-sandbox` aqui.
        args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
        env,
      });
      // O fechamento é registrado antes de qualquer espera: se a janela não aparecer ou a interface
      // não ficar pronta, o processo não sobra e a pasta de dados pode ser apagada.
      let closing: Promise<void> | undefined;
      const closeOnce = () =>
        (closing ??= closeApp(app, options.closeTimeoutMs ?? CLOSE_TIMEOUT_MS));
      const handle: Handle = { closeOnce, observed: false };
      opened.push(handle);
      // O fechamento chamado pelo teste devolve o resultado a ele, que o confere. Só o fechamento
      // feito pelo próprio fixture (limpeza) pode passar sem ninguém ver.
      const close = () => {
        handle.observed = true;
        return closeOnce();
      };

      try {
        options.onLaunch?.(app);
      } catch (error) {
        // A falha vai para a lista aqui; marcado como visto, a limpeza não a repete.
        handle.observed = true;
        await closeOnce().catch((closeError: unknown) => closeFailures.push(closeError));
        throw error;
      }
      return { app, close };
    }

    try {
      await use(launchProcess);
    } finally {
      // Fecha o que o teste deixou aberto, para a pasta de dados poder ser apagada.
      for (const handle of opened) {
        try {
          await handle.closeOnce();
        } catch (error) {
          if (!handle.observed) closeFailures.push(error);
        }
      }
    }
  },
});

async function waitForNavigation(page: Page): Promise<void> {
  await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
}

export { expect };
