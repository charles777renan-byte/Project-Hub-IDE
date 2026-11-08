import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { createTempRepo, type TempRepo } from '@project-hub/test-utils';
import { E2E_HOOK_KEY, installTerminalHook } from './terminals';

// Fixtures dos testes de ponta a ponta (R188, R189, R193). Cada teste recebe pastas descartáveis
// (dados do aplicativo e `userData` do Chromium), uma configuração do Git sem nada da máquina e abre
// o aplicativo construído em `out/`. Nada toca a pasta de dados verdadeira da pessoa.

/** Entrada do processo principal construído (`pnpm test:e2e` roda o `electron-vite build` antes). */
const MAIN_ENTRY = join(import.meta.dirname, '..', 'out', 'main', 'index.js');

/**
 * O `gh` falso (o mesmo dos testes do adaptador): um script Node que grava o argv e responde por cenário. O app só
 * o usa com `PROJECT_HUB_ENV=test`, e é o único `gh` que um teste de ponta a ponta executa: nunca o real.
 */
export const FAKE_GH = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'github-adapter',
  'test',
  'fixtures',
  'fake-gh.mjs',
);

/** Variáveis do `gh` falso que não podem vir da máquina de quem roda: só as opções do teste as definem. */
const GH_ENV = ['PROJECT_HUB_GH_BIN', 'FAKE_GH_SCENARIO', 'FAKE_GH_LOG', 'FAKE_GH_HEAD'];

/**
 * O PATH sem as pastas que têm um `gh` (o real), para o teste "sem GitHub CLI"; o Git continua achável.
 *
 * Limite conhecido: se o `gh` e o `git` ficam na mesma pasta, ela sai do PATH junto, o app não acha o Git e o teste
 * de "sem gh" falha por um motivo que não é o do teste. Nesse caso, aponte o Git explicitamente (por exemplo,
 * acrescentando ao PATH uma pasta de teste com só o `git`) em vez de mexer na lógica abaixo.
 */
function pathWithoutGh(path: string): string {
  const names = ['gh', 'gh.exe', 'gh.cmd', 'gh.bat'];
  return path
    .split(delimiter)
    .filter((folder) => folder !== '' && !names.some((name) => existsSync(join(folder, name))))
    .join(delimiter);
}

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
  /**
   * Caminho de um `.mjs` que faz o papel do `claude -p` no planejador (`APP_PLANNER_SCRIPT`). Sem esta opção
   * o planejador não é ligado: o plano sai com um passo por critério de aceite.
   */
  plannerScript?: string;
  /**
   * Caminho de um `.mjs` que faz o papel do `claude` interativo nas missões (`APP_AGENT_SCRIPT`). Com ele, o
   * agente das missões é o Claude Code real do app (terminal, hooks, transcripts), só que com o CLI falso, e o
   * `CLAUDE_CONFIG_DIR` do terminal aponta para `claudeConfigDir`, dentro da pasta de dados do teste. Sem esta
   * opção, o agente é o de demonstração e nenhuma variável do agente vem da máquina de quem roda.
   */
  agentScript?: string;
  /**
   * Caminho de um `.mjs` que faz o papel do `claude -p` na leitura dos limites da assinatura
   * (`APP_LIMITS_SCRIPT`). Sem esta opção a leitura fica desligada no app de teste: cada leitura real gasta
   * a cota da assinatura de quem roda a suíte, então nada a liga por acidente.
   */
  limitsScript?: string;
  /**
   * O que o `gh` falso responde (`FAKE_GH_SCENARIO`; veja `fake-gh.mjs`). O padrão é `no-pr`: nenhum teste executa o
   * `gh` real, e a aba Checks de um projeto do github.com mostra "sem PR". Cada chamada fica gravada em `ghLog`.
   */
  ghScenario?: string;
  /** A branch do PR dos cenários `open-*` do `gh` falso (`FAKE_GH_HEAD`): a branch do repositório do teste. */
  ghHead?: string;
  /**
   * Sem GitHub CLI: o `gh` falso não é ligado e as pastas do PATH que têm um `gh` saem dele, então o app não acha o
   * executável. O Git continua no PATH.
   */
  ghMissing?: boolean;
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
  /**
   * Instala o gancho que deixa os testes lerem o buffer do terminal (ver terminals.ts). O padrão é instalar:
   * o terminal usa WebGL e não tem texto no DOM. `false` deixa o app como o da pessoa, sem gancho, e serve
   * ao teste que prova que nada fica exposto sem ele.
   */
  terminalHook?: boolean;
  /**
   * Tamanho da janela logo depois de abrir (`launchApp`). O padrão é `WINDOW_SIZE`, grande o bastante para a
   * grade responsiva caber com a barra lateral e o painel direito abertos: na janela padrão do app (1200 x 800)
   * a área do workspace fica abaixo de 720 px e o modo Abas liga sozinho. `false` deixa a janela como o app a abre;
   * os testes que dimensionam a janela por conta própria (capturas, janela estreita) continuam fazendo isso depois.
   */
  windowSize?: { width: number; height: number } | false;
};

