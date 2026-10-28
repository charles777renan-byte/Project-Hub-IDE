import { describe, expect, it } from 'vitest';
import type {
  MissionDto,
  MissionEventDto,
  MissionStepDto,
  MissionViewDto,
} from '@project-hub/contracts';
import {
  PROGRESS_GROUPS,
  activityFeed,
  buildTimeline,
  countByGroup,
  doneTodaySummary,
  formatTaskDuration,
  groupOf,
  runningTaskCount,
  toProgressMission,
  type ProgressMission,
} from '../../src/renderer/progress-data';

const MIN = 60_000;
const BASE = Date.parse('2026-10-28T12:00:00.000Z');
const at = (minutes: number): string => new Date(BASE + minutes * MIN).toISOString();
const NOW = new Date(at(19));

function mission(overrides: Partial<MissionDto> = {}): MissionDto {
  return {
    id: 'm1',
    projectId: 'p1',
    title: 'Missão',
    objective: 'Objetivo',
    status: 'running',
    altersCode: true,
    acceptanceCriteria: [],
    createdAt: at(-60),
    updatedAt: at(0),
    ...overrides,
  };
}

function step(id: string, overrides: Partial<MissionStepDto> = {}): MissionStepDto {
  return {
    id,
    position: 0,
    title: `Tarefa ${id}`,
    status: 'pending',
    agent: 'claude-code',
    role: 'general',
    ...overrides,
  };
}

function view(
  steps: MissionStepDto[],
  events: MissionEventDto[] = [],
  missionOverrides: Partial<MissionDto> = {},
): MissionViewDto {
  return {
    mission: mission(missionOverrides),
    project: { id: 'p1', name: 'Projeto', path: '/p' },
    steps,
    executions: [],
    pendingApprovals: [],
    events,
  };
}

function event(id: string, eventType: string, createdAt: string): MissionEventDto {
  return {
    id,
    missionId: 'm1',
    aggregateType: 'mission',
    aggregateId: 'm1',
    eventType,
    severity: 'info',
    actor: 'system',
    payload: {},
    sequence: 1,
    createdAt,
  };
}

function item(group: ProgressMission['group'], tasks: MissionStepDto[], id = 'm'): ProgressMission {
  return {
    mission: mission({ id }),
    group,
    tasks,
    done: tasks.filter((t) => t.status === 'succeeded').length,
    total: tasks.length,
    current: undefined,
  };
}

const EMPTY_TIMELINE = { ticks: [], nowLeft: undefined, bars: {}, durations: {} };

describe('PROGRESS_GROUPS', () => {
  it('lista os grupos na ordem da tela', () => {
    expect(PROGRESS_GROUPS).toEqual(['running', 'attention', 'failed', 'done']);
  });
});

describe('groupOf', () => {
  it.each(['running', 'paused', 'queued'] as const)('%s fica em andamento', (status) => {
    expect(groupOf(mission({ status }), NOW)).toBe('running');
  });

  it.each(['planned', 'waiting_approval', 'waiting_input', 'review'] as const)(
    '%s precisa de você',
    (status) => {
      expect(groupOf(mission({ status }), NOW)).toBe('attention');
    },
  );

  it('failed fica em falharam', () => {
    expect(groupOf(mission({ status: 'failed' }), NOW)).toBe('failed');
  });

  it('succeeded concluída no dia local de agora fica em concluídas hoje', () => {
    const now = new Date(2026, 9, 28, 15, 0, 0);
    const finishedAt = new Date(2026, 9, 28, 9, 0, 0).toISOString();
    expect(groupOf(mission({ status: 'succeeded', finishedAt }), now)).toBe('done');
  });

  it('succeeded concluída ontem fica fora', () => {
    const now = new Date(2026, 9, 28, 15, 0, 0);
    const finishedAt = new Date(2026, 9, 27, 23, 0, 0).toISOString();
    expect(groupOf(mission({ status: 'succeeded', finishedAt }), now)).toBeUndefined();
  });

  it('succeeded sem finishedAt ou com data inválida fica fora', () => {
    expect(groupOf(mission({ status: 'succeeded' }), NOW)).toBeUndefined();
    expect(groupOf(mission({ status: 'succeeded', finishedAt: 'lixo' }), NOW)).toBeUndefined();
  });

  it('draft e cancelled ficam fora', () => {
    expect(groupOf(mission({ status: 'draft' }), NOW)).toBeUndefined();
    expect(groupOf(mission({ status: 'cancelled' }), NOW)).toBeUndefined();
  });
});

