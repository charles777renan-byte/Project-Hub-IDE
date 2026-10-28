import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import type {
  AppResult,
  MissionDto,
  MissionStepDto,
  MissionViewDto,
  ProjectHubApi,
  ProjectSummary,
} from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELOAD_DELAY_MS } from '../../src/renderer/overview-data';
import { activityFeed } from '../../src/renderer/progress-data';
import { MAX_PROGRESS_READS } from '../../src/renderer/use-missions-board';
import {
  FEED_LIMIT,
  MAX_DONE_READS,
  useProjectProgress,
} from '../../src/renderer/use-project-progress';

/** Leitura do progresso de um projeto: missões da carga compartilhada e a visão inteira das mais recentes. */

function project(id: string): ProjectSummary {
  return {
    id,
    name: `Projeto ${id}`,
    path: `C:\\${id}`,
    repositoryKind: 'git',
    available: true,
    defaultBranch: 'main',
  };
}

function mission(
  id: string,
  projectId: string,
  status: MissionDto['status'],
  updatedAt = '2026-10-20T09:00:00.000Z',
  finishedAt?: string,
): MissionDto {
  return {
    id,
    projectId,
    title: `Missão ${id}`,
    objective: 'Objetivo',
    status,
    altersCode: false,
    acceptanceCriteria: [],
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt,
    ...(finishedAt === undefined ? {} : { finishedAt }),
  };
}

function step(
  id: string,
  status: MissionStepDto['status'],
  extra: Partial<MissionStepDto> = {},
): MissionStepDto {
  return {
    id,
    position: 1,
    title: id,
    status,
    agent: 'claude-code',
    role: 'general',
    ...extra,
  };
}

function viewOf(entry: MissionDto | undefined, steps: MissionStepDto[]): MissionViewDto {
  return { mission: entry, steps, events: [], pendingApprovals: [] } as unknown as MissionViewDto;
}

function install(
  missions: Record<string, MissionDto[]>,
  stepsOf: (missionId: string) => MissionStepDto[] = () => [],
) {
  const subscribers: Array<() => void> = [];
  const unsubscribes: Array<ReturnType<typeof vi.fn>> = [];
  const all = Object.values(missions).flat();
  const get = vi.fn((missionId: string) =>
    Promise.resolve<AppResult<MissionViewDto>>({
      ok: true,
      data: viewOf(
        all.find((entry) => entry.id === missionId),
        stepsOf(missionId),
      ),
    }),
  );
  window.projectHub = {
    projects: {
      list: vi.fn(() =>
        Promise.resolve({ ok: true, data: Object.keys(missions).map((id) => project(id)) }),
      ),
    },
    missions: {
      list: vi.fn((projectId: string) =>
        Promise.resolve({ ok: true, data: missions[projectId] ?? [] }),
      ),
      get,
      subscribe: vi.fn((listener: () => void) => {
        subscribers.push(listener);
        const unsubscribe = vi.fn();
        unsubscribes.push(unsubscribe);
        return unsubscribe;
      }),
    },
  } as unknown as ProjectHubApi;
  return { get, unsubscribes, emit: () => subscribers.forEach((listener) => listener()) };
}

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

const TODAY = new Date().toISOString();

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'projectHub');
});

