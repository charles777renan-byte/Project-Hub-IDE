import type { CheckDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from '../../mission-text';

const LABELS = RIGHT_PANEL_TEXT.checks.checkLabel;

/** Em que bolso o resumo põe o check. */
export type CheckOutcome = 'success' | 'failure' | 'pending';

/** O que o ícone e a cor reforçam; o texto do estado sempre acompanha. */
export type CheckTone = 'success' | 'failure' | 'pending' | 'neutral';

export type CheckView = { outcome: CheckOutcome; tone: CheckTone; label: string };

function checkRunView(check: Extract<CheckDto, { kind: 'check-run' }>): CheckView {
  if (check.status !== 'COMPLETED') {
    const label =
      check.status === 'IN_PROGRESS'
        ? LABELS.inProgress
        : check.status === 'QUEUED'
          ? LABELS.queued
          : check.status === 'WAITING'
            ? LABELS.waiting
            : LABELS.pending;
    return { outcome: 'pending', tone: 'pending', label };
  }
  switch (check.conclusion) {
    case 'SUCCESS':
      return { outcome: 'success', tone: 'success', label: LABELS.success };
    case 'NEUTRAL':
      return { outcome: 'success', tone: 'neutral', label: LABELS.neutral };
    case 'SKIPPED':
      return { outcome: 'success', tone: 'neutral', label: LABELS.skipped };
    case 'CANCELLED':
      return { outcome: 'failure', tone: 'neutral', label: LABELS.cancelled };
    case 'TIMED_OUT':
      return { outcome: 'failure', tone: 'failure', label: LABELS.timedOut };
    case 'ACTION_REQUIRED':
      return { outcome: 'failure', tone: 'failure', label: LABELS.actionRequired };
    case 'STALE':
      return { outcome: 'failure', tone: 'failure', label: LABELS.stale };
    case 'STARTUP_FAILURE':
      return { outcome: 'failure', tone: 'failure', label: LABELS.startupFailure };
    case 'FAILURE':
    case null:
      // Concluído sem conclusão não deveria existir; na dúvida, não conta como sucesso.
      return { outcome: 'failure', tone: 'failure', label: LABELS.failure };
  }
}

/** O estado de um check para a tela: o grupo do resumo, o tom do ícone e o texto em português. */
export function checkView(check: CheckDto): CheckView {
  if (check.kind === 'check-run') return checkRunView(check);
  switch (check.state) {
    case 'SUCCESS':
      return { outcome: 'success', tone: 'success', label: LABELS.success };
    case 'FAILURE':
      return { outcome: 'failure', tone: 'failure', label: LABELS.failure };
    case 'ERROR':
      return { outcome: 'failure', tone: 'failure', label: LABELS.error };
    case 'EXPECTED':
      return { outcome: 'pending', tone: 'pending', label: LABELS.expected };
    case 'PENDING':
      return { outcome: 'pending', tone: 'pending', label: LABELS.pending };
  }
}

/** Quantos checks de cada grupo. O grupo pendente é o mesmo que `isPendingCheck` (do hook) usa para reler. */
export function summarizeChecks(checks: readonly CheckDto[]): Record<CheckOutcome, number> {
  const total: Record<CheckOutcome, number> = { success: 0, failure: 0, pending: 0 };
  for (const check of checks) {
    const { outcome } = checkView(check);
    total[outcome] += 1;
  }
  return total;
}
