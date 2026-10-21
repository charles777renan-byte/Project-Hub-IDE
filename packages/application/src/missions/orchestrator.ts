import type {
  AgentAdapter,
  AgentApprovalDecision,
  AgentEvent,
  AgentSession,
} from '@project-hub/agent-sdk';
import type { AppResult } from '@project-hub/contracts';
import {
  canTransition,
  type ApprovalRequest,
  type AuditActor,
  type Execution,
  type ExitReason,
  type Mission,
  type MissionStep,
  type ProjectRecord,
} from '@project-hub/domain';
import type {
  DiffPort,
  MissionRepository,
  ProjectRepository,
  WorktreeNames,
  WorktreePort,
} from '../ports';
import { errorCode, failure } from '../result';
import { planFromCriteria } from './plan';
import { expirePendingApprovals, moveMission } from './transitions';

export type MissionPlan = { missionId: string; steps: MissionStep[] };

export type OrchestratorDeps = {
  repo: MissionRepository;
  projects: Pick<ProjectRepository, 'get'>;
  worktrees: WorktreePort;
  /** Monta os nomes do worktree a partir da missão e do projeto. A composição liga `buildWorktreeNames`. */
  worktreeNames: (input: {
    missionId: string;
    title: string;
    projectName: string;
  }) => WorktreeNames;
  /** Pasta absoluta onde os worktrees ficam (seção 16.2). */
  worktreesRoot: string;
  agent: AgentAdapter;
  /**
   * Lê as alterações do worktree quando a missão conclui, para o resumo de conclusão (R130). Sem a
   * porta, ou se o Git falhar, a missão conclui do mesmo jeito, sem o registro de arquivos e Git.
   */
  diff?: Pick<DiffPort, 'diff'>;
  now: () => string;
  newId: () => string;
};

/**
 * Casos de uso das missões (seção 15.3). Cada método devolve um resultado, e uma falha de regra
 * vem com código do contrato. Erros inesperados (o banco, por exemplo) são lançados.
 */
export interface Orchestrator {
  planMission(missionId: string): Promise<AppResult<MissionPlan>>;
  /** `planned` -> `queued`. */
  approvePlan(missionId: string): Promise<AppResult<void>>;
  /** `queued` -> `running`. Devolve a execução no estado em que o agente parou. */
  startMission(missionId: string): Promise<AppResult<Execution>>;
  cancelMission(missionId: string): Promise<AppResult<void>>;
  /** `running` -> `paused`. Pausa a sessão do agente (R181). Nunca lança: falha vira resultado. */
  pauseMission(missionId: string): Promise<AppResult<void>>;
  /** `paused` -> `running`. Retoma a sessão do agente (R181). Nunca lança: falha vira resultado. */
  resumeMission(missionId: string): Promise<AppResult<void>>;
  decideApproval(input: {
    approvalId: string;
    decision: 'approved' | 'rejected';
    note?: string;
  }): Promise<AppResult<void>>;
  /** Resposta do usuário ao pedido de entrada do agente: `waiting_input` -> `running`. */
  provideInput(input: { missionId: string; text: string }): Promise<AppResult<void>>;
  /** Nova tentativa: `failed` ou `cancelled` -> `queued`, e a execução anterior fica como está. */
  retryMission(missionId: string): Promise<AppResult<Execution>>;
}

const MISSION_NOT_FOUND = 'A missão não foi encontrada.';
const CANCEL_REASON = 'Cancelado pelo usuário.';
const REJECTED_REASON = 'Ação protegida recusada pelo usuário.';

/**
 * Uma execução em curso, ou um início em andamento. `aborted` resolve quando o `AbortController`
 * é abortado. `finalized` resolve quando o cancelamento terminou de gravar, e a leitura que espera
 * por ele vê o estado final.
 */
type ActiveRun = {
  missionId: string;
  controller: AbortController;
  aborted: Promise<void>;
  finalized: Promise<void>;
  finish: () => void;
  session?: AgentSession;
  iterator?: AsyncIterator<AgentEvent>;
  executionId?: string;
};

type Pulled =
  | { kind: 'event'; event: AgentEvent }
  | { kind: 'ended' }
  | { kind: 'aborted' }
  | { kind: 'error'; message: string };

type Workspace = { cwd: string };

/** O que o worktree tinha ao concluir: `uncommitted` quando o diff contra o HEAD traz algum arquivo. */
type WorkspaceSummary = { changedFiles: number; gitState: 'clean' | 'uncommitted' };

