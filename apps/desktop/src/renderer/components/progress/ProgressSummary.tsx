import {
  countByGroup,
  doneTodaySummary,
  formatTaskDuration,
  PROGRESS_GROUPS,
  runningTaskCount,
  type ProgressGroup,
  type ProgressMission,
} from '../../progress-data';
import { PROGRESS_TEXT } from '../../progress-text';

/**
 * Resumo da aba Progresso: quatro botões, um por grupo, com o número e uma frase de apoio. Cada um é um
 * filtro: `aria-pressed` só no ativo; clicar no ativo limpa o filtro, clicar em outro o escolhe.
 */

function note(group: ProgressGroup, items: readonly ProgressMission[], count: number): string {
  switch (group) {
    case 'running':
      return PROGRESS_TEXT.summaryNote.running(runningTaskCount(items));
    case 'attention':
      return PROGRESS_TEXT.summaryNote.attention(count);
    case 'failed':
      return PROGRESS_TEXT.summaryNote.failed(count);
    case 'done': {
      const { tasks, ms } = doneTodaySummary(items);
      return PROGRESS_TEXT.summaryNote.done(
        tasks,
        ms > 0 ? formatTaskDuration(ms, false) : undefined,
      );
    }
  }
}

export function ProgressSummary({
  items,
  active,
  onChange,
}: {
  items: readonly ProgressMission[];
  active: ProgressGroup | undefined;
  onChange: (next: ProgressGroup | undefined) => void;
}) {
  const counts = countByGroup(items);
  return (
    <div className="progress-summary" role="group" aria-label={PROGRESS_TEXT.summaryLabel}>
      {PROGRESS_GROUPS.map((group) => (
        <button
          key={group}
          type="button"
          className="progress-summary__item"
          aria-pressed={active === group}
          onClick={() => onChange(active === group ? undefined : group)}
        >
          <span className="progress-summary__label">{PROGRESS_TEXT.groups[group]}</span>
          <span className="progress-summary__count">{counts[group]}</span>
          <span className="progress-summary__note">{note(group, items, counts[group])}</span>
        </button>
      ))}
    </div>
  );
}