/** Tamanho da janela dos testes: mede-se `.workspace__area` com as laterais abertas, e ela passa de 720 px com folga. */
export const WINDOW_SIZE = { width: 1600, height: 900 } as const;

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
  /** Pasta de dados do Claude Code (`CLAUDE_CONFIG_DIR`) que o CLI falso usa, dentro da pasta de dados do teste. */
  claudeConfigDir: string;
  /** Pasta do Codex (`PROJECT_HUB_CODEX_HOME`) que o bloco "Visão geral" lê, dentro da pasta de dados do teste. */
  codexHome: string;
  /** Histórico do Antigravity CLI (`PROJECT_HUB_AGY_HISTORY`) que o bloco "Visão geral" lê, dentro da pasta de dados. */
  antigravityHistory: string;
  /** Arquivo onde o `gh` falso grava cada chamada (uma linha de JSON por chamada: `{ argv, cwd, env }`), na pasta de dados. */
  ghLog: string;
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

  claudeConfigDir: async ({ dataDir }, use) => {
    // Nunca o `~/.claude` da pessoa: o CLI falso grava transcripts, e o app os lê, só aqui.
    await use(join(dataDir, 'claude-config'));
  },

  codexHome: async ({ dataDir }, use) => {
    // Nunca o `~/.codex` da pessoa: o app só lê as sessões do Codex que o teste escrever aqui.
    await use(join(dataDir, 'codex-home'));
  },

  antigravityHistory: async ({ dataDir }, use) => {
    // Nunca o `~/.gemini` da pessoa: o app só lê o histórico do Antigravity que o teste escrever aqui.
    await use(join(dataDir, 'antigravity', 'history.jsonl'));
  },

  ghLog: async ({ dataDir }, use) => {
    await use(join(dataDir, 'gh-chamadas.jsonl'));
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

  // `gitRepo` entra aqui só para ficar montado antes do app: o Playwright desmonta na ordem inversa, então a
  // pasta do repositório só é apagada depois que o app fecha. Sem isso, um teste que pede `launchApp` antes de
  // `gitRepo` tenta apagar a pasta com o app ainda aberto, e a remoção falha com EPERM no Windows.
  launchApp: async ({ gitRepo, launchProcess, closeFailures }, use) => {
    void gitRepo;
    async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
      const launched = await launchProcess(options);
      try {
        const page = await launched.app.firstWindow();
        const size = options.windowSize ?? WINDOW_SIZE;
        if (size !== false) {
          await launched.app.evaluate(({ BrowserWindow }, wanted) => {
            BrowserWindow.getAllWindows()[0]?.setSize(wanted.width, wanted.height);
          }, size);
        }
        // A janela pode ter carregado antes do script de inicialização do contexto valer: o gancho
        // também entra na página que já está aberta (só cria se ainda não existir). Nenhum terminal monta
        // antes da interface ficar pronta, então nenhum fica de fora.
        if (options.terminalHook !== false) await page.evaluate(installTerminalHook, E2E_HOOK_KEY);
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

  launchProcess: async (
    { dataDir, gitEnv, ghLog, claudeConfigDir, codexHome, antigravityHistory, closeFailures },
    use,
  ) => {
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
      // A janela do app fica invisível e sem receber o mouse, para a rodada não abrir janelas na frente de
      // quem a roda. `E2E_VISIVEL=1` a mostra, para acompanhar um teste a olho.
      env['PROJECT_HUB_E2E_HIDDEN'] = process.env['E2E_VISIVEL'] === '1' ? '0' : '1';
      env['PROJECT_HUB_DATA_DIR'] = dataDir;
      delete env['PROJECT_HUB_TEST_DIALOG_PATH'];
      if (options.dialogPath !== undefined)
        env['PROJECT_HUB_TEST_DIALOG_PATH'] = options.dialogPath;
      // Nenhum gancho do planejador vem da máquina de quem roda: só a opção do teste liga o CLI falso.
      delete env['APP_PLANNER_COMMAND'];
      delete env['APP_PLANNER_SCRIPT'];
      if (options.plannerScript !== undefined) env['APP_PLANNER_SCRIPT'] = options.plannerScript;
      // Nenhuma escolha de agente vem da máquina de quem roda: só a opção do teste liga o CLI falso, e o
      // `CLAUDE_CONFIG_DIR` da máquina nunca chega ao terminal dele.
      delete env['APP_AGENT_SCRIPT'];
      delete env['APP_AGENT_ADAPTER'];
      if (options.agentScript !== undefined) {
        env['APP_AGENT_SCRIPT'] = options.agentScript;
        env['CLAUDE_CONFIG_DIR'] = claudeConfigDir;
      }
      // Nenhum gancho dos limites vem da máquina de quem roda: só a opção do teste liga o CLI falso.
      delete env['APP_LIMITS_SCRIPT'];
      if (options.limitsScript !== undefined) env['APP_LIMITS_SCRIPT'] = options.limitsScript;
      if (options.rendererUrl !== undefined) env['ELECTRON_RENDERER_URL'] = options.rendererUrl;
      // O bloco "Visão geral" do Início lê as sessões dos CLIs. As três pastas vêm sempre da pasta de dados do
      // teste (o app só as aceita com `PROJECT_HUB_ENV=test`), e nenhuma delas é a da pessoa.
      env['PROJECT_HUB_CLAUDE_DIR'] = claudeConfigDir;
      env['PROJECT_HUB_CODEX_HOME'] = codexHome;
      env['PROJECT_HUB_AGY_HISTORY'] = antigravityHistory;
      // O `gh` é sempre o falso (o app só aceita `PROJECT_HUB_GH_BIN` com `PROJECT_HUB_ENV=test`, definido acima).
      // Nada do `gh` vem da máquina de quem roda; sem `ghMissing`, o falso responde o cenário pedido.
      // Sem diferenciar maiúsculas (no Windows `gh_token` vale como `GH_TOKEN`), como o `ghEnvironment` do adaptador.
      for (const name of Object.keys(env)) {
        if (GH_ENV.includes(name.toUpperCase())) delete env[name];
      }
      if (options.ghMissing === true) {
        // Sem `gh`, nenhuma credencial nem configuração do `gh` da máquina deve ficar ao alcance do app.
        for (const name of Object.keys(env)) {
          if (['GH_TOKEN', 'GITHUB_TOKEN', 'GH_CONFIG_DIR'].includes(name.toUpperCase())) {
            delete env[name];
          }
        }
        const emptyGhConfig = join(dataDir, 'gh-config-vazio');
        mkdirSync(emptyGhConfig, { recursive: true });
        env['GH_CONFIG_DIR'] = emptyGhConfig;
        const pathName = Object.keys(env).find((name) => name.toUpperCase() === 'PATH');
        if (pathName !== undefined) env[pathName] = pathWithoutGh(env[pathName] ?? '');
      } else {
        env['PROJECT_HUB_GH_BIN'] = FAKE_GH;
        env['FAKE_GH_SCENARIO'] = options.ghScenario ?? 'no-pr';
        env['FAKE_GH_LOG'] = ghLog;
        if (options.ghHead !== undefined) env['FAKE_GH_HEAD'] = options.ghHead;
      }

      const app = await electron.launch({
        executablePath: electronExecutable(),
        // O sandbox do renderer fica ligado, como no uso real: nenhum `--no-sandbox` aqui.
        args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
        env,
      });
      // O gancho vai como script de inicialização do contexto: roda antes dos scripts da janela, também
      // depois de recarregar. O app nunca o cria; só o Playwright.
      if (options.terminalHook !== false) {
        await app.context().addInitScript(installTerminalHook, E2E_HOOK_KEY);
      }
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

/**
 * A interface está pronta quando a aba fixa Início (na barra superior), a barra lateral e a barra de status
 * estão na tela. Não há mais uma navegação "Principal": o Início é a primeira aba da barra superior.
 */
async function waitForNavigation(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: 'Início', exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Projetos e missões' })).toBeVisible();
  await expect(page.getByRole('contentinfo', { name: 'Barra de status' })).toBeVisible();
}

export { expect };
