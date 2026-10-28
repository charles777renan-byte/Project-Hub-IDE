import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { MissionViewDto } from '@project-hub/contracts';
import {
  MISSION_TEXT,
  PLAN_TEXT,
  isEnded,
  primaryActionOf,
  statusIcon,
  statusLabel,
  statusTone,
  verificationSummary,
  worktreeName,
  type PrimaryAction,
} from '../../mission-text';
import { notify } from '../../notify';
import { projectPath } from '../../routes';
import { ConfirmInline } from '../ConfirmButton';
import { Copy, ICON_PROPS } from '../Icon';
import { MenuAcoes, type AcaoMenu } from '../MenuAcoes';
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

/** O que a pessoa lê antes de confirmar a exclusão. */
const DELETE_QUESTION =
  'Excluir esta missão? O plano, as tentativas e o histórico saem do app. Não dá para desfazer.';

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
    try {
      await navigator.clipboard.writeText(fullPath);
    } catch {
      // A falha sai pelo aviso; o "Copiado" não entra e não há prazo a agendar.
      notify.error(COPY_ERROR);
      return;
    }
    setCopy('copied');
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
        <Copy {...ICON_PROPS} />
        Copiar caminho
      </button>
      <span aria-live="polite" className="mission-meta__feedback">
        {copy === 'copied' ? 'Copiado' : ''}
      </span>
    </span>
  );
}

/**
 * Pausar, cancelar e excluir, no menu "Mais ações", com as mesmas condições de antes: Pausar só com a
 * missão em execução, Excluir só com ela encerrada, Cancelar no resto.
 *
 * Excluir pede confirmação. Escolher o item fecha o menu e o desmonta, então a pergunta vive aqui, fora
 * dele, no lugar do botão. O chamador põe uma `key` que muda quando a missão entra ou sai do estado
 * encerrado: a pergunta aberta não sobrevive a uma nova tentativa (como o `ConfirmButton`, que sumia junto
 * com o botão) e não reaparece sozinha quando a missão falhar de novo.
 */
function SecondaryActions({
  status,
  controlBusy,
  onPause,
  onCancel,
  onDelete,
}: {
  status: MissionViewDto['mission']['status'];
  controlBusy: boolean;
  onPause: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const ended = isEnded(status);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);
  // Fechada a pergunta (Voltar ou confirmar), o foco volta ao botão do menu, que reaparece no lugar dela.
  useEffect(() => {
    if (!confirmingDelete && returnFocus.current) {
      returnFocus.current = false;
      root.current?.querySelector('button')?.focus();
    }
  }, [confirmingDelete]);
  const closeQuestion = (then?: () => void) => {
    returnFocus.current = true;
    setConfirmingDelete(false);
    then?.();
  };

  const actions: AcaoMenu[] = [];
  if (status === 'running') {
    actions.push({ rotulo: MISSION_TEXT.pause, onSelecionar: onPause, desabilitada: controlBusy });
  }
  if (ended) {
    actions.push({
      rotulo: 'Excluir missão',
      onSelecionar: () => setConfirmingDelete(true),
      perigosa: true,
      desabilitada: controlBusy,
    });
  } else {
    actions.push({
      rotulo: 'Cancelar missão',
      onSelecionar: onCancel,
      desabilitada: controlBusy,
    });
  }

  return (
    <div ref={root} className="mission-summary__secondary">
      {confirmingDelete ? (
        <ConfirmInline
          question={DELETE_QUESTION}
          confirmLabel="Excluir"
          disabled={controlBusy}
          focusBack
          onConfirm={() => closeQuestion(onDelete)}
          onCancel={() => closeQuestion()}
        />
      ) : (
        <MenuAcoes rotulo="Mais ações" acoes={actions} />
      )}
    </div>
  );
}

/**
 * Resumo fixo no topo da página da missão (seção 10.7): o projeto (link), o título, a linha com a
 * situação (chip com texto e cor), a branch e o nome curto do worktree, a ação principal que a situação
 * permite, as ações secundárias (pausar, cancelar ou excluir) no menu "Mais ações" e três indicadores
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
  planning = false,
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
  /** O planejamento em curso (pode levar minutos): o Orquestrar mostra "Planejando…". */
  planning?: boolean;
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
  const quotaId = useId();
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
            <StatusChip
              label={statusLabel(mission.status)}
              tone={tone}
              icon={statusIcon(mission.status)}
            />
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
              aria-describedby={primary === 'generate_plan' ? quotaId : undefined}
              disabled={primaryAction[primary].disabled}
              onClick={primaryAction[primary].run}
            >
              {primary === 'generate_plan' && planning
                ? PLAN_TEXT.planning
                : PRIMARY_LABEL[primary]}
            </button>
          )}
          {primary === 'generate_plan' ? (
            <p id={quotaId} className="plan-quota mission-summary__quota">
              {PLAN_TEXT.quotaWarning}
            </p>
          ) : null}
          <SecondaryActions
            key={isEnded(mission.status) ? 'ended' : 'open'}
            status={mission.status}
            controlBusy={controlBusy}
            onPause={onPause}
            onCancel={onCancel}
            onDelete={onDelete}
          />
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
      {(mission.status === 'review' || mission.status === 'succeeded') &&
      conclusion !== undefined ? (
        <ConclusionSummary conclusion={conclusion} />
      ) : null}
    </section>
  );
}
