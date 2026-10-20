import type { MissionStatus } from '@project-hub/domain';
import type { MissionRepository } from '../ports';
import { expirePendingApprovals, moveMission } from './transitions';

/** Estados em que a missão espera algo do usuário ou está pausada, com a execução ainda aberta. */
const PAUSED_OR_WAITING: readonly MissionStatus[] = ['waiting_approval', 'waiting_input', 'paused'];

/**
 * Trata as execuções que estavam em `running` quando o app fechou (seção 15.7). Cada uma vira
 * `failed` com `interrupted_by_restart`, e nenhum processo é retomado: o agente não tem como
 * voltar. As aprovações pendentes da execução expiram. A missão vai para `failed`, passando por
 * `running` quando esperava uma decisão, porque essa é a única aresta até `failed`. Depois disso o
 * usuário pode iniciar uma nova tentativa. Devolve quantas execuções foram tratadas.
 */
export function recoverInterruptedExecutions(repo: MissionRepository, now: () => string): number {
  const interrupted = repo.findExecutionsByStatus('running');
  for (const execution of interrupted) {
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
  return interrupted.length;
}
