import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { MissionViewDto } from '@project-hub/contracts';
import {
  MISSION_TEXT,
  isEnded,
  primaryActionOf,
  statusLabel,
  statusTone,
  verificationSummary,
  worktreeName,
  type PrimaryAction,
} from '../../mission-text';
import { notify } from '../../notify';
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

/**
 * Texto do indicador de arquivos alterados: "Nenhum ainda" sem worktree ou sem alteração, "—" enquanto
 * o diff do worktree não foi lido, e a contagem depois.
 */
function changedFilesIndicator(hasWorktree: boolean, diff: DiffSummary | undefined): Indicator {
  const label = 'Arquivos alterados';
  if (!hasWorktree) return { label, value: 'Nenhum ainda' };
  if (diff === undefined) return { label, value: '—' };
  if (diff.count === 0 && !diff.truncated) return { label, value: 'Nenhum ainda' };
  const count = `${diff.count}${diff.truncated ? '+' : ''}`;
  return {
    label,
    value: `${count} ${diff.count === 1 && !diff.truncated ? 'arquivo' : 'arquivos'}`,
  };
}

/** Texto do indicador do Git: o worktree nasce ao iniciar a missão, e push e merge pedem aprovação. */
function gitIndicator(hasWorktree: boolean): Indicator {
  return hasWorktree
    ? { label: 'Git', value: 'Worktree criado', note: 'Push e merge exigem a sua aprovação.' }
    : { label: 'Git', value: 'Não criado', note: 'O worktree nasce ao iniciar a missão.' };
}

/**
 * Fecho da missão concluída (R130): a frase final do agente e o estado do Git ao concluir, numa caixa
 * discreta abaixo dos indicadores. A verificação e os arquivos alterados já aparecem nos indicadores,
 * então não se repetem aqui. A frase vem do agente e entra como texto, nunca como HTML.
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

/** Tempo em que o aviso "Copiado" fica na tela. */
const COPY_FEEDBACK_MS = 2500;

/** Texto do aviso quando a área de transferência recusa a cópia. */
const COPY_ERROR = 'Não foi possível copiar o caminho.';

type CopyState = 'idle' | 'copied';

/**
 * O worktree na linha do resumo: o nome curto (a última pasta) e o botão que copia o caminho inteiro
 * para a área de transferência. O "Copiado" aparece ao lado, numa região `aria-live` que fica montada
 * para o leitor de tela anunciar a mudança; a falha sai pelo aviso (`notify.error`).
 */
function WorktreeMeta({ path }: { path: string | undefined }) {
  const [copy, setCopy] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (path === undefined) {
    return <span className="mission-meta__item">worktree ainda não criado</span>;
  }

  async function copyPath(fullPath: string) {
    let next: CopyState;
    try {
      await navigator.clipboard.writeText(fullPath);
      next = 'copied';
    } catch {
      next = 'idle';
      notify.error(COPY_ERROR);
    }
    setCopy(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopy('idle'), COPY_FEEDBACK_MS);
  }

  return (
    <span className="mission-meta__item">
      worktree{' '}
      <span className="mission-meta__path" title={path}>
        {worktreeName(path)}
      </span>
      <button type="button" className="mission-meta__copy" onClick={() => void copyPath(path)}>
        Copiar caminho
      </button>
      <span aria-live="polite" className="mission-meta__feedback">
        {copy === 'copied' ? 'Copiado' : ''}
      </span>
    </span>
  );
}

/**
 * Resumo fixo no topo da página da missão (seção 10.7): o projeto (link), o título, a linha com a
 * situação (chip com texto e cor), a branch e o nome curto do worktree, a ação principal que a situação
 * permite, as ações secundárias (pausar, cancelar ou excluir) em botões discretos e três indicadores
 * (verificação, arquivos alterados e Git). Com a missão concluída, mostra também o fecho da conclusão
 * (a frase final do agente e o estado do Git), sem ação principal. Este componente só mostra e chama o
 * que a página passa: o comportamento das ações fica na página.
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
    changedFilesIndicator(hasWorktree, diff),
    gitIndicator(hasWorktree),
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
      <div className="mission-summary__head">
        <div className="mission-summary__title">
          <p className="eyebrow mission-summary__project">
            <Link to={projectPath(project.id)}>{project.name}</Link>
          </p>
          <h1>{mission.title}</h1>
          <div className="mission-meta">
            <StatusChip label={statusLabel(mission.status)} tone={tone} />
            <span className="mission-meta__item">branch {project.defaultBranch ?? 'sem Git'}</span>
            <WorktreeMeta path={mission.worktreePath} />
          </div>
        </div>
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
              <button type="button" disabled={controlBusy} onClick={onPause}>
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
              <button type="button" disabled={controlBusy} onClick={onCancel}>
                Cancelar missão
              </button>
            )}
          </div>
        </div>
      </div>
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
      {mission.status === 'succeeded' && conclusion !== undefined ? (
        <ConclusionSummary conclusion={conclusion} />
      ) : null}
    </section>
  );
}
