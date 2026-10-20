import type { MissionEventDto } from '@project-hub/contracts';
import type { MissionRepository } from '@project-hub/application';

/** Registro da auditoria, como o repositório o devolve depois de gravar. */
type AuditRecord = ReturnType<MissionRepository['appendAudit']>;

/** Entrega um evento de missão ao renderer. A janela principal é quem recebe (ver `index.ts`). */
export type MissionEventPublisher = (event: MissionEventDto) => void;

/**
 * Repositório de missões que, além de gravar a auditoria, entrega cada evento de missão ou de
 * tentativa ao publicador (canal `missions:event:v1`, R165). O evento sai com o `missionId` da
 * missão dona. Um evento de tentativa acha a missão pela própria tentativa. A entrega é depois da
 * gravação, na mesma chamada: se a transação que o gravou for desfeita, o renderer recebe um evento
 * que não existe mais, e a tela busca o estado de novo, então a falsa notificação só custa uma
 * leitura. Erro do publicador é registrado e não interrompe a missão.
 */
export function withMissionEvents(
  repo: MissionRepository,
  publish: MissionEventPublisher,
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
