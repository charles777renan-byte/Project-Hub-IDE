import { Link } from 'react-router';
import type { MissionViewDto } from '@project-hub/contracts';
import {
  MISSION_TEXT,
  isEnded,
  primaryActionOf,
  statusLabel,
  statusTone,
  verificationSummary,
  type PrimaryAction,
} from '../../mission-text';
import { projectPath } from '../../routes';
import { ConfirmButton } from '../ConfirmButton';
import { StatusChip } from '../StatusChip';
import type { DiffSummary } from './DiffPanel';

/** Rótulo da ação principal de cada situação. */
const PRIMARY_LABEL: Record<PrimaryAction, string> = {
  generate_plan: MISSION_TEXT.generatePlan,
  approve_plan: MISSION_TEXT.approvePlan,
  start: MISSION_TEXT.start,
  resume: MISSION_TEXT.resume,
  retry: MISSION_TEXT.retry,
};

type Indicator = { label: string; value: string; tone?: 'ok' | 'bad'; note?: string };

/** Texto do indicador de verificação, a partir dos eventos `verification.completed`. */
function verificationIndicator(events: MissionViewDto['events']): Indicator {
  const summary = verificationSummary(events);
  if (summary.kind === 'none') return { label: 'Verificação', value: 'Nenhum teste rodou' };
  if (summary.kind === 'empty') return { label: 'Verificação', value: 'Sem verificação' };
  return {
    label: 'Verificação',
    value: `${summary.passed} de ${summary.total} passaram`,
    tone: summary.failed ? 'bad' : 'ok',
  };
}

/** Texto do indicador de arquivos alterados: "—" até o diff ser lido. */
function changedFilesIndicator(diff: DiffSummary | undefined): Indicator {
  if (diff === undefined) return { label: 'Arquivos alterados', value: '—' };
  const count = `${diff.count}${diff.truncated ? '+' : ''}`;
  return {
    label: 'Arquivos alterados',
    value: `${count} ${diff.count === 1 && !diff.truncated ? 'arquivo' : 'arquivos'}`,
  };
}

/**
 * Fecho da missão concluída (R130): a frase final do agente e o estado do Git ao concluir. A verificação
 * e os arquivos alterados já aparecem nos indicadores do resumo, então não se repetem aqui. A frase vem
 * do agente e entra como texto, nunca como HTML.
 */
function ConclusionSummary({
  conclusion,
}: {
  conclusion: NonNullable<MissionViewDto['conclusion']>;
}) {
  return (
    <section className="conclusion" aria-label="Resumo da conclusão">
      <p className="conclusion__summary">{conclusion.summary}</p>
      <ul className="conclusion__facts">
        <li className="conclusion__item">
          {conclusion.gitState === 'uncommitted'
            ? 'Git: alterações sem commit'
            : 'Git: sem alterações pendentes'}
        </li>
      </ul>
    </section>
  );
}

/**
 * Resumo fixo no topo da página da missão (seção 10.7): o título, a situação, branch e worktree em uma
 * linha, a ação principal que a situação permite, as ações secundárias (pausar, cancelar ou excluir) e
 * três indicadores (verificação, arquivos alterados e Git). Com a missão concluída, mostra também o
 * fecho da conclusão (a frase final do agente e o estado do Git), sem ação principal. Este componente só mostra e chama o que a
 * página passa: o comportamento das ações fica na página.
 */
