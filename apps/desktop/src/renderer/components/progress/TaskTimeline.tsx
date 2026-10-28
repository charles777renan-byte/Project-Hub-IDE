import type { MissionStepDto } from '@project-hub/contracts';
import { agentLabel, dependencyText, roleLabel, stepStatus } from '../../mission-text';
import { buildTimeline, type ProgressMission, type Timeline } from '../../progress-data';
import { PROGRESS_TEXT } from '../../progress-text';
import {
  CircleAlert,
  CircleCheck,
  Clock,
  ICON_PROPS,
  LoaderCircle,
  type LucideIcon,
} from '../Icon';

/**
 * Linha do tempo das tarefas de uma missão: uma tabela, uma linha por tarefa, com o estado (ícone com
 * nome acessível), o título, "depois de N", papel e programa, a barra no tempo e a duração. A tarefa
 * que ainda não começou mostra "na fila", sem barra. A missão em execução ganha a linha do "agora".
 *
 * As barras são SVG sem `viewBox`: posição e largura vão nos atributos `x` e `width` em porcentagem,
 * nunca em `style` (CSP). A cor vem só de classe (`progress-bar--estado`).
 */

const BAR_HEIGHT = 14;
const AXIS_HEIGHT = 16;
/** Marcas do eixo a partir daqui alinham o texto pela ponta final, para não cortar na borda. */
const AXIS_END_FROM = 90;

const STATE_ICON: Record<MissionStepDto['status'], LucideIcon> = {
  succeeded: CircleCheck,
  running: LoaderCircle,
  failed: CircleAlert,
  pending: Clock,
  blocked: Clock,
  skipped: Clock,
};

/** Porcentagem com até 2 casas, como texto de atributo SVG. */
function percent(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

/** Cor da barra por classe; estados sem cor própria ficam só com o contorno base. */
function barClass(status: MissionStepDto['status']): string {
  return status === 'succeeded' || status === 'running' || status === 'failed'
    ? `progress-bar progress-bar--${status}`
    : 'progress-bar';
}

/** A tarefa ainda não começou: não tem barra, mesmo que reste um horário de tentativa anterior. */
function isQueued(task: MissionStepDto): boolean {
  return task.status === 'pending' || task.status === 'blocked';
}

function TaskState({ task }: { task: MissionStepDto }) {
  const Icon = STATE_ICON[task.status];
  const modifier = task.status === 'running' || task.status === 'failed' ? task.status : undefined;
  return (
    <span
      className={
        modifier === undefined ? 'progress-state' : `progress-state progress-state--${modifier}`
      }
    >
      <span role="img" aria-label={stepStatus(task.status).label}>
        <Icon {...ICON_PROPS} />
      </span>
      <span>{task.title}</span>
    </span>
  );
}

function TimeCell({ task, timeline }: { task: MissionStepDto; timeline: Timeline }) {
  const bar = timeline.bars[task.id];
  if (isQueued(task)) {
    return <span className="progress-queued">{PROGRESS_TEXT.queued}</span>;
  }
  if (bar === undefined) {
    return <span aria-hidden="true">{PROGRESS_TEXT.noTime}</span>;
  }
  return (
    <>
      <svg width="100%" height={BAR_HEIGHT} aria-hidden="true" focusable="false">
        <rect
          x={percent(bar.left)}
          width={percent(bar.width)}
          height={BAR_HEIGHT}
          className={barClass(task.status)}
        />
        {timeline.nowLeft === undefined ? null : (
          <line
            x1={percent(timeline.nowLeft)}
            x2={percent(timeline.nowLeft)}
            y1={0}
            y2={BAR_HEIGHT}
            className="progress-now"
          />
        )}
      </svg>
      <span className="progress-table__duration">{timeline.durations[task.id]}</span>
    </>
  );
}

function TimeAxis({ timeline }: { timeline: Timeline }) {
  if (timeline.ticks.length === 0) return null;
  return (
    <svg width="100%" height={AXIS_HEIGHT} aria-hidden="true" focusable="false">
      {timeline.ticks.map((tick) => (
        <text
          key={tick.label}
          x={percent(tick.left)}
          y={AXIS_HEIGHT - 4}
          textAnchor={tick.left <= 0 ? 'start' : tick.left >= AXIS_END_FROM ? 'end' : 'middle'}
          className="progress-axis"
        >
          {tick.label}
        </text>
      ))}
    </svg>
  );
}

export function TaskTimeline({ item, now }: { item: ProgressMission; now: Date }) {
  const { mission, tasks } = item;
  const timeline = buildTimeline(tasks, {
    now,
    missionRunning: mission.status === 'running',
    fallbackEnd: mission.finishedAt ?? mission.updatedAt,
  });
  return (
    <table className="progress-table">
      <caption>{PROGRESS_TEXT.tasksOf(mission.title)}</caption>
      <thead>
        <tr>
          <th scope="col" className="progress-table__task">
            {PROGRESS_TEXT.columns.task}
          </th>
          <th scope="col" className="progress-table__role">
            {PROGRESS_TEXT.columns.role}
          </th>
          <th scope="col" className="progress-table__time">
            {PROGRESS_TEXT.columns.time}
            <TimeAxis timeline={timeline} />
          </th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => {
          const after = dependencyText(task, tasks);
          return (
            <tr key={task.id}>
              <td className="progress-table__task">
                <TaskState task={task} />
                {after === undefined ? null : (
                  <>
                    {' '}
                    <span className="progress-table__after">{after}</span>
                  </>
                )}
              </td>
              <td className="progress-table__role">
                {`${roleLabel(task.role) ?? ''} · ${agentLabel(task.agent)}`}
              </td>
              <td className="progress-table__time">
                <TimeCell task={task} timeline={timeline} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
