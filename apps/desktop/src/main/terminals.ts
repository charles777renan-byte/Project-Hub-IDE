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
} from '@project-hub/contracts';
import type { TerminalSessionRepository } from '@project-hub/database';
import { buildTerminalEnv } from '../terminal-host/env';
import type { ProviderRegistry } from './providers';

export type TerminalServiceDeps = {
  port: TerminalPort;
  repo: Pick<MissionRepository, 'findExecutionsByStatus' | 'getMission'>;
  projects: Pick<ProjectRepository, 'get'>;
  /** Sessões de terminal gravadas no banco: é a fonte do que está aberto. */
  sessions: TerminalSessionRepository;
  providers: ProviderRegistry;
  /** Entrega um evento de terminal ao renderer. */
  publish: (event: TerminalEvent) => void;
  env: NodeJS.ProcessEnv;
  newId: () => string;
  now: () => string;
};

/** O que a interface pede ao app. Só entram ids: o caminho e o comando saem do banco e do registro de provedores. */
export type TerminalService = {
  list(): Promise<AppResult<TerminalSummary[]>>;
  /** Abre um terminal do provedor na pasta do projeto e grava a sessão. Provedor ausente: PROCESS_START_FAILED com o motivo. */
  openSession(projectId: string, provider: ProviderId): Promise<AppResult<{ terminalId: string }>>;
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

  /**
   * Estado de uma sessão avulsa aberta no banco. Se o processo de terminais responde e não conhece o id
   * (reinício, reboot), a sessão não existe mais: a linha é fechada e o estado vira 'unknown'.
   */
  async function reconcile(terminalId: string): Promise<'running' | 'exited' | 'unknown'> {
    const snapshot = await snapshotOf(terminalId);
    if (snapshot === 'unavailable')
      return openSessionRecord(terminalId) === undefined ? 'unknown' : 'exited';
    if (snapshot !== undefined) return snapshot.alive ? 'running' : 'exited';
    if (openSessionRecord(terminalId) === undefined) return 'unknown';
    stopSubscription(terminalId);
    sessions.close(terminalId, deps.now());
    openedHere.delete(terminalId);
    return 'unknown';
  }

  async function openSession(
    projectId: string,
    provider: ProviderId,
  ): Promise<AppResult<{ terminalId: string }>> {
    const target = projects.get(projectId);
    if (target === undefined) {
      return failure('PROJECT_NOT_FOUND', 'O projeto não foi encontrado.');
    }
    const resolution = providers.resolve(provider);
    if (!resolution.ok) return failure('PROCESS_START_FAILED', resolution.reason);

    const terminalId = deps.newId();
    await port.open({
      id: terminalId,
      cwd: target.path,
      command: resolution.launch.command,
      args: resolution.launch.args,
      // COLORTERM fica fora da lista de permitidos (que protege segredos): o valor é fixo e nosso.
      env: buildTerminalEnv(deps.env, { COLORTERM: 'truecolor' }),
    });
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
      throw error;
    }
    openedHere.add(terminalId);
    return { ok: true, data: { terminalId } };
  }

  async function closeSession(terminalId: string): Promise<AppResult<undefined>> {
    if (openSessionRecord(terminalId) === undefined) {
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
          });
        }
        for (const record of sessions.listOpen()) {
          const provider = providerIdSchema.safeParse(record.provider);
          // Um provedor que esta versão não conhece não tem como ser aberto nem mostrado.
          if (!provider.success) continue;
          const state = await reconcile(record.id);
          // A sessão que o processo de terminais não conhece foi fechada agora: não é mais listada.
          if (state === 'unknown') continue;
          out.push({
            id: record.id,
            kind: 'shell',
            title: record.title,
            projectId: record.projectId,
            projectName: projects.get(record.projectId)?.name ?? '',
            state,
            provider: provider.data,
            origin: openedHere.has(record.id) ? 'new' : 'recovered',
            startedAt: record.createdAt,
          });
        }
        return { ok: true, data: out };
      });
    },

    openSession: (projectId, provider) => guarded(() => openSession(projectId, provider)),

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

    stateOf: (terminalId) => reconcile(terminalId),

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
