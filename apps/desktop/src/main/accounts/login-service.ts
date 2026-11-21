import { failure, type TerminalPort } from '@project-hub/application';
import type {
  AccountProviderId,
  AccountTargetInput,
  AppResult,
  LoginDto,
  LoginEvent,
  LoginPhase,
  LoginProblem,
} from '@project-hub/contracts';
import type { AppSettingsRepository } from '@project-hub/database';
import type { AccountCli } from './account-cli';
import type { AccountsService } from './accounts-service';
import { findLoginUrl } from './login-scan';

/** Chave de `app_settings` com o id do terminal do login aberto, para `recover` matá-lo se o app cair. */
export const LOGIN_TERMINAL_KEY = 'accounts.login.terminal';
const TERMINAL_PREFIX = 'login-';
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
/** Teto da saída guardada em memória, só para achar o endereço do login. */
const BUFFER_MAX = 64 * 1024;
const CLEAR_SCREEN = `${String.fromCharCode(27)}c`;
const NO_URL = 'O programa ainda não informou o endereço do login.';

export type LoginService = {
  start(input: AccountTargetInput): Promise<AppResult<LoginDto>>;
  get(): LoginDto | null;
  /** Encerra o login em curso. Depois de uma falha ou do prazo, só dispensa o aviso. */
  cancel(): Promise<void>;
  confirm(): Promise<void>;
  /** "Não é esta conta": sai dela pelo programa e recomeça o login. */
  reject(): Promise<void>;
  openUrl(): Promise<AppResult<undefined>>;
  copyUrl(): Promise<AppResult<undefined>>;
  write(data: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  /** Na abertura do app: mata o terminal de login que sobrou de uma execução anterior. */
  recover(): Promise<void>;
  dispose(): Promise<void>;
};

export type LoginServiceDeps = {
  port: Pick<TerminalPort, 'open' | 'write' | 'resize' | 'kill' | 'listen' | 'remove'>;
  cli: AccountCli;
  accounts: Pick<AccountsService, 'list'>;
  settings: AppSettingsRepository;
  publish: (event: LoginEvent) => void;
  openExternal: (url: string) => Promise<void>;
  writeClipboard: (text: string) => void;
  newId: () => string;
  now: () => number;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  cwd: string;
  timeoutMs?: number;
};

type Current = {
  provider: AccountProviderId;
  accountId: string | null;
  phase: LoginPhase;
  expiresAt: number;
  problem?: LoginProblem;
  identity?: string;
  duplicateOf?: string;
  terminalId?: string;
  unlisten?: () => void;
  timer?: unknown;
  /** Saída e endereço do login: só em memória, e só enquanto o programa está aberto. */
  buffer: string;
  /** O programa saiu antes de o terminal terminar de abrir: a conferência roda assim que ele abre. */
  exitedEarly?: boolean;
  url?: string;
};

const ACTIVE: readonly LoginPhase[] = ['starting', 'browser', 'verifying', 'confirm'];

export function createLoginService(deps: LoginServiceDeps): LoginService {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let current: Current | null = null;

  function toDto(login: Current): LoginDto {
    const host = login.url === undefined ? undefined : new URL(login.url).hostname;
    return {
      provider: login.provider,
      accountId: login.accountId,
      phase: login.phase,
      expiresAt: new Date(login.expiresAt).toISOString(),
      ...(host === undefined ? {} : { host }),
      ...(login.identity === undefined ? {} : { identity: login.identity }),
      ...(login.duplicateOf === undefined ? {} : { duplicateOf: login.duplicateOf }),
      ...(login.problem === undefined ? {} : { problem: login.problem }),
    };
  }

  function publishState(login: Current | null): void {
    deps.publish({ type: 'state', login: login === null ? null : toDto(login) });
  }

  /**
   * Encerra um terminal de login no processo de terminais: mata o processo (se pedido), manda esquecer a saída
   * guardada e só então apaga a anotação. A anotação fica até o fim para a próxima abertura do app (`recover`)
   * achar o terminal se o app fechar no meio. Um processo de terminais antigo, que não sabe esquecer, recusa o
   * pedido: a saída dele some quando ele encerrar.
   */
  async function discard(terminalId: string, kill: boolean): Promise<void> {
    if (kill) {
      try {
        await deps.port.kill(terminalId);
      } catch {
        // O processo já pode ter terminado.
      }
    }
    try {
      await deps.port.remove?.(terminalId);
    } catch {
      // Terminal que já não existe, ou processo de terminais sem o pedido.
    }
    // Um login novo pode ter começado enquanto este encerrava: a anotação dele não é apagada.
    if (deps.settings.get(LOGIN_TERMINAL_KEY) === terminalId) deps.settings.remove(LOGIN_TERMINAL_KEY);
  }

  /** Esquece o terminal do login: escuta, prazo, anotação, saída guardada e endereço. Mata o processo se pedido. */
  async function release(login: Current, kill: boolean): Promise<void> {
    const { terminalId } = login;
    login.unlisten?.();
    delete login.unlisten;
    if (login.timer !== undefined) deps.clearTimer(login.timer);
    delete login.timer;
    delete login.terminalId;
    login.buffer = '';
    delete login.url;
    if (terminalId !== undefined) await discard(terminalId, kill);
  }

  function fail(login: Current, problem: LoginProblem): void {
    login.phase = 'failed';
    login.problem = problem;
    publishState(login);
  }

  async function duplicateOf(login: Current, identity: string): Promise<string | undefined> {
    const listed = await deps.accounts.list();
    if (!listed.ok) return undefined;
    const group = listed.data.groups.find((item) => item.provider === login.provider);
    const wanted = identity.toLowerCase();
    return group?.accounts.find(
      (account) => account.id !== login.accountId && account.identity?.toLowerCase() === wanted,
    )?.name;
  }

  async function verify(login: Current): Promise<void> {
    login.phase = 'verifying';
    await release(login, false);
    if (current !== login) return;
    publishState(login);
    const status = await deps.cli.status(login.provider, login.accountId);
    if (current !== login) return;
    if (status.state !== 'connected') {
      fail(login, status.state === 'signed-out' ? 'not-connected' : 'status-failed');
      return;
    }
    if (status.identity !== undefined) {
      login.identity = status.identity;
      const other = await duplicateOf(login, status.identity);
      if (current !== login) return;
      if (other !== undefined) login.duplicateOf = other;
    }
    login.phase = 'confirm';
    publishState(login);
  }

  async function expire(login: Current): Promise<void> {
    if (current !== login || (login.phase !== 'starting' && login.phase !== 'browser')) return;
    login.phase = 'timed-out';
    await release(login, true);
    publishState(login);
  }

  /** Abre o programa no terminal do login. Devolve o estado em que o login ficou. */
  async function begin(input: AccountTargetInput): Promise<AppResult<LoginDto>> {
    const launch = deps.cli.loginLaunch(input.provider, input.accountId);
    if (!launch.ok && launch.error.code !== 'AGENT_UNAVAILABLE') {
      current = null;
      return launch;
    }
    const login: Current = {
      provider: input.provider,
      accountId: input.accountId,
      phase: 'starting',
      expiresAt: deps.now() + timeoutMs,
      buffer: '',
    };
    current = login;
    if (!launch.ok) {
      fail(login, 'not-installed');
      return { ok: true, data: toDto(login) };
    }
    publishState(login);

    // O processo de terminais entrega a saída guardada e o fim do programa antes de responder ao `listen`: os
    // ouvintes valem desde a abertura, e não só depois que a fase vira `browser`.
    const open = () =>
      current === login && (login.phase === 'starting' || login.phase === 'browser');
    const terminalId = `${TERMINAL_PREFIX}${deps.newId()}`;
    login.terminalId = terminalId;
    deps.settings.set(LOGIN_TERMINAL_KEY, terminalId, new Date(deps.now()).toISOString());
    try {
      await deps.port.open({
        id: terminalId,
        cwd: deps.cwd,
        command: launch.data.command,
        args: launch.data.args,
        env: launch.data.env,
        cols: 100,
        rows: 24,
      });
      login.unlisten = await deps.port.listen(terminalId, {
        onData(data) {
          if (!open()) return;
          deps.publish({ type: 'data', data });
          login.buffer = (login.buffer + data).slice(-BUFFER_MAX);
          const url = findLoginUrl(login.provider, login.buffer);
          if (url === login.url) return;
          const hostChanged =
            url === undefined ||
            login.url === undefined ||
            new URL(url).hostname !== new URL(login.url).hostname;
          if (url === undefined) delete login.url;
          else login.url = url;
          if (hostChanged) publishState(login);
        },
        onExit() {
          if (!open()) return;
          if (login.phase === 'starting') login.exitedEarly = true;
          else void verify(login);
        },
        onRestart() {
          if (!open()) return;
          // A saída guardada vem de novo: a tela e a memória recomeçam do zero.
          login.buffer = '';
          deps.publish({ type: 'data', data: CLEAR_SCREEN });
        },
      });
    } catch {
      if (current !== login) return { ok: true, data: toDto(login) };
      await release(login, true);
      fail(login, 'start-failed');
      return { ok: true, data: toDto(login) };
    }
    if (current !== login) {
      // Cancelado enquanto abria.
      await release(login, true);
      return { ok: true, data: toDto(login) };
    }
    login.phase = 'browser';
    login.timer = deps.setTimer(() => void expire(login), timeoutMs);
    publishState(login);
    const started = toDto(login);
    if (login.exitedEarly === true) void verify(login);
    return { ok: true, data: started };
  }

  function withUrl(
    use: (url: string) => void | Promise<void>,
  ): Promise<AppResult<undefined>> | AppResult<undefined> {
    const url = current?.phase === 'browser' ? current.url : undefined;
    if (url === undefined) return failure('VALIDATION_FAILED', NO_URL);
    return Promise.resolve(use(url)).then(
      () => ({ ok: true, data: undefined }) as const,
      () => failure('UNKNOWN', 'Não foi possível abrir o endereço do login.'),
    );
  }

  return {
    start(input) {
      if (current !== null && ACTIVE.includes(current.phase)) {
        return Promise.resolve(failure('VALIDATION_FAILED', 'Já há um login em andamento.'));
      }
      return begin(input);
    },

    get: () => (current === null ? null : toDto(current)),

    async cancel() {
      const login = current;
      if (login === null) return;
      current = null;
      // Na conferência o programa já gravou o login: `cancelled` faz a tela reler as contas.
      const active = ACTIVE.includes(login.phase);
      await release(login, true);
      if (active) {
        login.phase = 'cancelled';
        publishState(login);
      } else {
        publishState(null);
      }
    },

    confirm() {
      const login = current;
      if (login === null || login.phase !== 'confirm') return Promise.resolve();
      login.phase = 'done';
      current = null;
      publishState(login);
      return Promise.resolve();
    },

    async reject() {
      const login = current;
      if (login === null || login.phase !== 'confirm') return;
      // A conta errada sai pelo comando oficial; se a saída falhar, o novo login a substitui do mesmo jeito.
      await deps.cli.logout(login.provider, login.accountId);
      if (current !== login) return;
      await begin({ provider: login.provider, accountId: login.accountId });
    },

    openUrl: () => Promise.resolve(withUrl((url) => deps.openExternal(url))),
    copyUrl: () => Promise.resolve(withUrl((url) => deps.writeClipboard(url))),

    async write(data) {
      const id = current?.phase === 'browser' ? current.terminalId : undefined;
      if (id === undefined) return;
      try {
        await deps.port.write(id, data);
      } catch {
        // O processo pode ter acabado de terminar.
      }
    },

    async resize(cols, rows) {
      const id = current?.phase === 'browser' ? current.terminalId : undefined;
      if (id === undefined) return;
      try {
        await deps.port.resize(id, cols, rows);
      } catch {
        // O processo pode ter acabado de terminar.
      }
    },

    async recover() {
      const id = deps.settings.get(LOGIN_TERMINAL_KEY);
      if (id === undefined) return;
      if (!id.startsWith(TERMINAL_PREFIX)) {
        deps.settings.remove(LOGIN_TERMINAL_KEY);
        return;
      }
      await discard(id, true);
    },

    async dispose() {
      const login = current;
      current = null;
      if (login !== null) await release(login, true);
    },
  };
}