describe('useProjectProgress', () => {
  it('traz só as missões do projeto pedido, sem rascunho nem cancelada, por grupo e do mais novo ao mais velho', async () => {
    install({
      p1: [
        mission('fim', 'p1', 'succeeded', '2026-10-20T11:00:00.000Z', TODAY),
        mission(
          'antiga',
          'p1',
          'succeeded',
          '2026-10-01T11:00:00.000Z',
          '2026-10-01T11:00:00.000Z',
        ),
        mission('rascunho', 'p1', 'draft'),
        mission('cancelada', 'p1', 'cancelled'),
        mission('falhou', 'p1', 'failed', '2026-10-20T10:00:00.000Z'),
        mission('rodando-velha', 'p1', 'running', '2026-10-20T08:00:00.000Z'),
        mission('rodando-nova', 'p1', 'running', '2026-10-20T09:30:00.000Z'),
        mission('espera', 'p1', 'waiting_approval', '2026-10-20T09:00:00.000Z'),
      ],
      p2: [mission('outra', 'p2', 'running')],
    });

    const { result } = renderHook(() => useProjectProgress('p1'), { wrapper });

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items.map((item) => `${item.group}:${item.mission.id}`)).toEqual([
      'running:rodando-nova',
      'running:rodando-velha',
      'attention:espera',
      'failed:falhou',
      'done:fim',
    ]);
  });

  it('lê as missões abertas (até 20, as mais recentes) e as concluídas hoje (até 10)', async () => {
    const open = Array.from({ length: 25 }, (_, index) =>
      mission(
        `a${String(index).padStart(2, '0')}`,
        'p1',
        'running',
        `2026-10-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`,
      ),
    );
    const done = Array.from({ length: 12 }, (_, index) =>
      mission(
        `d${String(index).padStart(2, '0')}`,
        'p1',
        'succeeded',
        `2026-10-20T${String(index).padStart(2, '0')}:00:00.000Z`,
        TODAY,
      ),
    );
    const { get } = install({ p1: [...open, ...done] }, () => [step('t', 'succeeded')]);

    const { result } = renderHook(() => useProjectProgress('p1'), { wrapper });

    await waitFor(() => expect(result.current.items).toHaveLength(37));
    await waitFor(() =>
      expect(result.current.items.filter((item) => item.total === 1)).toHaveLength(30),
    );
    expect(MAX_PROGRESS_READS).toBe(20);
    expect(MAX_DONE_READS).toBe(10);
    expect(get).toHaveBeenCalledTimes(30);
    const read = get.mock.calls.map(([id]) => id);
    const openRead = read.filter((id) => id.startsWith('a')).sort();
    const doneRead = read.filter((id) => id.startsWith('d')).sort();
    expect(openRead).toHaveLength(20);
    expect(openRead[0]).toBe('a05');
    expect(openRead[19]).toBe('a24');
    expect(doneRead).toHaveLength(10);
    expect(doneRead[0]).toBe('d02');
    expect(doneRead[9]).toBe('d11');
  });

  it('a leitura que falha deixa a missão na lista com 0 de 0 e as outras seguem', async () => {
    const { get } = install({
      p1: [
        mission('boa', 'p1', 'running', '2026-10-20T10:00:00.000Z'),
        mission('ruim', 'p1', 'running'),
      ],
    });
    get.mockImplementation((id: string) =>
      id === 'ruim'
        ? Promise.reject(new Error('fora do ar'))
        : Promise.resolve({
            ok: true,
            data: viewOf(mission('boa', 'p1', 'running'), [
              step('t1', 'succeeded'),
              step('t2', 'running', { position: 2 }),
            ]),
          }),
    );

    const { result } = renderHook(() => useProjectProgress('p1'), { wrapper });

    await waitFor(() =>
      expect(result.current.items.find((item) => item.mission.id === 'boa')?.total).toBe(2),
    );
    const bad = result.current.items.find((item) => item.mission.id === 'ruim');
    expect(bad).toMatchObject({ done: 0, total: 0, tasks: [] });
    expect(result.current.status).toBe('ready');
  });

  it('com a carga em erro, o status é error', async () => {
    window.projectHub = {
      projects: {
        list: vi.fn(() =>
          Promise.resolve({ ok: false, error: { code: 'X', message: 'x', retryable: true } }),
        ),
      },
      missions: { subscribe: vi.fn(() => () => {}) },
    } as unknown as ProjectHubApi;

    const { result } = renderHook(() => useProjectProgress('p1'), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.items).toEqual([]);
    expect(result.current.feed).toEqual([]);
  });

  it('o feed vem de activityFeed com as visões lidas e o limite do feed', async () => {
    const steps = (id: string): MissionStepDto[] => [
      step(`${id}-a`, 'succeeded', {
        startedAt: '2026-10-20T09:00:00.000Z',
        finishedAt: '2026-10-20T09:10:00.000Z',
      }),
      step(`${id}-b`, 'running', { position: 2, startedAt: '2026-10-20T09:10:00.000Z' }),
    ];
    const missions = [mission('m1', 'p1', 'running'), mission('m2', 'p1', 'running')];
    install({ p1: missions }, steps);

    const { result } = renderHook(() => useProjectProgress('p1'), { wrapper });

    await waitFor(() => expect(result.current.feed.length).toBe(6));
    const views = missions.map((entry) => viewOf(entry, steps(entry.id)));
    expect(FEED_LIMIT).toBe(12);
    expect(result.current.feed.map((item) => item.id).sort()).toEqual(
      activityFeed(views, FEED_LIMIT)
        .map((item) => item.id)
        .sort(),
    );
  });

  it('desmontar chama o unsubscribe da assinatura', async () => {
    const { unsubscribes } = install({ p1: [mission('m1', 'p1', 'running')] });
    const { result, unmount } = renderHook(() => useProjectProgress('p1'), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(unsubscribes.length).toBeGreaterThan(0);
    expect(unsubscribes.some((unsubscribe) => unsubscribe.mock.calls.length > 0)).toBe(false);

    unmount();

    expect(unsubscribes.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true);
  });
});

describe('useProjectProgress com timers falsos', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const settle = () =>
    act(async () => {
      for (let round = 0; round < 6; round += 1) await vi.advanceTimersByTimeAsync(0);
    });

  it('um evento relê só depois de RELOAD_DELAY_MS, e três eventos seguidos viram uma releitura', async () => {
    const { get, emit } = install({ p1: [mission('m1', 'p1', 'running')] }, () => [
      step('t', 'running'),
    ]);

    const { result } = renderHook(() => useProjectProgress('p1'), { wrapper });
    await settle();
    expect(result.current.status).toBe('ready');
    expect(get).toHaveBeenCalledTimes(1);

    emit();
    emit();
    emit();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RELOAD_DELAY_MS - 1);
    });
    expect(get).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await settle();
    expect(get).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * RELOAD_DELAY_MS);
    });
    await settle();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('com uma tarefa em execução, now avança a cada 30 s', async () => {
    install({ p1: [mission('m1', 'p1', 'running')] }, () => [step('t', 'running')]);

    const { result } = renderHook(() => useProjectProgress('p1'), { wrapper });
    await settle();
    expect(result.current.items[0]?.current?.status).toBe('running');
    const first = result.current.now.getTime();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(result.current.now.getTime() - first).toBe(30_000);
  });

  it('sem tarefa em execução, não há intervalo e now não muda', async () => {
    install({ p1: [mission('m1', 'p1', 'paused')] }, () => [step('t', 'pending')]);

    const { result } = renderHook(() => useProjectProgress('p1'), { wrapper });
    await settle();
    expect(result.current.status).toBe('ready');
    const first = result.current.now.getTime();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(result.current.now.getTime()).toBe(first);
    expect(vi.getTimerCount()).toBe(0);
  });
});
