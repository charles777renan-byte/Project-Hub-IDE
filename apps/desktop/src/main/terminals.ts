import {
  TerminalPortError,
  failure,
  type MissionRepository,
  type ProjectRepository,
  type TerminalPort,
} from '@project-hub/application';
import {
  providerIdSchema,
  type AppResult,
  type ProviderId,
  type TerminalEvent,
  type TerminalSummary,
  type UsageSummaryDto,
} from '@project-hub/contracts';
import type { TerminalSessionRepository } from '@project-hub/database';
import {
  claudeConfigDirOf,
  writeHookScript,
  writeSettingsFile,
  type ClaudeHooks,
  type HookEventName,
} from '@project-hub/agent-adapters';
import { buildTerminalEnv } from '../terminal-host/env';
import type { ProviderRegistry } from './providers';
import { createTerminalUsageService } from './terminal-usage';

/** Quanto tempo uma contagem de arquivos alterados vale. O Git roda por pasta, não a cada leitura da lista. */
const CHANGES_TTL_MS = 10_000;

/**
 * Hooks do painel do Claude Code: só o início e o fim da sessão, que apontam o transcript. Os outros
 * gravariam cada chamada de ferramenta no log, que o receptor relê inteiro a cada leitura.
 */
const PANEL_HOOK_EVENTS: readonly HookEventName[] = ['SessionStart', 'SessionEnd'];

export type TerminalServiceDeps = {
  port: TerminalPort;
  repo: Pick<MissionRepository, 'findExecutionsByStatus' | 'getMission'>;
  projects: Pick<ProjectRepository, 'get'>;
  /** Sessões de terminal gravadas no banco: é a fonte do que está aberto. */
  sessions: TerminalSessionRepository;
  providers: ProviderRegistry;
  /** Entrega um evento de terminal ao renderer. */
  publish: (event: TerminalEvent) => void;
  /** Arquivos com alteração numa pasta; `undefined` quando a pasta não é um repositório Git. */
  countChanges: (folder: string) => Promise<number | undefined>;
  env: NodeJS.ProcessEnv;
  newId: () => string;
  now: () => string;
  /** Receptor de hooks do processo de terminais: diz ao app qual transcript é de qual painel do Claude Code. */
  hooks: ClaudeHooks;
  /** Pasta do script de hook e dos arquivos de `--settings` (a mesma do adaptador da missão). */
  settingsDir: string;
};

/** Como abrir uma sessão fora do padrão: a pasta e os argumentos extras do programa. */
export type OpenSessionOptions = { cwd?: string; args?: readonly string[] };

/** O que a interface pede ao app. Só entram ids: o caminho e o comando saem do banco e do registro de provedores. */
export type TerminalService = {
  list(): Promise<AppResult<TerminalSummary[]>>;
  /**
   * Abre um terminal do provedor e grava a sessão. Sem `options`, o terminal abre na pasta do projeto. Com `cwd`, abre
   * nessa pasta; `args` vão depois dos argumentos do programa (é como a retomada entra). Provedor ausente:
   * PROCESS_START_FAILED com o motivo.
   */
  openSession(
    projectId: string,
    provider: ProviderId,
    options?: OpenSessionOptions,
  ): Promise<AppResult<{ terminalId: string }>>;
  /** Mata o processo (se ainda existir) e marca a sessão como fechada. Terminal de missão: VALIDATION_FAILED. */
  closeSession(terminalId: string): Promise<AppResult<undefined>>;
  /** Se o terminal é a sessão de uma missão em andamento (o agente), que só termina pela missão. */
  isMissionSession(terminalId: string): boolean;
  /** Ids de terminal do projeto: sessões abertas dele e terminais de missões em andamento dele. */
  knownIds(projectId: string): Promise<Set<string>>;
  /** 'running' (processo vivo), 'exited' (o processo de terminais conhece e acabou, ou ele não respondeu e a sessão está aberta no banco) ou 'unknown' (ele não conhece o id: a linha aberta do banco é fechada aqui). */
  stateOf(terminalId: string): Promise<'running' | 'exited' | 'unknown'>;
  write(terminalId: string, data: string): Promise<AppResult<undefined>>;
  resize(terminalId: string, cols: number, rows: number): Promise<AppResult<undefined>>;
  subscribe(terminalId: string): Promise<AppResult<undefined>>;
  unsubscribe(terminalId: string): Promise<AppResult<undefined>>;
};

