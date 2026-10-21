import { Link } from 'react-router';
import type { MissionViewDto } from '@project-hub/contracts';
import {
  MISSION_TEXT,
  canRetry,
  isEnded,
  needsDecisionInConversation,
  statusLabel,
  statusTone,
} from '../../mission-text';
import { projectPath } from '../../routes';
import { StatusChip } from '../StatusChip';

/**
 * Cabeçalho do workspace da missão (seção 10.7): o projeto, o título, a situação, as ações (pausar,
 * retomar, tentar de novo e cancelar), o aviso de decisão pendente e a linha projeto · branch ·
 * worktree. Este componente só mostra e chama o que a página passa: o comportamento das ações fica na
 * página.
 */
export function MissionHeader({
  mission,
  project,
  busy,
  controlBusy,
  onPause,
  onResume,
  onRetry,
  onCancel,
  onOpenDecision,
}: {
  mission: MissionViewDto['mission'];
  project: MissionViewDto['project'];
  /** Chamadas longas (nova tentativa): desabilitam Tentar de novo. */
  busy: boolean;
  /** Pausar, retomar e cancelar: cada uma só cobre a própria chamada. */
  controlBusy: boolean;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onCancel: () => void;
  /** Leva o foco ao painel Conversa, onde a decisão é tomada. */
  onOpenDecision: () => void;
}) {
  return (
    <>
      <p className="eyebrow">
        <Link to={projectPath(project.id)}>{project.name}</Link>
      </p>
      <header className="mission-header">
        <h1>{mission.title}</h1>
        <div className="inline-actions">
          <StatusChip label={statusLabel(mission.status)} tone={statusTone(mission.status)} />
          {mission.status === 'running' ? (
            <button type="button" className="btn-pause" disabled={controlBusy} onClick={onPause}>
              {MISSION_TEXT.pause}
            </button>
          ) : null}
          {mission.status === 'paused' ? (
            <button type="button" className="btn-primary" disabled={controlBusy} onClick={onResume}>
              {MISSION_TEXT.resume}
            </button>
          ) : null}
          {canRetry(mission.status) ? (
            <button type="button" className="btn-primary" disabled={busy} onClick={onRetry}>
              {MISSION_TEXT.retry}
            </button>
          ) : null}
          {isEnded(mission.status) ? null : (
            <button type="button" className="btn-danger" disabled={controlBusy} onClick={onCancel}>
              Cancelar missão
            </button>
          )}
        </div>
        {needsDecisionInConversation(mission.status) ? (
          <p className="mission-notice">
            <StatusChip label={MISSION_TEXT.decisionNotice} tone="violet" />
            <button type="button" className="btn-link" onClick={onOpenDecision}>
              {MISSION_TEXT.decisionLink}
            </button>
          </p>
        ) : null}
        <p className="mission-meta">
          {project.name} · branch {project.defaultBranch ?? 'sem Git'} · worktree{' '}
          {mission.worktreePath ?? 'ainda não criado'}
        </p>
      </header>
    </>
  );
}
