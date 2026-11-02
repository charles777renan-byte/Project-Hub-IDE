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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RELOAD_DELAY_MS } from '../../src/renderer/overview-data';
import { MAX_PROGRESS_READS, useMissionsBoard } from '../../src/renderer/use-missions-board';

/** Quadro de missões com progresso: lê a lista da carga compartilhada e as etapas só das mais recentes. */

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
  };
}

function step(id: string, status: MissionStepDto['status'], task = true): MissionStepDto {
  return {
    id,
    position: 1,
    title: id,
    status,
    agent: 'claude-code',
    ...(task ? { role: 'general' as const } : {}),
  };
}

function install(
  missions: Record<string, MissionDto[]>,
  stepsOf: (missionId: string) => MissionStepDto[] = () => [],
) {
  const subscribers: Array<() => void> = [];
  const get = vi.fn((missionId: string) =>
    Promise.resolve<AppResult<MissionViewDto>>({
      ok: true,
      data: {
        steps: stepsOf(missionId),
        executions: [],
        pendingApprovals: [],
      } as unknown as MissionViewDto,
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
        return () => {};
      }),
    },
  } as unknown as ProjectHubApi;
  return { get, emit: () => subscribers.forEach((listener) => listener()) };
}

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('useMissionsBoard', () => {
  it('junta as missões de todos os projetos, com o nome do projeto e o progresso das tarefas', async () => {
    install({ p1: [mission('m1', 'p1', 'running')], p2: [mission('m2', 'p2', 'queued')] }, (id) =>
      id === 'm1'
        ? [
            step('a', 'succeeded'),
            step('b', 'succeeded'),
            step('c', 'running'),
            step('d', 'pending'),
          ]
        : [step('e', 'pending'), step('texto', 'succeeded', false)],
    );

    const { result } = renderHook(() => useMissionsBoard(), { wrapper });

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await waitFor(() =>
      expect(result.current.items.map(({ done, total }) => `${done}/${total}`)).toEqual([
        '2/4',
        '0/1',
      ]),
    );
    expect(result.current.items.map((entry) => entry.projectName)).toEqual([
      'Projeto p1',
      'Projeto p2',
    ]);
    expect(result.current.items[0]?.projectId).toBe('p1');
  });

  it('o filtro por projeto traz só as missões dele', async () => {
    install({ p1: [mission('m1', 'p1', 'running')], p2: [mission('m2', 'p2', 'running')] });

    const { result } = renderHook(() => useMissionsBoard({ projectId: 'p2' }), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items.map((entry) => entry.mission.id)).toEqual(['m2']);
  });

  it('com 30 missões abertas, lê as etapas de no máximo 20, as mais recentes', async () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      mission(
        `m${String(index).padStart(2, '0')}`,
        'p1',
        'running',
        `2026-10-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`,
      ),
    );
    const { get } = install({ p1: many }, () => [step('a', 'succeeded')]);

    const { result } = renderHook(() => useMissionsBoard(), { wrapper });

    await waitFor(() => expect(result.current.items).toHaveLength(30));
    await waitFor(() => expect(result.current.items[0]?.total).toBe(1));
    expect(MAX_PROGRESS_READS).toBe(20);
    expect(get).toHaveBeenCalledTimes(20);
    const read = get.mock.calls.map(([id]) => id).sort();
    expect(read[0]).toBe('m10');
    expect(read[19]).toBe('m29');
    // As outras vêm sem tarefas: só o estado.
    const last = result.current.items[29];
    expect(last?.done).toBe(0);
    expect(last?.total).toBe(0);
  });

  it('missão encerrada vem depois das abertas e também é lida (tarefas e tokens no cartão)', async () => {
    const { get } = install({
      p1: [
        mission('velha', 'p1', 'succeeded', '2026-10-25T09:00:00.000Z'),
        mission('aberta', 'p1', 'running', '2026-10-01T09:00:00.000Z'),
      ],
    });

    const { result } = renderHook(() => useMissionsBoard(), { wrapper });

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items.map((entry) => entry.mission.id)).toEqual(['aberta', 'velha']);
    await waitFor(() => expect(get).toHaveBeenCalledWith('aberta'));
    await waitFor(() => expect(get).toHaveBeenCalledWith('velha'));
  });

  it('soma os tokens das tentativas e junta os agentes das tarefas', async () => {
    const { get } = install({ p1: [mission('m1', 'p1', 'succeeded')] }, () => [
      step('a', 'succeeded'),
    ]);
    const usage = (inputTokens: number, outputTokens: number) => ({
      inputTokens,
      outputTokens,
      cacheReadInputTokens: 0,
      cacheWrite5mInputTokens: 0,
      cacheWrite1hInputTokens: 0,
    });
    get.mockImplementation(() =>
      Promise.resolve<AppResult<MissionViewDto>>({
        ok: true,
        data: {
          steps: [step('a', 'succeeded'), step('b', 'succeeded')],
          executions: [{ usage: usage(1000, 200) }, {}, { usage: usage(300, 50) }],
          pendingApprovals: [],
        } as unknown as MissionViewDto,
      }),
    );

    const { result } = renderHook(() => useMissionsBoard(), { wrapper });

    await waitFor(() => expect(result.current.items[0]?.tokens).toBe(1550));
    expect(result.current.items[0]?.agents).toEqual(['claude-code']);
  });

  it('missão antiga, com etapa sem papel, não tem tarefas mas mostra o agente', async () => {
    install({ p1: [mission('m1', 'p1', 'review')] }, () => [step('a', 'pending', false)]);

    const { result } = renderHook(() => useMissionsBoard(), { wrapper });

    await waitFor(() => expect(result.current.items[0]?.agents).toEqual(['claude-code']));
    expect(result.current.items[0]?.total).toBe(0);
  });

  it('sem tentativa com uso, a missão fica sem tokens (não zero)', async () => {
    install({ p1: [mission('m1', 'p1', 'running')] }, () => [step('a', 'running')]);

    const { result } = renderHook(() => useMissionsBoard(), { wrapper });

    await waitFor(() => expect(result.current.items[0]?.total).toBe(1));
    expect(result.current.items[0]?.tokens).toBeUndefined();
  });

  it('um evento de missão atualiza o progresso sem mudar a lista', async () => {
    let done = 1;
    const { emit } = install({ p1: [mission('m1', 'p1', 'running')] }, () => [
      ...Array.from({ length: done }, (_, index) => step(`ok${index}`, 'succeeded')),
      step('resto', 'pending'),
    ]);

    const { result } = renderHook(() => useMissionsBoard(), { wrapper });
    await waitFor(() => expect(result.current.items[0]?.done).toBe(1));

    done = 2;
    await act(async () => {
      emit();
      await new Promise((resolve) => setTimeout(resolve, RELOAD_DELAY_MS + 100));
    });

    await waitFor(() => expect(result.current.items[0]?.done).toBe(2));
  });

  it('a falha na leitura das etapas deixa só o estado, sem derrubar a lista', async () => {
    install({ p1: [mission('m1', 'p1', 'running')] });
    (window.projectHub.missions.get as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.reject(new Error('fora do ar')),
    );

    const { result } = renderHook(() => useMissionsBoard(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.items[0]).toMatchObject({ done: 0, total: 0 });
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

    const { result } = renderHook(() => useMissionsBoard(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.items).toEqual([]);
  });
});
