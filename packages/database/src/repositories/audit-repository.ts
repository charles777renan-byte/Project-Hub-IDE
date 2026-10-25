import { randomUUID } from 'node:crypto';
import type { AuditEvent, NewAuditEvent } from '@project-hub/domain';
import { eq, gte, max, sql } from 'drizzle-orm';
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

/** Eventos de auditoria de um dia local: `date` é `AAAA-MM-DD` no fuso do computador. */
export type AuditDayCount = { date: string; count: number };

/**
 * Conta os eventos de auditoria por dia local, a partir de `sinceIso` (inclusive). O dia é o do
 * fuso do computador (`date(created_at, 'localtime')`) e não o do UTC: um evento às 23h30 locais
 * fica no dia em que a pessoa o viu. O agrupamento roda no banco, então nenhum evento vai para a
 * memória. Os dias sem evento não são devolvidos; quem consome preenche.
 */
export function countAuditEventsByLocalDay(db: AppDatabase, sinceIso: string): AuditDayCount[] {
  const day = sql<string>`date(${auditEvents.createdAt}, 'localtime')`;
  return db
    .select({ date: day, count: sql<number>`count(*)`.mapWith(Number) })
    .from(auditEvents)
    .where(gte(auditEvents.createdAt, sinceIso))
    .groupBy(day)
    .orderBy(day)
    .all();
}
