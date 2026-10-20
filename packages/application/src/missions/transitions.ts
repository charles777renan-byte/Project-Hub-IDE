import { canTransition, type AuditActor, type MissionStatus } from '@project-hub/domain';
import type { MissionChanges, MissionRepository } from '../ports';

/**
 * Leva a missão para `to`, com a aresta conferida por `canTransition`, e grava a auditoria da
 * mudança. Quem chama já roda dentro de `repo.transaction`, então a atualização e a auditoria
 * entram juntas ou não entram (seção 15.3). Uma aresta que não existe lança erro: é defeito de
 * quem chamou, porque cada caso de uso confere o estado antes.
 */
export function moveMission(
  repo: MissionRepository,
  missionId: string,
  to: MissionStatus,
  options: { actor: AuditActor; at: string; changes?: MissionChanges },
): void {
  const mission = repo.getMission(missionId);
  if (mission === undefined) throw new Error(`Missão ausente: ${missionId}.`);
  if (!canTransition(mission.status, to)) {
    throw new Error(`Transição de missão não permitida: ${mission.status} -> ${to}.`);
  }
  repo.updateMission(missionId, { ...options.changes, status: to, updatedAt: options.at });
  repo.appendAudit({
    aggregateType: 'mission',
    aggregateId: missionId,
    eventType: 'mission.status_changed',
    severity: 'info',
    actor: options.actor,
    payload: { from: mission.status, to },
    createdAt: options.at,
  });
}

/**
 * Fecha as aprovações pendentes da execução: sem execução ativa, nenhuma delas pode mais ser
 * decidida. Cada uma vira `expired` com um registro na auditoria.
 */
export function expirePendingApprovals(
  repo: MissionRepository,
  executionId: string,
  at: string,
): void {
  for (const approval of repo.listPendingApprovals(executionId)) {
    repo.updateApproval(approval.id, { status: 'expired' });
    repo.appendAudit({
      aggregateType: 'execution',
      aggregateId: executionId,
      eventType: 'approval.expired',
      severity: 'info',
      actor: 'system',
      payload: { approvalId: approval.id },
      createdAt: at,
    });
  }
}