describe('toProgressMission', () => {
  it('ignora etapas sem papel e conta só tarefas', () => {
    const result = toProgressMission(
      mission(),
      view([
        step('a', { position: 0, status: 'succeeded' }),
        step('b', { position: 1, role: undefined }),
        step('c', { position: 2, status: 'running' }),
      ]),
      NOW,
    );
    expect(result?.tasks.map((t) => t.id)).toEqual(['a', 'c']);
    expect(result?.done).toBe(1);
    expect(result?.total).toBe(2);
    expect(result?.group).toBe('running');
  });

  it('ordena as tarefas por position', () => {
    const result = toProgressMission(
      mission(),
      view([step('b', { position: 2 }), step('a', { position: 1 })]),
      NOW,
    );
    expect(result?.tasks.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('current é a tarefa em execução; com duas, a de menor position', () => {
    const result = toProgressMission(
      mission(),
      view([
        step('b', { position: 2, status: 'running' }),
        step('a', { position: 1, status: 'running' }),
        step('c', { position: 0, status: 'failed' }),
      ]),
      NOW,
    );
    expect(result?.current?.id).toBe('a');
  });

  it('sem tarefa em execução, current é a que falhou', () => {
    const result = toProgressMission(
      mission({ status: 'failed' }),
      view([
        step('a', { position: 0, status: 'succeeded' }),
        step('b', { position: 1, status: 'failed' }),
      ]),
      NOW,
    );
    expect(result?.current?.id).toBe('b');
  });

  it('sem running nem failed, current fica indefinido', () => {
    const result = toProgressMission(mission(), view([step('a', { status: 'pending' })]), NOW);
    expect(result?.current).toBeUndefined();
  });

  it('sem view, tasks vazio e total 0', () => {
    const result = toProgressMission(mission(), undefined, NOW);
    expect(result).toMatchObject({ tasks: [], done: 0, total: 0, current: undefined });
  });

  it('devolve undefined quando a missão não entra em nenhum grupo', () => {
    expect(toProgressMission(mission({ status: 'draft' }), undefined, NOW)).toBeUndefined();
  });
});

describe('formatTaskDuration', () => {
  it('formata segundos', () => {
    expect(formatTaskDuration(42_000, false)).toBe('42 s');
    expect(formatTaskDuration(0, false)).toBe('0 s');
  });

  it('formata minutos', () => {
    expect(formatTaskDuration(8 * MIN, false)).toBe('8 min');
  });

  it('formata horas com minutos de dois dígitos', () => {
    expect(formatTaskDuration(65 * MIN, false)).toBe('1 h 05 min');
  });

  it('marca a tarefa em andamento com reticências', () => {
    expect(formatTaskDuration(8 * MIN, true)).toBe('8 min…');
  });

  it('trata valores inválidos como zero', () => {
    expect(formatTaskDuration(Number.NaN, false)).toBe('0 s');
    expect(formatTaskDuration(-5, false)).toBe('0 s');
  });
});

describe('buildTimeline', () => {
  const three = [
    step('a', { position: 0, status: 'succeeded', startedAt: at(0), finishedAt: at(5) }),
    step('b', { position: 1, status: 'succeeded', startedAt: at(5), finishedAt: at(11) }),
    step('c', { position: 2, status: 'running', startedAt: at(11) }),
    step('d', { position: 3, status: 'pending' }),
  ];
  const options = { now: NOW, missionRunning: true, fallbackEnd: at(19) };

  it('começa a primeira barra em 0 e termina a última no agora', () => {
    const timeline = buildTimeline(three, options);
    expect(timeline.bars['a']?.left).toBe(0);
    const last = timeline.bars['c'];
    expect(last).toBeDefined();
    expect(timeline.nowLeft).toBeDefined();
    expect((last?.left ?? 0) + (last?.width ?? 0)).toBeCloseTo(timeline.nowLeft ?? -1, 2);
  });

  it('a tarefa pendente não tem barra nem duração', () => {
    const timeline = buildTimeline(three, options);
    expect(timeline.bars['d']).toBeUndefined();
    expect(timeline.durations['d']).toBeUndefined();
  });

  it('dá a duração de cada tarefa com barra', () => {
    const timeline = buildTimeline(three, options);
    expect(timeline.durations['a']).toBe('5 min');
    expect(timeline.durations['b']).toBe('6 min');
    expect(timeline.durations['c']).toBe('8 min…');
  });

  it('gera no máximo 6 marcas, em passo permitido, a primeira com rótulo 0', () => {
    const timeline = buildTimeline(three, options);
    expect(timeline.ticks.length).toBeGreaterThan(1);
    expect(timeline.ticks.length).toBeLessThanOrEqual(6);
    expect(timeline.ticks[0]).toEqual({ label: '0', left: 0 });
    const spanMinutes = 19 * 1.1;
    const second = timeline.ticks[1];
    const stepMinutes = ((second?.left ?? 0) / 100) * spanMinutes;
    expect([1, 2, 5, 10, 15, 30, 60].some((s) => Math.abs(s - stepMinutes) < 0.01)).toBe(true);
  });

  it('sem tarefa iniciada: tudo vazio e sem lançar', () => {
    expect(buildTimeline([step('a'), step('b')], options)).toEqual(EMPTY_TIMELINE);
    expect(buildTimeline([], options)).toEqual(EMPTY_TIMELINE);
  });

  it('tarefa em execução sem finishedAt com a missão parada termina em fallbackEnd', () => {
    const timeline = buildTimeline([step('a', { status: 'running', startedAt: at(0) })], {
      now: NOW,
      missionRunning: false,
      fallbackEnd: at(10),
    });
    expect(timeline.nowLeft).toBeUndefined();
    const bar = timeline.bars['a'];
    expect(bar?.left).toBe(0);
    // span = max(10, 5) * 1,1 = 11 min; a barra tem 10 dos 11 minutos.
    expect(bar?.width).toBeCloseTo((10 / 11) * 100, 1);
    expect(timeline.durations['a']).toBe('10 min');
  });

  it('startedAt inválido não gera barra', () => {
    const timeline = buildTimeline(
      [
        step('a', { startedAt: 'lixo', status: 'running' }),
        step('b', { startedAt: at(0), finishedAt: at(2), status: 'succeeded' }),
      ],
      options,
    );
    expect(timeline.bars['a']).toBeUndefined();
    expect(timeline.durations['a']).toBeUndefined();
    expect(timeline.bars['b']).toBeDefined();
  });

  it('só com startedAt inválido não há linha do tempo', () => {
    expect(buildTimeline([step('a', { startedAt: 'lixo' })], options)).toEqual(EMPTY_TIMELINE);
  });

  it('finishedAt anterior a startedAt dá a largura mínima de 1,5', () => {
    const timeline = buildTimeline(
      [
        step('a', { status: 'succeeded', startedAt: at(0), finishedAt: at(10) }),
        step('b', { status: 'succeeded', startedAt: at(5), finishedAt: at(2) }),
      ],
      { now: NOW, missionRunning: false, fallbackEnd: at(10) },
    );
    expect(timeline.bars['b']?.width).toBe(1.5);
    expect(timeline.durations['b']).toBe('0 s');
  });

  it('finishedAt inválido cai no fim de reserva', () => {
    const timeline = buildTimeline(
      [step('a', { status: 'succeeded', startedAt: at(0), finishedAt: 'lixo' })],
      { now: NOW, missionRunning: false, fallbackEnd: at(5) },
    );
    expect(timeline.bars['a']?.left).toBe(0);
    expect(timeline.durations['a']).toBe('5 min');
  });

  it('mantém todos os valores entre 0 e 100 e nunca gera NaN', () => {
    const messy = [
      step('a', { status: 'succeeded', startedAt: at(0), finishedAt: at(1) }),
      step('b', { status: 'succeeded', startedAt: at(-30), finishedAt: at(300) }),
      step('c', { status: 'running', startedAt: at(500) }),
      step('d', { status: 'succeeded', startedAt: at(3), finishedAt: at(1) }),
      step('e', { status: 'failed', startedAt: 'lixo', finishedAt: 'lixo' }),
    ];
    for (const opts of [
      options,
      { now: new Date('lixo'), missionRunning: true, fallbackEnd: 'lixo' },
      { now: NOW, missionRunning: false, fallbackEnd: 'lixo' },
    ]) {
      const timeline = buildTimeline(messy, opts);
      const numbers: number[] = [];
      for (const bar of Object.values(timeline.bars)) {
        if (bar === undefined) continue;
        numbers.push(bar.left, bar.left + bar.width, bar.width);
      }
      for (const tick of timeline.ticks) numbers.push(tick.left);
      if (timeline.nowLeft !== undefined) numbers.push(timeline.nowLeft);
      expect(numbers.length).toBeGreaterThan(0);
      for (const value of numbers) {
        expect(Number.isNaN(value)).toBe(false);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100 + 1e-6);
      }
      expect(timeline.ticks.length).toBeLessThanOrEqual(6);
      for (const text of Object.values(timeline.durations)) expect(text ?? '').not.toContain('NaN');
    }
  });

  it('limita nowLeft a 100', () => {
    const timeline = buildTimeline(
      [step('a', { status: 'succeeded', startedAt: at(0), finishedAt: at(1) })],
      { now: new Date(BASE + 24 * 60 * MIN), missionRunning: true, fallbackEnd: at(1) },
    );
    expect(timeline.nowLeft).toBeLessThanOrEqual(100);
  });
});

describe('activityFeed', () => {
  const v = view(
    [
      step('a', { status: 'succeeded', startedAt: at(0), finishedAt: at(5) }),
      step('b', { status: 'failed', startedAt: at(5), finishedAt: at(8) }),
      step('c', { status: 'running', startedAt: at(9) }),
      step('d', { status: 'pending' }),
      step('e', { role: undefined, status: 'succeeded', startedAt: at(1), finishedAt: at(2) }),
    ],
    [event('ev1', 'plan.generated', at(-10)), event('ev2', 'mission.created', at(-20))],
    { title: 'Minha missão' },
  );

  it('gera início, conclusão, falha e plano; mais novo primeiro', () => {
    const feed = activityFeed([v], 20);
    expect(feed.map((i) => [i.id, i.kind, i.at])).toEqual([
      ['c:started', 'started', at(9)],
      ['b:failed', 'failed', at(8)],
      ['a:succeeded', 'succeeded', at(5)],
      ['b:started', 'started', at(5)],
      ['a:started', 'started', at(0)],
      ['ev1', 'plan', at(-10)],
    ]);
  });

  it('leva o título da missão e da tarefa', () => {
    const feed = activityFeed([v], 20);
    expect(feed[0]).toMatchObject({ missionTitle: 'Minha missão', taskTitle: 'Tarefa c' });
    const plan = feed.find((i) => i.kind === 'plan');
    expect(plan?.taskTitle).toBeUndefined();
  });

  it('respeita o limite', () => {
    expect(activityFeed([v], 2)).toHaveLength(2);
    expect(activityFeed([v], 0)).toEqual([]);
  });

  it('não gera item para etapa sem papel', () => {
    expect(activityFeed([v], 20).some((i) => i.id.startsWith('e:'))).toBe(false);
  });

  it('os ids são únicos', () => {
    const ids = activityFeed([v], 20).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('junta várias missões e ignora datas inválidas', () => {
    const other = view(
      [step('z', { status: 'succeeded', startedAt: 'lixo', finishedAt: at(30) })],
      [],
      { id: 'm2', title: 'Outra' },
    );
    const feed = activityFeed([v, other], 20);
    expect(feed[0]).toMatchObject({ id: 'z:succeeded', missionTitle: 'Outra' });
    expect(feed.some((i) => i.id === 'z:started')).toBe(false);
  });
});

describe('contadores', () => {
  const running = item(
    'running',
    [
      step('a', { status: 'succeeded', startedAt: at(0), finishedAt: at(4) }),
      step('b', { status: 'running', startedAt: at(4) }),
    ],
    'm1',
  );
  const running2 = item(
    'running',
    [step('c', { status: 'running' }), step('d', { status: 'running' })],
    'm2',
  );
  const attention = item('attention', [step('e', { status: 'pending' })], 'm3');
  const done = item(
    'done',
    [
      step('f', { status: 'succeeded', startedAt: at(0), finishedAt: at(10) }),
      step('g', { status: 'succeeded', startedAt: at(10), finishedAt: at(25) }),
      step('h', { status: 'succeeded' }),
    ],
    'm4',
  );
  const items = [running, running2, attention, done];

  it('countByGroup conta missões por grupo', () => {
    expect(countByGroup(items)).toEqual({ running: 2, attention: 1, failed: 0, done: 1 });
    expect(countByGroup([])).toEqual({ running: 0, attention: 0, failed: 0, done: 0 });
  });

  it('runningTaskCount soma as tarefas em execução', () => {
    expect(runningTaskCount(items)).toBe(3);
  });

  it('runningTaskCount ignora missão pausada ou à espera cuja etapa segue como running', () => {
    const paused: ProgressMission = {
      ...item('running', [step('p', { status: 'running' })], 'm5'),
      mission: mission({ id: 'm5', status: 'paused' }),
    };
    const waiting: ProgressMission = {
      ...item('attention', [step('w', { status: 'running' })], 'm6'),
      mission: mission({ id: 'm6', status: 'waiting_approval' }),
    };
    expect(runningTaskCount([paused, waiting])).toBe(0);
    expect(runningTaskCount([...items, paused, waiting])).toBe(3);
  });

  it('doneTodaySummary soma tarefas e tempo do grupo concluído', () => {
    expect(doneTodaySummary(items)).toEqual({ tasks: 3, ms: 25 * MIN });
    expect(doneTodaySummary([running])).toEqual({ tasks: 0, ms: 0 });
  });
});
