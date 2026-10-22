import type { Execution, MissionStatus } from '@project-hub/domain';
import type { MissionRepository } from '../ports';
import { expirePendingApprovals, moveMission } from './transitions';

/** Estados em que a missão espera algo do usuário ou está pausada, com a execução ainda aberta. */
const PAUSED_OR_WAITING: readonly MissionStatus[] = ['waiting_approval', 'waiting_input', 'paused'];

/** Estados em que a missão já acabou. Uma execução `running` ainda aberta nela é só fechada (R136). */
const ENDED: readonly MissionStatus[] = ['succeeded', 'failed', 'cancelled'];

/**
 * Trata as execuções abertas quando o app fechou, `running` ou `paused` (seção 15.7). Cada uma vira
 * `failed` com `interrupted_by_restart`, e nenhum processo é retomado: o agente não tem como
 * voltar. As aprovações pendentes da execução expiram. A missão vai para `failed`, passando por
 * `running` quando esperava uma decisão ou estava pausada, porque essa é a única aresta até `failed`.
 * Se a missão já acabou, a execução fecha e a missão fica como está. Depois disso o usuário pode
 * iniciar uma nova tentativa. Devolve quantas execuções foram tratadas, inclusive as de missão já
 * encerrada.
 */
export function recoverInterruptedExecutions(repo: MissionRepository, now: () => string): number {
  const interrupted = openExecutionsAtStart(repo);
  for (const execution of interrupted) failInterruptedExecution(repo, execution, now);
  return interrupted.length;
}

/** Execuções que estavam abertas quando o app fechou: `running` ou `paused`. */
export function openExecutionsAtStart(repo: MissionRepository): Execution[] {
  return [...repo.findExecutionsByStatus('running'), ...repo.findExecutionsByStatus('paused')];
}

/**
 * Fecha uma execução aberta que o agente não retoma, como `interrupted_by_restart`. Usada quando a
 * sessão não existe mais, e também quando o adaptador não consegue reanexar.
 */
export function failInterruptedExecution(
  repo: MissionRepository,
  execution: Execution,
  now: () => string,
): void {
  repo.transaction(() => {
    const at = now();
    repo.updateExecution(execution.id, {
      status: 'failed',
      exitReason: 'interrupted_by_restart',
      finishedAt: at,
    });
    repo.appendAudit({
      aggregateType: 'execution',
      aggregateId: execution.id,
      eventType: 'execution.interrupted',
      severity: 'warning',
      actor: 'system',
      payload: { attempt: execution.attempt },
      createdAt: at,
    });
    expirePendingApprovals(repo, execution.id, at);

    const mission = repo.getMission(execution.missionId);
    if (mission === undefined) throw new Error(`Missão ausente: ${execution.missionId}.`);
    if (ENDED.includes(mission.status)) return;
    if (PAUSED_OR_WAITING.includes(mission.status)) {
      moveMission(repo, mission.id, 'running', { actor: 'system', at });
    }
    moveMission(repo, mission.id, 'failed', {
      actor: 'system',
      at,
      changes: { finishedAt: at },
    });
  });
}