const OK: AppResult<undefined> = { ok: true, data: undefined };
const UNKNOWN_TERMINAL = 'O terminal não foi encontrado.';

/** Último trecho do caminho do worktree, aceitando `\` e `/`. Só o nome sai do processo principal. */
function lastSegment(path: string | undefined): string | undefined {
  return path
    ?.split(/[\\/]+/)
    .filter((part) => part !== '')
    .pop();
}

export function createTerminalService(deps: TerminalServiceDeps): TerminalService {
  const { port, repo, projects, sessions, providers, publish } = deps;
  /** Sessões abertas por esta execução do app; as outras do banco foram herdadas e voltam como recuperadas. */
  const openedHere = new Set<string>();
  const unsubscribers = new Map<string, () => void>();
  /** A assinatura mais recente pedida por terminal: quem volta do `port.subscribe` com outra marca foi cancelado ou trocado. */
  const latestSubscription = new Map<string, number>();
  let subscriptionSeq = 0;
  /** Última contagem de arquivos alterados por pasta, com a hora (ms) em que foi lida. */
  const changes = new Map<string, { at: number; count: number | undefined }>();
  // A raiz dos transcripts sai do mesmo ambiente filtrado que o terminal recebe.
  const usage = createTerminalUsageService({
    hooks: deps.hooks,
    configDir: claudeConfigDirOf(buildTerminalEnv(deps.env)),
    now: () => Date.parse(deps.now()),
  });

  /** Execuções de agente em andamento que têm sessão: cada uma é um terminal. */
  function agentExecutions() {
    return [
      ...repo.findExecutionsByStatus('running'),
      ...repo.findExecutionsByStatus('paused'),
    ].filter((execution) => execution.agentSessionId !== undefined);
  }

  function isAgentTerminal(terminalId: string): boolean {
    return agentExecutions().some((e) => e.agentSessionId === terminalId);
  }

  /** A sessão do banco, só se ainda estiver aberta. */
  function openSessionRecord(terminalId: string) {
    const record = sessions.get(terminalId);
    return record !== undefined && record.closedAt === undefined ? record : undefined;
  }

  function isKnown(terminalId: string): boolean {
    return openSessionRecord(terminalId) !== undefined || isAgentTerminal(terminalId);
  }

  /** Roda a operação e converte o erro da porta em falha com código do contrato. */
  async function guarded<T>(work: () => Promise<AppResult<T>>): Promise<AppResult<T>> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof TerminalPortError) return failure(error.code, error.message);
      console.error('Falha inesperada no terminal:', error);
      return failure('UNKNOWN', 'Algo deu errado no terminal. Tente de novo.');
    }
  }

  function known<T>(terminalId: string, work: () => Promise<AppResult<T>>): Promise<AppResult<T>> {
    if (!isKnown(terminalId)) {
      return Promise.resolve(failure('TERMINAL_NOT_FOUND', UNKNOWN_TERMINAL));
    }
    return guarded(work);
  }

  function stopSubscription(terminalId: string): void {
    latestSubscription.delete(terminalId);
    unsubscribers.get(terminalId)?.();
    unsubscribers.delete(terminalId);
  }

  /**
   * Liga os hooks do painel do Claude Code: registra o terminal no receptor, grava o arquivo de `--settings`
   * e põe o endereço e o token no ambiente (o token nunca vai na linha de comando, que outros processos
   * leem). Qualquer falha abre o Claude como antes, sem número de tokens: o terminal vale mais que o número.
   */
  async function withUsageHooks(
    terminalId: string,
    launch: { args: readonly string[]; env: Record<string, string> },
  ): Promise<{ args: readonly string[]; env: Record<string, string>; hooked: boolean }> {
    let registered = false;
    try {
      const registration = await deps.hooks.registerExecution(terminalId);
      registered = true;
      const script = writeHookScript(deps.settingsDir);
      const settingsFile = writeSettingsFile(
        deps.settingsDir,
        terminalId,
        script,
        PANEL_HOOK_EVENTS,
      );
      return {
        args: ['--settings', settingsFile, ...launch.args],
        env: {
          ...launch.env,
          PROJECT_HUB_HOOK_URL: registration.url,
          PROJECT_HUB_HOOK_TOKEN: registration.token,
        },
        hooked: true,
      };
    } catch (error) {
      console.warn('Terminal do Claude Code aberto sem o gasto de tokens:', error);
      await releaseHooks(terminalId, registered);
      return { ...launch, hooked: false };
    }
  }

  /**
   * Solta o leitor de tokens e, se o terminal pode ter registro no receptor (`registered`: um painel do
   * Claude Code, inclusive o recuperado de outra execução do app), o registro também. Falha ao soltar não
   * impede de fechar.
   */
  async function releaseHooks(terminalId: string, registered: boolean): Promise<void> {
    usage.forget(terminalId);
    if (!registered) return;
    try {
      await deps.hooks.unregisterExecution(terminalId);
    } catch {
      // O processo de terminais pode já ter ido embora.
    }
  }

  /**
   * Consulta o processo de terminais. `'unavailable'`: ele não respondeu (não prova nada sobre a sessão).
   * `undefined`: ele respondeu e não conhece o id.
   */
  async function snapshotOf(terminalId: string) {
    try {
      return await port.snapshot(terminalId);
    } catch {
      return 'unavailable' as const;
    }
  }

  /** Arquivos alterados na pasta, lidos de novo quando a última contagem passou de `CHANGES_TTL_MS`. */
  async function changedFilesOf(folder: string | undefined): Promise<number | undefined> {
    if (folder === undefined) return undefined;
    const now = Date.parse(deps.now());
    const last = changes.get(folder);
    if (last !== undefined && now - last.at < CHANGES_TTL_MS) return last.count;
    const count = await deps.countChanges(folder);
    changes.set(folder, { at: now, count });
    return count;
  }

  /**
   * Gasto de tokens de um painel do Claude Code. O painel aberto por esta execução do app só é acompanhado
   * se os hooks ligaram. O recuperado (aberto antes de um reinício) passa a ser acompanhado aqui: se ele
   * nasceu com os hooks, o log em disco refaz o total; se nasceu antes deste recurso, o log está vazio e
   * não há número. A leitura nunca derruba a lista.
   */
  async function usageOfClaude(terminalId: string): Promise<UsageSummaryDto | undefined> {
    // A sessão pode ter sido fechada enquanto a lista era montada: aí o leitor não volta.
    if (openSessionRecord(terminalId) === undefined) return undefined;
    if (!openedHere.has(terminalId)) usage.track(terminalId);
    try {
      return await usage.usageOf(terminalId);
    } catch {
      return undefined;
    }
  }

  /**
   * Estado de uma sessão avulsa aberta no banco. Se o processo de terminais responde e não conhece o id
   * (reinício, reboot), a sessão não existe mais: a linha é fechada e o estado vira 'unknown'.
   */
  async function reconcile(
    terminalId: string,
  ): Promise<{ state: 'running' | 'exited' | 'unknown'; outputBytes?: number }> {
    const snapshot = await snapshotOf(terminalId);
    if (snapshot === 'unavailable') {
      return { state: openSessionRecord(terminalId) === undefined ? 'unknown' : 'exited' };
    }
    if (snapshot !== undefined) {
      return {
        state: snapshot.alive ? 'running' : 'exited',
        ...(snapshot.outputBytes === undefined ? {} : { outputBytes: snapshot.outputBytes }),
      };
    }
    const record = openSessionRecord(terminalId);
    if (record === undefined) return { state: 'unknown' };
    stopSubscription(terminalId);
    sessions.close(terminalId, deps.now());
    openedHere.delete(terminalId);
    await releaseHooks(terminalId, record.provider === 'claude');
    return { state: 'unknown' };
  }

  async function openSession(
    projectId: string,
    provider: ProviderId,
    options: OpenSessionOptions = {},
  ): Promise<AppResult<{ terminalId: string }>> {
    const target = projects.get(projectId);
    if (target === undefined) {
      return failure('PROJECT_NOT_FOUND', 'O projeto não foi encontrado.');
    }
    const resolution = providers.resolve(provider);
    if (!resolution.ok) return failure('PROCESS_START_FAILED', resolution.reason);

    const terminalId = deps.newId();
    const base = {
      // Os argumentos extras (a retomada) entram depois dos do programa, como o `.cmd` exige.
      args: [...resolution.launch.args, ...(options.args ?? [])],
      // COLORTERM fica fora da lista de permitidos (que protege segredos): o valor é fixo e nosso.
      env: buildTerminalEnv(deps.env, { COLORTERM: 'truecolor' }),
    };
    // Só o Claude Code informa o gasto de tokens; os outros programas e o shell abrem como estão.
    const launch =
      provider === 'claude' ? await withUsageHooks(terminalId, base) : { ...base, hooked: false };
    try {
      await port.open({
        id: terminalId,
        cwd: options.cwd ?? target.path,
        command: resolution.launch.command,
        args: launch.args,
        env: launch.env,
      });
    } catch (error) {
      await releaseHooks(terminalId, launch.hooked);
      throw error;
    }
    const label = providers.list().find((info) => info.id === provider)?.label ?? provider;
    try {
      sessions.insert({
        id: terminalId,
        projectId,
        provider,
        title: `${label} · ${target.name}`,
        createdAt: deps.now(),
      });
    } catch (error) {
      // Sem a linha, o processo ficaria órfão: nenhuma tela o listaria nem o fecharia.
      await port.kill(terminalId).catch(() => undefined);
      await releaseHooks(terminalId, launch.hooked);
      throw error;
    }
    openedHere.add(terminalId);
    if (launch.hooked) usage.track(terminalId);
    return { ok: true, data: { terminalId } };
  }

  async function closeSession(terminalId: string): Promise<AppResult<undefined>> {
    const record = openSessionRecord(terminalId);
    if (record === undefined) {
      return isAgentTerminal(terminalId)
        ? failure(
            'VALIDATION_FAILED',
            'Só uma sessão avulsa fecha por aqui. Para um agente, cancele a missão.',
          )
        : failure('TERMINAL_NOT_FOUND', UNKNOWN_TERMINAL);
    }
    stopSubscription(terminalId);
    try {
      await port.kill(terminalId);
    } catch (error) {
      // Processo que já não existe não impede de fechar a sessão; qualquer outra falha a mantém aberta.
      if (!(error instanceof TerminalPortError && error.code === 'TERMINAL_NOT_FOUND')) throw error;
    }
    sessions.close(terminalId, deps.now());
    openedHere.delete(terminalId);
    await releaseHooks(terminalId, record.provider === 'claude');
    return OK;
  }

  return {
    list() {
      return guarded(async () => {
        const out: TerminalSummary[] = [];
        for (const execution of agentExecutions()) {
          const mission = repo.getMission(execution.missionId);
          const project = mission === undefined ? undefined : projects.get(mission.projectId);
          if (mission === undefined || project === undefined) continue;
          if (execution.agentSessionId === undefined) continue;
          const worktreeName = lastSegment(mission.worktreePath);
          const live = await snapshotOf(execution.agentSessionId);
          const agentBytes =
            live === 'unavailable' || live === undefined ? undefined : live.outputBytes;
          const changedFiles = await changedFilesOf(mission.worktreePath);
          out.push({
            id: execution.agentSessionId,
            kind: 'agent',
            title: mission.title,
            projectId: project.id,
            projectName: project.name,
            missionId: mission.id,
            state:
              mission.status === 'waiting_input' || mission.status === 'waiting_approval'
                ? 'waiting'
                : 'running',
            provider: 'claude',
            origin: 'new',
            ...(worktreeName === undefined ? {} : { worktreeName }),
            ...(agentBytes === undefined ? {} : { outputBytes: agentBytes }),
            ...(changedFiles === undefined ? {} : { changedFiles }),
            // O gasto da tentativa em curso, que o orquestrador já grava: nada é contado de novo aqui.
            ...(execution.usage === undefined ? {} : { usage: execution.usage }),
          });
        }
        for (const record of sessions.listOpen()) {
          const provider = providerIdSchema.safeParse(record.provider);
          // Um provedor que esta versão não conhece não tem como ser aberto nem mostrado.
          if (!provider.success) continue;
          const { state, outputBytes } = await reconcile(record.id);
          // A sessão que o processo de terminais não conhece foi fechada agora: não é mais listada.
          if (state === 'unknown') continue;
          // O terminal avulso roda na pasta do projeto, então a contagem é a dela.
          const folder = projects.get(record.projectId);
          const changedFiles = await changedFilesOf(folder?.path);
          const tokens = provider.data === 'claude' ? await usageOfClaude(record.id) : undefined;
          out.push({
            id: record.id,
            kind: 'shell',
            title: record.title,
            projectId: record.projectId,
            projectName: folder?.name ?? '',
            state,
            provider: provider.data,
            origin: openedHere.has(record.id) ? 'new' : 'recovered',
            startedAt: record.createdAt,
            ...(outputBytes === undefined ? {} : { outputBytes }),
            ...(changedFiles === undefined ? {} : { changedFiles }),
            ...(tokens === undefined ? {} : { usage: tokens }),
          });
        }
        return { ok: true, data: out };
      });
    },

    openSession: (projectId, provider, options) =>
      guarded(() => openSession(projectId, provider, options)),

    closeSession: (terminalId) => guarded(() => closeSession(terminalId)),

    knownIds(projectId) {
      const ids = new Set<string>();
      for (const record of sessions.listOpen()) {
        if (record.projectId === projectId) ids.add(record.id);
      }
      for (const execution of agentExecutions()) {
        if (execution.agentSessionId === undefined) continue;
        if (repo.getMission(execution.missionId)?.projectId === projectId) {
          ids.add(execution.agentSessionId);
        }
      }
      return Promise.resolve(ids);
    },

    stateOf: async (terminalId) => (await reconcile(terminalId)).state,

    isMissionSession: (terminalId) => isAgentTerminal(terminalId),

    write: (terminalId, data) =>
      known(terminalId, async () => {
        await port.write(terminalId, data);
        return OK;
      }),

    resize: (terminalId, cols, rows) =>
      known(terminalId, async () => {
        await port.resize(terminalId, cols, rows);
        return OK;
      }),

    subscribe: (terminalId) =>
      known(terminalId, async () => {
        stopSubscription(terminalId);
        const mark = ++subscriptionSeq;
        latestSubscription.set(terminalId, mark);
        const stop = await port.subscribe(terminalId, {
          onData: (data) => publish({ type: 'data', terminalId, data }),
          onExit: (exit) => publish({ type: 'exit', terminalId, exitCode: exit.exitCode }),
          onRestart: () => publish({ type: 'restart', terminalId }),
        });
        if (latestSubscription.get(terminalId) !== mark) {
          // Cancelada (ou trocada) enquanto o processo de terminais respondia: soltar já, senão vaza.
          stop();
          return OK;
        }
        unsubscribers.set(terminalId, stop);
        return OK;
      }),

    unsubscribe: (terminalId) =>
      known(terminalId, () => {
        stopSubscription(terminalId);
        return Promise.resolve(OK);
      }),
  };
}
