import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { MissionViewDto } from '@project-hub/contracts';
import {
  MISSION_TEXT,
  isEnded,
  statusIcon,
  statusLabel,
  statusTone,
  worktreeName,
} from '../../mission-text';
import { notify } from '../../notify';
import { projectViewPath } from '../../routes';
import { ConfirmInline } from '../ConfirmButton';
import { Copy, ICON_PROPS } from '../Icon';
import { MenuAcoes, type AcaoMenu } from '../MenuAcoes';
import { StatusChip } from '../StatusChip';

/** O que a pessoa lê antes de confirmar a exclusão. */
const DELETE_QUESTION =
  'Excluir esta missão? O plano, as tentativas e o histórico saem do app. Não dá para desfazer.';

/**
 * Fecho da missão concluída (R130): a frase final do agente e o estado do Git ao concluir, numa caixa
 * discreta abaixo do cabeçalho. A verificação e os arquivos alterados já aparecem nos indicadores,
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

  if (path === undefined) return null;

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
    <div ref={root} className="mission-head__secondary">
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
 * Cabeçalho da missão (seção 10.7), no formato do protótipo: o "← Missões" que volta à lista, a linha
 * "MISSÃO · {PROJETO}", o título, o objetivo em linha menor, o selo da situação (chip com texto e cor) e
 * "Mais ações" (pausar, cancelar ou excluir). Com o worktree criado, mostra o nome curto dele e o botão
 * que copia o caminho. Com a missão concluída, mostra também o fecho da conclusão (a frase final do agente
 * e o estado do Git). A ação principal fica no bloco "Sua decisão". Este componente só mostra e chama o que
 * a página passa: o comportamento das ações fica na página.
 */
export function MissionSummary({
  mission,
  project,
  conclusion,
  controlBusy,
  onPause,
  onCancel,
  onDelete,
}: {
  mission: MissionViewDto['mission'];
  project: MissionViewDto['project'];
  /** Resumo de conclusão. Só aparece com a missão concluída; cancelada ou com falha não tem resumo. */
  conclusion?: MissionViewDto['conclusion'];
  /** Pausar, retomar, cancelar e excluir: cada uma só cobre a própria chamada. */
  controlBusy: boolean;
  onPause: () => void;
  onCancel: () => void;
  /** Exclui a missão encerrada. Só chama depois que a pessoa confirma. */
  onDelete: () => void;
}) {
  const tone = statusTone(mission.status);

  return (
    <section aria-label="Resumo da missão" className="mission-head">
      <Link to={projectViewPath(project.id, 'missoes')} className="mission-head__back">
        {MISSION_TEXT.backToMissions}
      </Link>
      <div className="mission-head__row">
        <div className="mission-head__title">
          <p className="eyebrow">{MISSION_TEXT.eyebrow(project.name)}</p>
          <h1>{mission.title}</h1>
          <p className="mission-head__objective">{mission.objective}</p>
        </div>
        <div className="mission-head__actions">
          <StatusChip
            label={statusLabel(mission.status)}
            tone={tone}
            icon={statusIcon(mission.status)}
          />
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
      {mission.worktreePath === undefined ? null : (
        <p className="mission-meta">
          <WorktreeMeta path={mission.worktreePath} />
        </p>
      )}
      {(mission.status === 'review' || mission.status === 'succeeded') &&
      conclusion !== undefined ? (
        <ConclusionSummary conclusion={conclusion} />
      ) : null}
    </section>
  );
}