/**
 * Resultado da transação de pausa ou de retomada. `moved`: a mudança foi gravada. `already`: outra
 * chamada já tinha deixado a missão no estado pedido. `stale`: a missão mudou de estado antes da
 * transação, e a mudança não foi gravada.
 */
type ControlOutcome = 'moved' | 'already' | 'stale';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Falha inesperada.';
}

export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  const { repo, projects, worktrees, worktreeNames, worktreesRoot, agent, now, newId } = deps;
  const diffPort = deps.diff;
  /** Uma execução por missão no máximo: a que está em curso ou a que está começando. */
  const active = new Map<string, ActiveRun>();

  function startRun(missionId: string): ActiveRun {
    const controller = new AbortController();
    let finish: () => void = () => undefined;
    const finalized = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      controller.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    const run: ActiveRun = { missionId, controller, aborted, finalized, finish };
    active.set(missionId, run);
    return run;
  }

  function forget(run: ActiveRun): void {
    if (active.get(run.missionId) === run) active.delete(run.missionId);
  }

  function requireExecution(executionId: string): Execution {
    const execution = repo.getExecution(executionId);
    if (execution === undefined) throw new Error(`Execução ausente: ${executionId}.`);
    return execution;
  }

  /** Grava um evento do agente na auditoria da execução, com o instante que o agente informou. */
  function recordEvent(executionId: string, event: AgentEvent): void {
    repo.appendAudit({
      aggregateType: 'execution',
      aggregateId: executionId,
      eventType: event.type,
      severity: event.type === 'session.failed' ? 'error' : 'info',
      actor: 'agent',
      payload: { ...event },
      createdAt: event.at,
    });
  }

  /**
   * Abre a tentativa: a execução `running` e a missão `running`, numa só transação.
   * A nova tentativa é o número seguinte ao maior que já existe.
   */
  function openExecution(mission: Mission): Execution {
    return repo.transaction(() => {
      const at = now();
      const attempt = Math.max(0, ...repo.listExecutions(mission.id).map((e) => e.attempt)) + 1;
      const execution: Execution = {
        id: newId(),
        missionId: mission.id,
        attempt,
        status: 'running',
        startedAt: at,
      };
      repo.insertExecution(execution);
      moveMission(repo, mission.id, 'running', {
        actor: 'user',
        at,
        changes: { startedAt: mission.startedAt ?? at },
      });
      repo.appendAudit({
        aggregateType: 'execution',
        aggregateId: execution.id,
        eventType: 'execution.started',
        severity: 'info',
        actor: 'user',
        payload: { attempt },
        createdAt: at,
      });
      return execution;
    });
  }

  /**
   * Grava o worktree na missão logo depois de criado, com a auditoria. Assim, uma tentativa depois
   * dele encontra o caminho e não tenta criar outro com a mesma branch (R135).
   */
  function recordWorktree(
    missionId: string,
    worktree: { id: string; path: string },
    branch: string,
  ): void {
    repo.transaction(() => {
      const at = now();
      repo.updateMission(missionId, {
        worktreeId: worktree.id,
        worktreePath: worktree.path,
        updatedAt: at,
      });
      repo.appendAudit({
        aggregateType: 'mission',
        aggregateId: missionId,
        eventType: 'worktree.created',
        severity: 'info',
        actor: 'user',
        payload: { worktreeId: worktree.id, path: worktree.path, branch },
        createdAt: at,
      });
    });
  }

  /**
   * Onde o agente trabalha. Sem alteração de código, é a própria pasta do projeto. Com alteração,
   * é o worktree da missão: criado agora, ou o de uma tentativa anterior, que fica na missão.
   */
  async function prepareWorkspace(mission: Mission, project: ProjectRecord): Promise<Workspace> {
    // Toda missão roda num worktree, também a que não altera código (R160).
    if (mission.worktreeId !== undefined && mission.worktreePath !== undefined) {
      return { cwd: mission.worktreePath };
    }
    const names = worktreeNames({
      missionId: mission.id,
      title: mission.title,
      projectName: project.name,
    });
    const created = await worktrees.create({
      repoPath: project.path,
      worktreesRoot,
      names,
      baseRef: project.defaultBranch ?? 'HEAD',
    });
    recordWorktree(mission.id, { id: newId(), path: created.path }, created.branch);
    return { cwd: created.path };
  }

  /**
   * Encerra a execução e a missão, que estão em `running`, numa só transação. `beforeEnd` grava o
   * evento que causou o fim, na mesma transação.
   */
  function endRun(
    run: ActiveRun,
    executionId: string,
    outcome: { status: 'succeeded' | 'failed'; exitReason: ExitReason; actor: AuditActor },
    beforeEnd?: () => void,
  ): void {
    repo.transaction(() => {
      beforeEnd?.();
      const at = now();
      repo.updateExecution(executionId, {
        status: outcome.status,
        exitReason: outcome.exitReason,
        finishedAt: at,
      });
      expirePendingApprovals(repo, executionId, at);
      moveMission(repo, run.missionId, outcome.status, {
        actor: outcome.actor,
        at,
        changes: { finishedAt: at },
      });
    });
    forget(run);
  }

  /**
   * Grava `execution.failed` com o motivo, na transação que encerra a execução. Vale para a
   * recusa de aprovação e para a falha na entrega, que não chegam pelo evento final do agente
   * (R137).
   */
  function failedAudit(executionId: string, exitReason: ExitReason, actor: AuditActor): () => void {
    return () => {
      repo.appendAudit({
        aggregateType: 'execution',
        aggregateId: executionId,
        eventType: 'execution.failed',
        severity: 'error',
        actor,
        payload: { exitReason },
        createdAt: now(),
      });
    };
  }

  /**
   * Fecha as execuções abertas (`running` ou `paused`) da missão como canceladas pelo usuário, na
   * transação do cancelamento. Vale com ou sem processo ativo: sem ele, a execução ficaria aberta e a
   * recuperação depois teria de adivinhar o motivo (R136).
   */
  function cancelRunningExecutions(missionId: string, at: string): void {
    for (const execution of repo.listExecutions(missionId)) {
      if (execution.status !== 'running' && execution.status !== 'paused') continue;
      repo.updateExecution(execution.id, {
        status: 'cancelled',
        exitReason: 'cancelled_by_user',
        finishedAt: at,
      });
      expirePendingApprovals(repo, execution.id, at);
      repo.appendAudit({
        aggregateType: 'execution',
        aggregateId: execution.id,
        eventType: 'execution.cancelled',
        severity: 'info',
        actor: 'user',
        payload: {},
        createdAt: at,
      });
    }
  }

  /** Espera o próximo evento, ou o aborto. Um erro do agente volta como `error`, e não é lançado. */
  function pull(run: ActiveRun, iterator: AsyncIterator<AgentEvent>): Promise<Pulled> {
    const next = iterator.next().then<Pulled, Pulled>(
      (step) => (step.done === true ? { kind: 'ended' } : { kind: 'event', event: step.value }),
      (error: unknown) => ({ kind: 'error', message: errorMessage(error) }),
    );
    return Promise.race([next, run.aborted.then((): Pulled => ({ kind: 'aborted' }))]);
  }

  /**
   * Lê o worktree da missão para o resumo de conclusão (R130). O diff é contra o HEAD e inclui os
   * arquivos novos, então qualquer arquivo na lista é alteração sem commit. Sem porta, sem worktree
   * ou com o Git falhando, devolve `undefined`: o resumo não é inventado, e a conclusão segue.
   */
  async function readWorkspaceSummary(missionId: string): Promise<WorkspaceSummary | undefined> {
    const worktreePath = repo.getMission(missionId)?.worktreePath;
    if (diffPort === undefined || worktreePath === undefined) return undefined;
    try {
      const { files } = await diffPort.diff(worktreePath);
      return {
        changedFiles: files.length,
        gitState: files.length > 0 ? 'uncommitted' : 'clean',
      };
    } catch (error) {
      console.error('Não foi possível ler as alterações do worktree ao concluir:', error);
      return undefined;
    }
  }

  /**
   * Aplica um evento do agente. Devolve `wait` quando a sessão espera uma decisão do usuário, e
   * `done` quando a execução terminou. `wait` deixa o iterador parado: nada é consumido até a
   * resposta.
   */
  function handle(
    run: ActiveRun,
    executionId: string,
    event: AgentEvent,
    summary?: WorkspaceSummary,
  ): 'continue' | 'wait' | 'done' {
    switch (event.type) {
      case 'approval.requested':
        repo.transaction(() => {
          const approval: ApprovalRequest = {
            id: newId(),
            missionId: run.missionId,
            executionId,
            actionType: event.request.actionType,
            title: event.request.title,
            rationale: event.request.rationale,
            affectedResources: event.request.affectedResources,
            status: 'pending',
            requestedAt: event.at,
          };
          if (event.request.commandPreview !== undefined) {
            approval.commandPreview = event.request.commandPreview;
          }
          repo.insertApproval(approval);
          recordEvent(executionId, event);
          moveMission(repo, run.missionId, 'waiting_approval', { actor: 'agent', at: event.at });
        });
        return 'wait';

      case 'input.requested':
        repo.transaction(() => {
          recordEvent(executionId, event);
          moveMission(repo, run.missionId, 'waiting_input', { actor: 'agent', at: event.at });
        });
        return 'wait';

      case 'usage.updated':
        repo.transaction(() => {
          repo.updateExecution(executionId, { usage: event.usage });
          recordEvent(executionId, event);
        });
        return 'continue';

      case 'session.started':
        repo.transaction(() => {
          repo.updateExecution(executionId, { agentSessionId: event.sessionId });
          recordEvent(executionId, event);
        });
        return 'continue';

      case 'session.completed':
        endRun(
          run,
          executionId,
          { status: 'succeeded', exitReason: 'completed', actor: 'agent' },
          () => {
            recordEvent(executionId, event);
            if (summary === undefined) return;
            repo.appendAudit({
              aggregateType: 'execution',
              aggregateId: executionId,
              eventType: 'execution.concluded',
              severity: 'info',
              actor: 'system',
              payload: { ...summary },
              createdAt: now(),
            });
          },
        );
        return 'done';

      case 'session.failed':
        endRun(
          run,
          executionId,
          { status: 'failed', exitReason: 'agent_failed', actor: 'agent' },
          () => recordEvent(executionId, event),
        );
        return 'done';

      default:
        recordEvent(executionId, event);
        return 'continue';
    }
  }

  /**
   * Lê eventos do agente até a sessão parar para uma decisão ou terminar. Devolve a execução no
   * estado em que parou. Interrompida pelo cancelamento, espera o fim gravado por ele.
   */
  async function drive(run: ActiveRun): Promise<Execution> {
    const { iterator, executionId } = run;
    if (iterator === undefined || executionId === undefined) {
      throw new Error('Execução sem sessão de agente.');
    }
    for (;;) {
      const pulled = await pull(run, iterator);
      if (pulled.kind === 'aborted' || run.controller.signal.aborted) {
        await run.finalized;
        return requireExecution(executionId);
      }
      if (pulled.kind === 'ended') {
        endRun(
          run,
          executionId,
          { status: 'failed', exitReason: 'agent_failed', actor: 'system' },
          () =>
            repo.appendAudit({
              aggregateType: 'execution',
              aggregateId: executionId,
              eventType: 'session.ended',
              severity: 'error',
              actor: 'system',
              payload: { reason: 'sem evento final do agente' },
              createdAt: now(),
            }),
        );
        return requireExecution(executionId);
      }
      if (pulled.kind === 'error') {
        endRun(
          run,
          executionId,
          { status: 'failed', exitReason: 'agent_failed', actor: 'system' },
          () =>
            repo.appendAudit({
              aggregateType: 'execution',
              aggregateId: executionId,
              eventType: 'session.error',
              severity: 'error',
              actor: 'system',
              payload: { message: pulled.message },
              createdAt: now(),
            }),
        );
        return requireExecution(executionId);
      }
      // O fim da sessão lê o worktree antes de gravar; um cancelamento durante a leitura vence.
      const summary =
        pulled.event.type === 'session.completed'
          ? await readWorkspaceSummary(run.missionId)
          : undefined;
      if (run.controller.signal.aborted) {
        await run.finalized;
        return requireExecution(executionId);
      }
      const outcome = handle(run, executionId, pulled.event, summary);
      if (outcome !== 'continue') return requireExecution(executionId);
    }
  }

  /** Roda uma chamada ao agente. Devolve `false` quando ela falha, e registra o erro. */
  async function tryAgent(problem: string, action: () => Promise<void>): Promise<boolean> {
    try {
      await action();
      return true;
    } catch (error) {
      console.error(problem, error);
      return false;
    }
  }

  /** Tenta entregar ao agente. Devolve `false` quando ele recusa; quem chama decide o que fazer. */
  function tryDeliver(action: () => Promise<void>): Promise<boolean> {
    return tryAgent('Não foi possível entregar a resposta ao agente:', action);
  }

  /**
   * Entrega ao agente a resposta do usuário. Se o agente recusar, a execução termina como falha, e
   * a missão não fica parada em `running`.
   */
  async function deliver(
    run: ActiveRun,
    session: AgentSession,
    executionId: string,
    action: () => Promise<void>,
  ): Promise<AppResult<void>> {
    if (await tryDeliver(action)) return { ok: true, data: undefined };
    endRun(
      run,
      executionId,
      { status: 'failed', exitReason: 'agent_failed', actor: 'system' },
      failedAudit(executionId, 'agent_failed', 'system'),
    );
    await session.stop('Resposta não entregue ao agente.');
    return failure(
      'AGENT_UNAVAILABLE',
      'O agente não recebeu a resposta. A execução foi encerrada.',
    );
  }

  /**
   * Início: confere o estado e o Git, prepara o workspace, abre o agente e abre a tentativa. Cada
   * falha antes de `running` deixa a missão em `queued`, para uma nova tentativa de início.
   */
  async function launch(
    run: ActiveRun,
    mission: Mission,
    project: ProjectRecord,
  ): Promise<AppResult<Execution>> {
    let workspace: Workspace;
    try {
      workspace = await prepareWorkspace(mission, project);
    } catch (error) {
      forget(run);
      const code = errorCode(error);
      if (code === undefined) throw error;
      return failure(code, errorMessage(error));
    }
    if (run.controller.signal.aborted) {
      forget(run);
      return failure('MISSION_INVALID_STATE', 'A missão foi cancelada antes de iniciar.');
    }

    let session: AgentSession;
    try {
      session = await agent.start(
        { cwd: workspace.cwd, prompt: mission.objective },
        run.controller.signal,
      );
    } catch (error) {
      forget(run);
      console.error('Não foi possível iniciar o agente:', error);
      return failure('AGENT_UNAVAILABLE', 'Não foi possível iniciar o agente.');
    }
    run.session = session;
    run.iterator = session.events()[Symbol.asyncIterator]();
    if (run.controller.signal.aborted) {
      await session.stop(CANCEL_REASON);
      forget(run);
      run.finish();
      return failure('MISSION_INVALID_STATE', 'A missão foi cancelada durante o início.');
    }

    let execution: Execution;
    try {
      execution = openExecution(mission);
    } catch (error) {
      forget(run);
      await session.stop('Não foi possível abrir a tentativa.');
      throw error;
    }
    run.executionId = execution.id;
    return { ok: true, data: await drive(run) };
  }

  async function startMission(missionId: string): Promise<AppResult<Execution>> {
    const mission = repo.getMission(missionId);
    if (mission === undefined) return failure('MISSION_NOT_FOUND', MISSION_NOT_FOUND);
    if (mission.status !== 'queued' || active.has(missionId)) {
      return failure(
        'MISSION_INVALID_STATE',
        'A missão precisa estar aprovada e na fila para iniciar.',
      );
    }
    const project = projects.get(mission.projectId);
    if (project === undefined) {
      return failure('PROJECT_NOT_FOUND', 'O projeto da missão não foi encontrado.');
    }
    if (project.repositoryKind !== 'git') {
      return failure(
        'PROJECT_WITHOUT_GIT',
        'A missão roda num worktree do Git, e a pasta do projeto não é um repositório Git. Inicialize o Git na pasta e tente de novo.',
      );
    }
    return launch(startRun(missionId), mission, project);
  }

  async function cancelMission(missionId: string): Promise<AppResult<void>> {
    const mission = repo.getMission(missionId);
    if (mission === undefined) return failure('MISSION_NOT_FOUND', MISSION_NOT_FOUND);
    const run = active.get(missionId);

    if (run === undefined) {
      if (!canTransition(mission.status, 'cancelled')) {
        return failure('MISSION_INVALID_STATE', 'A missão já foi encerrada.');
      }
      repo.transaction(() => {
        const at = now();
        cancelRunningExecutions(missionId, at);
        moveMission(repo, missionId, 'cancelled', {
          actor: 'user',
          at,
          changes: { finishedAt: at },
        });
      });
      return { ok: true, data: undefined };
    }

    // Aborta primeiro: o laço para de consumir eventos. Depois o agente é parado, e só então a
    // execução e a missão são marcadas como canceladas (seção 9.3).
    run.controller.abort();
    try {
      if (run.session !== undefined) await run.session.stop(CANCEL_REASON);
    } finally {
      try {
        repo.transaction(() => {
          const at = now();
          cancelRunningExecutions(missionId, at);
          moveMission(repo, missionId, 'cancelled', {
            actor: 'user',
            at,
            changes: { finishedAt: at },
          });
        });
      } finally {
        forget(run);
        run.finish();
      }
    }
    return { ok: true, data: undefined };
  }

  /**
   * Roda um caso de uso que não pode lançar (R181). Um erro inesperado, o do banco por exemplo, vira
   * `UNKNOWN` e é registrado no console.
   */
  async function guarded(work: () => Promise<AppResult<void>>): Promise<AppResult<void>> {
    try {
      return await work();
    } catch (error) {
      console.error('Falha inesperada na missão:', error);
      return failure('UNKNOWN', 'Algo deu errado. Tente de novo.');
    }
  }

  /**
   * Confere a capacidade `pauseResume` do agente antes de pedir pausa ou retomada (seção 14.3). Se
   * ela não existe, o agente não recebe a chamada e a missão não muda. Falha ao consultar vira
   * `AGENT_UNAVAILABLE`.
   */
  async function supportsPauseResume(): Promise<AppResult<void>> {
    let capabilities: Awaited<ReturnType<AgentAdapter['getCapabilities']>>;
    try {
      capabilities = await agent.getCapabilities({ configuration: {} });
    } catch (error) {
      console.error('Não foi possível consultar as capacidades do agente:', error);
      return failure('AGENT_UNAVAILABLE', 'Não foi possível consultar o agente.');
    }
    if (!capabilities.pauseResume) {
      return failure(
        'AGENT_CAPABILITY_UNSUPPORTED',
        'O agente desta missão não suporta pausar e retomar.',
      );
    }
    return { ok: true, data: undefined };
  }

  /**
   * Pausa a missão em execução (R181). O agente pausa primeiro: se ele recusar, nada muda e a missão
   * segue `running`. Depois, missão e execução vão para `paused` numa transação que confere o estado
   * de novo, porque o agente pode ter terminado enquanto a pausa era pedida. Se a transação falhar,
   * o agente volta a rodar, para ficar de acordo com o banco.
   */
  function pauseMission(missionId: string): Promise<AppResult<void>> {
    return guarded(async () => {
      const mission = repo.getMission(missionId);
      if (mission === undefined) return failure('MISSION_NOT_FOUND', MISSION_NOT_FOUND);
      if (mission.status !== 'running') {
        return failure('MISSION_INVALID_STATE', 'Só uma missão em execução pode ser pausada.');
      }
      const run = active.get(missionId);
      if (run?.session === undefined || run.executionId === undefined) {
        return failure('AGENT_UNAVAILABLE', 'A sessão do agente não está mais ativa.');
      }
      const session = run.session;
      const executionId = run.executionId;
      const capable = await supportsPauseResume();
      if (!capable.ok) return capable;
      const paused = await tryAgent('Não foi possível pausar o agente:', () => session.pause());
      if (!paused) return failure('AGENT_UNAVAILABLE', 'O agente não pausou. A execução continua.');

      let outcome: ControlOutcome;
      try {
        outcome = repo.transaction((): ControlOutcome => {
          const current = repo.getMission(missionId);
          const execution = repo.getExecution(executionId);
          if (current?.status === 'paused' && execution?.status === 'paused') return 'already';
          if (current?.status !== 'running' || execution?.status !== 'running') return 'stale';
          const at = now();
          repo.updateExecution(executionId, { status: 'paused' });
          repo.appendAudit({
            aggregateType: 'execution',
            aggregateId: executionId,
            eventType: 'execution.paused',
            severity: 'info',
            actor: 'user',
            payload: {},
            createdAt: at,
          });
          moveMission(repo, missionId, 'paused', { actor: 'user', at });
          return 'moved';
        });
      } catch (error) {
        await tryAgent('Não foi possível desfazer a pausa do agente:', () => session.resume());
        throw error;
      }
      // Outra chamada já deixou a missão pausada: o estado é o pedido, e não há o que desfazer.
      if (outcome === 'already') return { ok: true, data: undefined };
      if (outcome === 'stale') {
        await tryAgent('Não foi possível desfazer a pausa do agente:', () => session.resume());
        return failure('MISSION_INVALID_STATE', 'A missão mudou enquanto era pausada.');
      }
      return { ok: true, data: undefined };
    });
  }

  /**
   * Retoma a missão pausada (R181): o agente volta a rodar do ponto em que parou, e missão e execução
   * voltam a `running` numa transação. Se o agente recusar, a missão segue `paused`. Se a transação
   * falhar, o agente pausa de novo.
   */
  function resumeMission(missionId: string): Promise<AppResult<void>> {
    return guarded(async () => {
      const mission = repo.getMission(missionId);
      if (mission === undefined) return failure('MISSION_NOT_FOUND', MISSION_NOT_FOUND);
      if (mission.status !== 'paused') {
        return failure('MISSION_INVALID_STATE', 'Só uma missão pausada pode ser retomada.');
      }
      const run = active.get(missionId);
      if (run?.session === undefined || run.executionId === undefined) {
        return failure('AGENT_UNAVAILABLE', 'A sessão do agente não está mais ativa.');
      }
      const session = run.session;
      const executionId = run.executionId;
      const capable = await supportsPauseResume();
      if (!capable.ok) return capable;
      const resumed = await tryAgent('Não foi possível retomar o agente:', () => session.resume());
      if (!resumed) {
        return failure('AGENT_UNAVAILABLE', 'O agente não retomou. A missão continua pausada.');
      }

      let outcome: ControlOutcome;
      try {
        outcome = repo.transaction((): ControlOutcome => {
          const current = repo.getMission(missionId);
          const execution = repo.getExecution(executionId);
          if (current?.status === 'running' && execution?.status === 'running') return 'already';
          if (current?.status !== 'paused' || execution?.status !== 'paused') return 'stale';
          const at = now();
          repo.updateExecution(executionId, { status: 'running' });
          repo.appendAudit({
            aggregateType: 'execution',
            aggregateId: executionId,
            eventType: 'execution.resumed',
            severity: 'info',
            actor: 'user',
            payload: {},
            createdAt: at,
          });
          moveMission(repo, missionId, 'running', { actor: 'user', at });
          return 'moved';
        });
      } catch (error) {
        await tryAgent('Não foi possível pausar de novo o agente:', () => session.pause());
        throw error;
      }
      // Outra chamada já deixou a missão em execução: o estado é o pedido, e não há o que desfazer.
      if (outcome === 'already') return { ok: true, data: undefined };
      if (outcome === 'stale') {
        await tryAgent('Não foi possível pausar de novo o agente:', () => session.pause());
        return failure('MISSION_INVALID_STATE', 'A missão mudou enquanto era retomada.');
      }
      return { ok: true, data: undefined };
    });
  }

  async function decideApproval(input: {
    approvalId: string;
    decision: 'approved' | 'rejected';
    note?: string;
  }): Promise<AppResult<void>> {
    const approval = repo.getApproval(input.approvalId);
    if (approval === undefined) {
      return failure('APPROVAL_NOT_FOUND', 'A aprovação não foi encontrada.');
    }
    if (approval.status === 'expired') {
      return failure(
        'APPROVAL_EXPIRED',
        'A aprovação expirou: a execução terminou antes da decisão.',
      );
    }
    if (approval.status !== 'pending') {
      return failure('MISSION_INVALID_STATE', 'Esta aprovação já foi decidida.');
    }
    const mission = repo.getMission(approval.missionId);
    if (mission?.status !== 'waiting_approval') {
      return failure('MISSION_INVALID_STATE', 'A missão não está aguardando aprovação.');
    }
    const run = active.get(approval.missionId);
    if (run?.session === undefined || run.executionId === undefined) {
      return failure('APPROVAL_EXPIRED', 'A sessão do agente não está mais ativa.');
    }
    const session = run.session;
    const executionId = run.executionId;
    const decision: AgentApprovalDecision =
      input.note === undefined
        ? { decision: input.decision }
        : { decision: input.decision, note: input.note };

    repo.transaction(() => {
      const at = now();
      repo.updateApproval(approval.id, {
        status: input.decision,
        decidedAt: at,
        ...(input.note === undefined ? {} : { decisionNote: input.note }),
      });
      repo.appendAudit({
        aggregateType: 'execution',
        aggregateId: executionId,
        eventType: 'approval.decided',
        severity: 'info',
        actor: 'user',
        payload: { approvalId: approval.id, decision: input.decision },
        createdAt: at,
      });
      moveMission(repo, approval.missionId, 'running', { actor: 'user', at });
    });

    if (input.decision === 'rejected') {
      // A recusa encerra a execução por conta do próprio Project Hub: o agente não retoma, e o
      // motivo fica registrado. A missão passa por `running` (seção 9.3) até `failed`.
      const rejectionDelivered = await tryDeliver(() => session.approve(decision));
      const sessionStopped = await tryAgent('Não foi possível encerrar a sessão do agente:', () =>
        session.stop(REJECTED_REASON),
      );
      try {
        endRun(
          run,
          executionId,
          { status: 'failed', exitReason: 'approval_rejected', actor: 'user' },
          failedAudit(executionId, 'approval_rejected', 'user'),
        );
      } catch (error) {
        console.error('Não foi possível encerrar a execução recusada:', error);
        return failure('UNKNOWN', 'Não foi possível encerrar a execução recusada.');
      }
      if (!rejectionDelivered || !sessionStopped) {
        return failure(
          'AGENT_UNAVAILABLE',
          'O agente não recebeu a recusa ou não encerrou. A execução foi encerrada.',
        );
      }
      return { ok: true, data: undefined };
    }

    const delivered = await deliver(run, session, executionId, () => session.approve(decision));
    if (!delivered.ok) return delivered;
    await drive(run);
    return { ok: true, data: undefined };
  }

  async function provideInput(input: {
    missionId: string;
    text: string;
  }): Promise<AppResult<void>> {
    const mission = repo.getMission(input.missionId);
    if (mission === undefined) return failure('MISSION_NOT_FOUND', MISSION_NOT_FOUND);
    const run = active.get(input.missionId);
    if (
      mission.status !== 'waiting_input' ||
      run?.session === undefined ||
      run.executionId === undefined
    ) {
      return failure('MISSION_INVALID_STATE', 'A missão não está aguardando uma entrada.');
    }
    const session = run.session;
    const executionId = run.executionId;

    repo.transaction(() => {
      const at = now();
      repo.appendAudit({
        aggregateType: 'execution',
        aggregateId: executionId,
        eventType: 'input.provided',
        severity: 'info',
        actor: 'user',
        payload: {},
        createdAt: at,
      });
      moveMission(repo, input.missionId, 'running', { actor: 'user', at });
    });

    const delivered = await deliver(run, session, executionId, () =>
      session.send({ text: input.text }),
    );
    if (!delivered.ok) return delivered;
    await drive(run);
    return { ok: true, data: undefined };
  }

  async function retryMission(missionId: string): Promise<AppResult<Execution>> {
    const mission = repo.getMission(missionId);
    if (mission === undefined) return failure('MISSION_NOT_FOUND', MISSION_NOT_FOUND);
    if (mission.status !== 'failed' && mission.status !== 'cancelled') {
      return failure(
        'MISSION_INVALID_STATE',
        'Só uma missão que falhou ou foi cancelada pode ter nova tentativa.',
      );
    }
    repo.transaction(() => {
      moveMission(repo, missionId, 'queued', { actor: 'user', at: now() });
    });
    return startMission(missionId);
  }

  /**
   * Gera o plano de uma missão em rascunho, ou refaz o plano de uma missão planejada (R161). O
   * plano refeito troca as etapas e fica registrado na auditoria, com as etapas de cada versão.
   */
  async function planMission(missionId: string): Promise<AppResult<MissionPlan>> {
    const mission = repo.getMission(missionId);
    if (mission === undefined) return failure('MISSION_NOT_FOUND', MISSION_NOT_FOUND);
    if (mission.status !== 'draft' && mission.status !== 'planned') {
      return failure(
        'MISSION_INVALID_STATE',
        'Só uma missão em rascunho ou com plano pode ser planejada.',
      );
    }
    if (mission.acceptanceCriteria.length === 0) {
      return failure('VALIDATION_FAILED', 'A missão precisa de pelo menos um critério de aceite.');
    }
    const criteria = [...mission.acceptanceCriteria]
      .sort((a, b) => a.position - b.position)
      .map((criterion) => criterion.text);
    const steps: MissionStep[] = planFromCriteria(criteria).steps.map((step) => ({
      id: newId(),
      missionId,
      position: step.position,
      title: step.title,
      description: '',
      kind: 'custom',
      status: 'pending',
      dependsOn: [],
    }));
    repo.transaction(() => {
      const at = now();
      repo.replaceSteps(missionId, steps);
      if (mission.status === 'draft')
        moveMission(repo, missionId, 'planned', { actor: 'user', at });
      repo.appendAudit({
        aggregateType: 'mission',
        aggregateId: missionId,
        eventType: 'plan.generated',
        severity: 'info',
        actor: 'user',
        payload: { steps: steps.map((step) => step.title) },
        createdAt: at,
      });
    });
    return { ok: true, data: { missionId, steps } };
  }

  async function approvePlan(missionId: string): Promise<AppResult<void>> {
    const mission = repo.getMission(missionId);
    if (mission === undefined) return failure('MISSION_NOT_FOUND', MISSION_NOT_FOUND);
    if (mission.status !== 'planned') {
      return failure('MISSION_INVALID_STATE', 'Só um plano gerado pode ser aprovado.');
    }
    repo.transaction(() => {
      moveMission(repo, missionId, 'queued', { actor: 'user', at: now() });
    });
    return { ok: true, data: undefined };
  }

  return {
    planMission,
    approvePlan,
    startMission,
    cancelMission,
    pauseMission,
    resumeMission,
    decideApproval,
    provideInput,
    retryMission,
  };
}
