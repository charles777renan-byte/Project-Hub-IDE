import type { MissionEventDto, MissionUsageEventDto } from '@project-hub/contracts';
import type { MissionRepository } from '@project-hub/application';

/** Registro da auditoria, como o repositório o devolve depois de gravar. */
type AuditRecord = ReturnType<MissionRepository['appendAudit']>;

/** Entrega um evento de missão ao renderer. A janela principal é quem recebe (ver `index.ts`). */
export type MissionEventPublisher = (event: MissionEventDto) => void;

/** Entrega o gasto de tokens de uma tentativa ao renderer (canal `missions:usage:v1`). */
export type MissionUsagePublisher = (event: MissionUsageEventDto) => void;

/**
 * Repositório de missões que, além de gravar a auditoria, entrega cada evento de missão ou de
 * tentativa ao publicador (canal `missions:event:v1`, R165). O evento sai com o `missionId` da
 * missão dona. Um evento de tentativa acha a missão pela própria tentativa. A entrega é depois da
 * gravação, na mesma chamada: se a transação que o gravou for desfeita, o renderer recebe um evento
 * que não existe mais, e a tela busca o estado de novo, então a falsa notificação só custa uma
 * leitura. Erro do publicador é registrado e não interrompe a missão.
 *
 * O gasto de tokens não passa pela auditoria: chega a cada segundo ou dois, e cada evento de missão faz a
 * tela recarregar a visão inteira. Ele sai pelo próprio canal quando a tentativa grava um uso novo, e a
 * tela só troca o número.
 */
export function withMissionEvents(
  repo: MissionRepository,
  publish: MissionEventPublisher,
  publishUsage: MissionUsagePublisher = () => undefined,
): MissionRepository {
  return {
    ...repo,
    appendAudit(event) {
      const record = repo.appendAudit(event);
      const missionId = missionIdOf(repo, record);
      if (missionId !== undefined) {
        try {
          publish(toMissionEventDto(record, missionId));
        } catch (error) {
          console.error('Não foi possível entregar o evento da missão:', error);
        }
      }
      return record;
    },
    updateExecution(id, changes) {
      repo.updateExecution(id, changes);
      const usage = changes.usage;
      if (usage === undefined) return;
      const missionId = repo.getExecution(id)?.missionId;
      if (missionId === undefined) return;
      try {
        publishUsage({ missionId, executionId: id, usage });
      } catch (error) {
        console.error('Não foi possível entregar o gasto da tentativa:', error);
      }
    },
  };
}

/** A missão dona do evento: a própria, para a missão, ou a da tentativa. Outros agregados não são da missão. */
function missionIdOf(repo: MissionRepository, record: AuditRecord): string | undefined {
  if (record.aggregateType === 'mission') return record.aggregateId;
  if (record.aggregateType === 'execution') {
    return repo.getExecution(record.aggregateId)?.missionId;
  }
  return undefined;
}

function toMissionEventDto(record: AuditRecord, missionId: string): MissionEventDto {
  return {
    id: record.id,
    missionId,
    aggregateType: record.aggregateType,
    aggregateId: record.aggregateId,
    eventType: record.eventType,
    severity: record.severity,
    actor: record.actor,
    payload: record.payload,
    sequence: record.sequence,
    createdAt: record.createdAt,
  };
}
