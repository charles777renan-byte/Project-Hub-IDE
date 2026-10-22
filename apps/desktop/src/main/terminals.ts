import {
  TerminalPortError,
  failure,
  type MissionRepository,
  type ProjectRepository,
  type TerminalPort,
} from '@project-hub/application';
import type { AppResult, TerminalEvent, TerminalSummary } from '@project-hub/contracts';
import { buildTerminalEnv } from '../terminal-host/env';

export type TerminalServiceDeps = {
  port: TerminalPort;
  repo: Pick<MissionRepository, 'findExecutionsByStatus' | 'getMission'>;
  projects: Pick<ProjectRepository, 'get'>;
  /** Entrega um evento de terminal ao renderer. */
  publish: (event: TerminalEvent) => void;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  newId: () => string;
};

/** O que a página Terminais pede ao app. Só entram ids: o caminho e o comando saem do banco e daqui. */
export type TerminalService = {
  list(): Promise<AppResult<TerminalSummary[]>>;
  openShell(projectId: string): Promise<AppResult<{ terminalId: string }>>;
  write(terminalId: string, data: string): Promise<AppResult<undefined>>;
  resize(terminalId: string, cols: number, rows: number): Promise<AppResult<undefined>>;
  subscribe(terminalId: string): Promise<AppResult<undefined>>;
  unsubscribe(terminalId: string): Promise<AppResult<undefined>>;
  close(terminalId: string): Promise<AppResult<undefined>>;
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
  const { port, repo, projects, publish } = deps;
  /** Shells abertos por esta janela, com o projeto de cada um. */
  const shells = new Map<string, { projectId: string }>();
  const unsubscribers = new Map<string, () => void>();

  /** Execuções de agente em andamento que têm sessão: cada uma é um terminal. */
  function agentExecutions() {
    return [
      ...repo.findExecutionsByStatus('running'),
      ...repo.findExecutionsByStatus('paused'),
    ].filter((execution) => execution.agentSessionId !== undefined);
  }

  function isKnown(terminalId: string): boolean {
    return shells.has(terminalId) || agentExecutions().some((e) => e.agentSessionId === terminalId);
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
    unsubscribers.get(terminalId)?.();
    unsubscribers.delete(terminalId);
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
            // Valores fixos por enquanto; a Tarefa 4 passa a ler o provedor e a origem reais.
            provider: 'claude',
            origin: 'new',
            ...(worktreeName === undefined ? {} : { worktreeName }),
          });
        }
        for (const [id, shell] of shells) {
          const project = projects.get(shell.projectId);
          const snapshot = await port.snapshot(id).catch(() => undefined);
          out.push({
            id,
            kind: 'shell',
            title: `Shell · ${project?.name ?? 'projeto'}`,
            projectId: shell.projectId,
            projectName: project?.name ?? '',
            state: snapshot?.alive === true ? 'running' : 'exited',
            provider: 'shell',
            origin: 'new',
          });
        }
        return { ok: true, data: out };
      });
    },

    openShell(projectId) {
      return guarded(async () => {
        const project = projects.get(projectId);
        if (project === undefined) {
          return failure('PROJECT_NOT_FOUND', 'O projeto não foi encontrado.');
        }
        const terminalId = deps.newId();
        const windows = deps.platform === 'win32';
        await port.open({
          id: terminalId,
          cwd: project.path,
          command: windows ? 'powershell.exe' : (deps.env['SHELL'] ?? '/bin/bash'),
          args: windows ? ['-NoLogo'] : [],
          env: buildTerminalEnv(deps.env),
        });
        shells.set(terminalId, { projectId });
        return { ok: true, data: { terminalId } };
      });
    },

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
        const stop = await port.subscribe(terminalId, {
          onData: (data) => publish({ type: 'data', terminalId, data }),
          onExit: (exit) => publish({ type: 'exit', terminalId, exitCode: exit.exitCode }),
          onRestart: () => publish({ type: 'restart', terminalId }),
        });
        unsubscribers.set(terminalId, stop);
        return OK;
      }),

    unsubscribe: (terminalId) =>
      known(terminalId, () => {
        stopSubscription(terminalId);
        return Promise.resolve(OK);
      }),

    close: (terminalId) => {
      if (!shells.has(terminalId)) {
        return Promise.resolve(
          failure(
            'VALIDATION_FAILED',
            'Só um shell fecha por aqui. Para um agente, cancele a missão.',
          ),
        );
      }
      return guarded(async () => {
        stopSubscription(terminalId);
        await port.kill(terminalId);
        shells.delete(terminalId);
        return OK;
      });
    },
  };
}
