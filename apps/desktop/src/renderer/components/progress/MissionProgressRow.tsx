import { useId } from 'react';
import { Link } from 'react-router';
import type { MissionStepDto } from '@project-hub/contracts';
import {
  agentLabel,
  boardStatusLabel,
  formatTime,
  requiredActionOf,
  roleLabel,
} from '../../mission-text';
import type { ProgressMission } from '../../progress-data';
import { PROGRESS_TEXT } from '../../progress-text';
import { missionPath } from '../../routes';
import { ChevronDown, ChevronRight, ICON_PROPS } from '../Icon';
import { TaskTimeline } from './TaskTimeline';

/**
 * Linha de uma missão na aba Progresso: o botão que expande (título e frase do estado), a barra de
 * segmentos com "N de M" e o link para a missão. A linha do tempo das tarefas aparece só expandida.
 * Nenhuma ação além do link: aprovar, tentar de novo e decidir ficam na tela da missão.
 */

/** Classe do segmento: estados sem cor própria (bloqueada, ignorada) valem como pendente. */
function segmentState(status: MissionStepDto['status']): string {
  return status === 'succeeded' || status === 'running' || status === 'failed' ? status : 'pending';
}

/** A frase do estado, por grupo; sem a tarefa que ela cita, vale o estado da missão. */
function statePhrase(item: ProgressMission): string {
  const { mission, group, tasks, current } = item;
  const fallback = boardStatusLabel(mission.status);
  if (tasks.length === 0) return fallback;
  switch (group) {
    case 'running':
      return current?.status === 'running'
        ? PROGRESS_TEXT.runningTask(roleLabel(current.role) ?? '', agentLabel(current.agent))
        : fallback;
    case 'failed': {
      const failed = tasks.find((task) => task.status === 'failed');
      return failed === undefined
        ? fallback
        : PROGRESS_TEXT.failedTask(failed.position, failed.title);
    }
    case 'attention':
      return requiredActionOf(mission.status) ?? fallback;
    case 'done':
      return PROGRESS_TEXT.finishedAt(
        mission.finishedAt === undefined ? undefined : formatTime(mission.finishedAt),
      );
  }
}

export function MissionProgressRow({
  item,
  projectId,
  expanded,
  onToggle,
  now,
}: {
  item: ProgressMission;
  projectId: string;
  expanded: boolean;
  onToggle: () => void;
  now: Date;
}) {
  const timelineId = useId();
  const { mission, group, tasks, done, total } = item;
  const hasTasks = tasks.length > 0;
  const open = expanded && hasTasks;
  const action = group === 'attention' ? requiredActionOf(mission.status) : undefined;
  const linkText = action ?? PROGRESS_TEXT.openMission;
  const running = tasks.some((task) => task.status === 'running');
  const Chevron = open ? ChevronDown : ChevronRight;
  const stateClass =
    group === 'attention' || group === 'failed'
      ? `progress-row__state progress-row__state--${group}`
      : 'progress-row__state';
  const rowClass =
    group === 'attention' || group === 'failed'
      ? `progress-row progress-row--${group}`
      : 'progress-row';

  return (
    <div className={rowClass}>
      <div className="progress-row__head">
        <button
          type="button"
          className="progress-row__toggle"
          aria-expanded={open}
          aria-controls={timelineId}
          disabled={!hasTasks}
          onClick={onToggle}
        >
          <Chevron {...ICON_PROPS} />
          <span className="progress-row__text">
            <span className="progress-row__title">{mission.title}</span>
            <span className={stateClass}>{statePhrase(item)}</span>
          </span>
        </button>
        {hasTasks ? (
          <div className="progress-row__meter">
            <span
              className="progress-segs"
              role="img"
              aria-label={PROGRESS_TEXT.segmentsLabel(done, total, running)}
            >
              {tasks.map((task) => (
                <span
                  key={task.id}
                  className={`progress-seg progress-seg--${segmentState(task.status)}`}
                />
              ))}
            </span>
            <span className="progress-row__count" aria-hidden="true">
              {PROGRESS_TEXT.countOf(done, total)}
            </span>
          </div>
        ) : null}
        <Link
          to={missionPath(projectId, mission.id)}
          className="progress-row__link"
          aria-label={PROGRESS_TEXT.linkLabel(linkText, mission.title)}
        >
          {linkText}
        </Link>
      </div>
      {open ? (
        <div id={timelineId} className="progress-row__body">
          <TaskTimeline item={item} now={now} />
        </div>
      ) : null}
    </div>
  );
}
