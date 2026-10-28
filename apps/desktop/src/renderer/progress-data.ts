import type { MissionDto, MissionStepDto, MissionViewDto } from '@project-hub/contracts';
import { isSameDay } from 'date-fns';
import { isEnded, needsAttention } from './mission-text';

/**
 * Dados puros da aba Progresso: agrupamento das missões, linha do tempo das tarefas e feed de
 * atividade. Sem React e sem acesso ao relógio: quem chama passa `now`.
 */

const MINUTE = 60_000;

/** Grupos da aba, na ordem em que aparecem na tela. */
export type ProgressGroup = 'running' | 'attention' | 'failed' | 'done';
export const PROGRESS_GROUPS: readonly ProgressGroup[] = ['running', 'attention', 'failed', 'done'];

/** Instante de uma data em texto, ou `undefined` quando falta ou não é uma data válida. */
function timeOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Grupo da missão na aba, ou `undefined` quando ela não entra (rascunho, cancelada, concluída antes de
 * hoje). "Hoje" é o dia local de `now`.
 */
export function groupOf(mission: MissionDto, now: Date): ProgressGroup | undefined {
  const { status } = mission;
  if (needsAttention(status)) return 'attention';
  if (isEnded(status)) {
    if (status === 'failed') return 'failed';
    if (status === 'cancelled') return undefined;
    const finished = timeOf(mission.finishedAt);
    return finished !== undefined && isSameDay(new Date(finished), now) ? 'done' : undefined;
  }
  return status === 'running' || status === 'paused' || status === 'queued' ? 'running' : undefined;
}

export type ProgressMission = {
  mission: MissionDto;
  group: ProgressGroup;
  /** Só as etapas com papel, na ordem de `position`; vazio quando a leitura da missão falhou. */
  tasks: MissionStepDto[];
  /** Tarefas `succeeded`. */
  done: number;
  /** `tasks.length`. */
  total: number;
  /** A tarefa `running`; senão a `failed`; senão `undefined`. */
  current: MissionStepDto | undefined;
};

export function toProgressMission(
  mission: MissionDto,
  view: MissionViewDto | undefined,
  now: Date,
): ProgressMission | undefined {
  const group = groupOf(mission, now);
  if (group === undefined) return undefined;
  const tasks = (view?.steps ?? [])
    .filter((step) => step.role !== undefined)
    .sort((a, b) => a.position - b.position);
  return {
    mission,
    group,
    tasks,
    done: tasks.filter((task) => task.status === 'succeeded').length,
    total: tasks.length,
    current:
      tasks.find((task) => task.status === 'running') ??
      tasks.find((task) => task.status === 'failed'),
  };
}

export function countByGroup(items: readonly ProgressMission[]): Record<ProgressGroup, number> {
  const counts: Record<ProgressGroup, number> = { running: 0, attention: 0, failed: 0, done: 0 };
  for (const item of items) counts[item.group] += 1;
  return counts;
}

/** Tarefas em execução agora, somadas entre as missões. */
export function runningTaskCount(items: readonly ProgressMission[]): number {
  let count = 0;
  for (const item of items) {
    for (const task of item.tasks) if (task.status === 'running') count += 1;
  }
  return count;
}

/** Tarefas das missões concluídas hoje e o tempo somado das que têm início e fim válidos. */
export function doneTodaySummary(items: readonly ProgressMission[]): { tasks: number; ms: number } {
  let tasks = 0;
  let ms = 0;
  for (const item of items) {
    if (item.group !== 'done') continue;
    tasks += item.tasks.length;
    for (const task of item.tasks) {
      const started = timeOf(task.startedAt);
      const finished = timeOf(task.finishedAt);
      if (started !== undefined && finished !== undefined) ms += Math.max(0, finished - started);
    }
  }
  return { tasks, ms };
}

