import { randomUUID } from 'node:crypto';
import type { AuditEvent, NewAuditEvent } from '@project-hub/domain';
import { eq, max } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { auditEvents } from '../schema';

/**
 * Grava um evento de auditoria. O `sequence` é o maior que o agregado já tem, mais um. A gravação
 * fica dentro da transação que chama, então a mudança e o registro dela entram juntos (seção 15.3).
 */
export function appendAuditEvent(db: AppDatabase, event: NewAuditEvent): AuditEvent {
  const [last] = db
    .select({ last: max(auditEvents.sequence) })
    .from(auditEvents)
    .where(eq(auditEvents.aggregateId, event.aggregateId))
    .all();
  const record: AuditEvent = {
    id: randomUUID(),
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    severity: event.severity,
    actor: event.actor,
    payload: event.payload,
    sequence: (last?.last ?? 0) + 1,
    createdAt: event.createdAt,
  };
  db.insert(auditEvents)
    .values({
      id: record.id,
      aggregateType: record.aggregateType,
      aggregateId: record.aggregateId,
      eventType: record.eventType,
      severity: record.severity,
      actor: record.actor,
      payload: record.payload,
      sequence: record.sequence,
      createdAt: record.createdAt,
    })
    .run();
  return record;
}