export function MissionSummary({
  mission,
  project,
  events,
  diff,
  conclusion,
  busy,
  controlBusy,
  onGeneratePlan,
  onApprovePlan,
  onStart,
  onPause,
  onResume,
  onRetry,
  onCancel,
  onDelete,
}: {
  mission: MissionViewDto['mission'];
  project: MissionViewDto['project'];
  events: MissionViewDto['events'];
  /** Contagem de arquivos do Diff, ou `undefined` enquanto o diff não foi lido. */
  diff: DiffSummary | undefined;
  /** Resumo de conclusão. Só aparece com a missão concluída; cancelada ou com falha não tem resumo. */
  conclusion?: MissionViewDto['conclusion'];
  /** Chamadas longas (planejar, aprovar, iniciar e tentar de novo): desabilitam a ação principal. */
  busy: boolean;
  /** Pausar, retomar, cancelar e excluir: cada uma só cobre a própria chamada. */
  controlBusy: boolean;
  onGeneratePlan: () => void;
  onApprovePlan: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onCancel: () => void;
  /** Exclui a missão encerrada. Só chama depois que a pessoa confirma. */
  onDelete: () => void;
}) {
  const primary = primaryActionOf(mission.status);
  const tone = statusTone(mission.status);
  const hasWorktree = mission.worktreePath !== undefined;
  const indicators: Indicator[] = [
    verificationIndicator(events),
    changedFilesIndicator(diff),
    {
      label: 'Git',
      value: hasWorktree ? 'worktree criado' : 'sem worktree',
      ...(hasWorktree ? { note: 'Push e merge exigem a sua aprovação.' } : {}),
    },
  ];

  const primaryAction: Record<PrimaryAction, { run: () => void; disabled: boolean }> = {
    generate_plan: { run: onGeneratePlan, disabled: busy },
    approve_plan: { run: onApprovePlan, disabled: busy },
    start: { run: onStart, disabled: busy },
    resume: { run: onResume, disabled: controlBusy },
    retry: { run: onRetry, disabled: busy },
  };

  return (
    <section aria-label="Resumo da missão" className={`mission-summary mission-summary--${tone}`}>
      <p className="eyebrow">
        <Link to={projectPath(project.id)}>{project.name}</Link>
      </p>
      <div className="mission-summary__head">
        <h1>{mission.title}</h1>
        <StatusChip label={statusLabel(mission.status)} tone={tone} />
        <div className="mission-summary__actions">
          {primary === undefined ? null : (
            <button
              type="button"
              className={
                primary === 'approve_plan'
                  ? 'btn-decision mission-summary__primary'
                  : 'btn-primary mission-summary__primary'
              }
              disabled={primaryAction[primary].disabled}
              onClick={primaryAction[primary].run}
            >
              {PRIMARY_LABEL[primary]}
            </button>
          )}
          <div className="mission-summary__secondary">
            {mission.status === 'running' ? (
              <button type="button" className="btn-pause" disabled={controlBusy} onClick={onPause}>
                {MISSION_TEXT.pause}
              </button>
            ) : null}
            {isEnded(mission.status) ? (
              <ConfirmButton
                label="Excluir missão"
                question="Excluir esta missão? O plano, as tentativas e o histórico saem do app. Não dá para desfazer."
                confirmLabel="Excluir"
                disabled={controlBusy}
                onConfirm={onDelete}
              />
            ) : (
              <button
                type="button"
                className="btn-danger"
                disabled={controlBusy}
                onClick={onCancel}
              >
                Cancelar missão
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="mission-meta">
        {project.name} · branch {project.defaultBranch ?? 'sem Git'} · worktree{' '}
        {mission.worktreePath ?? 'ainda não criado'}
      </p>
      {mission.status === 'succeeded' && conclusion !== undefined ? (
        <ConclusionSummary conclusion={conclusion} />
      ) : null}
      <ul className="mission-indicators" aria-label="Indicadores da missão">
        {indicators.map((indicator) => (
          <li
            key={indicator.label}
            className={
              indicator.tone === undefined
                ? 'mission-indicator'
                : `mission-indicator mission-indicator--${indicator.tone}`
            }
          >
            <span className="mission-indicator__label">{indicator.label}</span>
            <span className="mission-indicator__value">{indicator.value}</span>
            {indicator.note === undefined ? null : (
              <span className="mission-indicator__note">{indicator.note}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