/** Duração de uma tarefa: `42 s`, `8 min` ou `1 h 05 min`; com reticências quando ainda corre. */
export function formatTaskDuration(ms: number, running: boolean): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  let text: string;
  if (safe < MINUTE) {
    text = `${Math.floor(safe / 1000)} s`;
  } else if (safe < 60 * MINUTE) {
    text = `${Math.floor(safe / MINUTE)} min`;
  } else {
    const minutes = Math.floor(safe / MINUTE);
    text = `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
  }
  return running ? `${text}…` : text;
}

/** Posição e largura de uma barra, em porcentagem (0 a 100) do eixo. */
export type TaskBar = { left: number; width: number };

export type Timeline = {
  ticks: { label: string; left: number }[];
  /** Posição do "agora"; só com a missão rodando. */
  nowLeft: number | undefined;
  /** Por id da tarefa; só quem tem `startedAt` válido. */
  bars: Record<string, TaskBar | undefined>;
  /** Por id da tarefa; só quem tem barra. */
  durations: Record<string, string | undefined>;
};

const MIN_BAR_WIDTH = 1.5;
const MIN_SPAN = 5 * MINUTE;
const SPAN_PADDING = 1.1;
const MAX_TICKS = 6;
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60];

function tickLabel(minutes: number): string {
  if (minutes < 60) return String(minutes);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

/** Menor passo (em minutos) que cabe em no máximo `MAX_TICKS` marcas dentro de `spanMinutes`. */
function tickStep(spanMinutes: number): number {
  for (const step of TICK_STEPS) {
    if (Math.floor(spanMinutes / step) + 1 <= MAX_TICKS) return step;
  }
  // Mais de cinco horas: segue em múltiplos de hora.
  let step = 120;
  while (Math.floor(spanMinutes / step) + 1 > MAX_TICKS) step += 60;
  return step;
}

/**
 * Barras no tempo das tarefas de uma missão. O eixo começa no menor `startedAt` válido. O fim de cada
 * tarefa é o `finishedAt` válido; senão `now` (tarefa em execução com a missão rodando); senão
 * `fallbackEnd`. Datas inválidas ou invertidas nunca geram NaN nem sobram fora de 0 a 100.
 */
export function buildTimeline(
  tasks: readonly MissionStepDto[],
  options: { now: Date; missionRunning: boolean; fallbackEnd: string },
): Timeline {
  const nowMs = options.now.getTime();
  const nowTime = Number.isFinite(nowMs) ? nowMs : undefined;
  const fallbackTime = timeOf(options.fallbackEnd);
  const missionRunning = options.missionRunning && nowTime !== undefined;

  const starts = new Map<string, number>();
  for (const task of tasks) {
    const started = timeOf(task.startedAt);
    if (started !== undefined) starts.set(task.id, started);
  }
  if (starts.size === 0) return { ticks: [], nowLeft: undefined, bars: {}, durations: {} };

  const origin = Math.min(...starts.values());
  const ends = new Map<string, { end: number; live: boolean }>();
  let maxEnd = origin;
  for (const task of tasks) {
    const started = starts.get(task.id);
    if (started === undefined) continue;
    const finished = timeOf(task.finishedAt);
    let end: number;
    let live = false;
    if (finished !== undefined) {
      end = finished;
    } else if (task.status === 'running' && missionRunning && nowTime !== undefined) {
      end = nowTime;
      live = true;
    } else {
      end = fallbackTime ?? started;
    }
    end = Math.max(end, started);
    ends.set(task.id, { end, live });
    maxEnd = Math.max(maxEnd, end);
  }
  if (missionRunning && nowTime !== undefined) maxEnd = Math.max(maxEnd, nowTime);

  const span = Math.max(maxEnd - origin, MIN_SPAN) * SPAN_PADDING;
  const percent = (time: number): number => clamp(((time - origin) / span) * 100, 0, 100);

  const bars: Record<string, TaskBar | undefined> = {};
  const durations: Record<string, string | undefined> = {};
  for (const task of tasks) {
    const started = starts.get(task.id);
    const range = ends.get(task.id);
    if (started === undefined || range === undefined) continue;
    const width = Math.max(percent(range.end) - percent(started), MIN_BAR_WIDTH);
    const left = Math.min(percent(started), 100 - width);
    bars[task.id] = { left, width };
    durations[task.id] = formatTaskDuration(range.end - started, range.live);
  }

  const spanMinutes = span / MINUTE;
  const stepMinutes = tickStep(spanMinutes);
  const ticks: Timeline['ticks'] = [];
  for (
    let minutes = 0;
    minutes <= spanMinutes && ticks.length < MAX_TICKS;
    minutes += stepMinutes
  ) {
    ticks.push({ label: tickLabel(minutes), left: clamp((minutes / spanMinutes) * 100, 0, 100) });
  }

  return {
    ticks,
    nowLeft: missionRunning && nowTime !== undefined ? percent(nowTime) : undefined,
    bars,
    durations,
  };
}

export type FeedItem = {
  id: string;
  at: string;
  kind: 'started' | 'succeeded' | 'failed' | 'plan';
  missionTitle: string;
  taskTitle?: string;
};

/**
 * Atividade recente do projeto: tarefa começou, terminou, falhou e plano pronto, do mais novo para o
 * mais antigo, até `limit` itens. Etapa sem papel e data inválida não geram item.
 */
export function activityFeed(views: readonly MissionViewDto[], limit: number): FeedItem[] {
  const entries: { item: FeedItem; time: number }[] = [];
  const push = (item: FeedItem): void => {
    const time = timeOf(item.at);
    if (time !== undefined) entries.push({ item, time });
  };
  for (const view of views) {
    const missionTitle = view.mission.title;
    const steps = view.steps
      .filter((step) => step.role !== undefined)
      .sort((a, b) => a.position - b.position);
    for (const step of steps) {
      if (step.startedAt !== undefined) {
        push({
          id: `${step.id}:started`,
          at: step.startedAt,
          kind: 'started',
          missionTitle,
          taskTitle: step.title,
        });
      }
      if (
        step.finishedAt !== undefined &&
        (step.status === 'succeeded' || step.status === 'failed')
      ) {
        push({
          id: `${step.id}:${step.status}`,
          at: step.finishedAt,
          kind: step.status,
          missionTitle,
          taskTitle: step.title,
        });
      }
    }
    for (const event of view.events) {
      if (event.eventType === 'plan.generated') {
        push({ id: event.id, at: event.createdAt, kind: 'plan', missionTitle });
      }
    }
  }
  // `sort` é estável: em empate vale a ordem em que os itens foram gerados.
  return entries
    .sort((a, b) => b.time - a.time)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.item);
}
