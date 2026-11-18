import { act, cleanup, renderHook } from '@testing-library/react';
import type {
  AlertOpenEvent,
  MissionDto,
  ProjectHubApi,
  TerminalSummary,
} from '@project-hub/contracts';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Attention, AttentionEntry } from '../../src/renderer/attention';
import type { Overview, OverviewItem } from '../../src/renderer/overview-data';

const state = vi.hoisted(() => ({
  attention: { entries: [], count: 0, known: false } as Attention,
  items: [] as OverviewItem[],
  failed: [] as OverviewItem[],
}));

vi.mock('../../src/renderer/attention', async (original) => ({
  ...(await original<typeof import('../../src/renderer/attention')>()),
  useAttention: () => state.attention,
}));

vi.mock('../../src/renderer/use-overview', () => ({
  useOverview: () => ({ items: state.items, failed: state.failed }) as unknown as Overview,
}));

const { currentWaits, newWaits, useAttentionAlerts } =
  await import('../../src/renderer/attention-alerts');
const { missionPath } = await import('../../src/renderer/routes');

function mission(id: string, status: MissionDto['status']): MissionDto {
  return { id, projectId: 'p1', title: `Missão ${id}`, status } as unknown as MissionDto;
}

function terminal(id: string, extra: Partial<TerminalSummary> = {}): TerminalSummary {
  return {
    id,
    kind: 'shell',
    title: `Claude ${id}`,
    projectId: 'p1',
    projectName: 'Loja',
    state: 'waiting',
    provider: 'claude',
    origin: 'new',
    ...extra,
  } as TerminalSummary;
}

const missionEntry = (item: MissionDto): AttentionEntry => ({
  kind: 'mission',
  key: `m-${item.id}`,
  projectId: 'p1',
  mission: item,
});

const sessionEntry = (item: TerminalSummary): AttentionEntry => ({
  kind: 'session',
  key: `t-${item.id}`,
  projectId: 'p1',
  terminal: item,
});

const keysOf = <K,>(map: ReadonlyMap<K, unknown>): Set<K> => new Set(map.keys());

afterEach(() => {
  cleanup();
  state.attention = { entries: [], count: 0, known: false };
  state.items = [];
  state.failed = [];
  Reflect.deleteProperty(window, 'projectHub');
});

const item = (entry: MissionDto): OverviewItem => ({ projectId: 'p1', mission: entry });

describe('currentWaits e newWaits', () => {
  it('a primeira leitura não avisa nada', () => {
    const waiting = mission('m1', 'waiting_approval');
    const current = currentWaits(
      [missionEntry(waiting), sessionEntry(terminal('t1'))],
      [item(waiting)],
      [],
    );

    expect(current.size).toBe(2);
    expect(newWaits(null, current)).toEqual([]);
  });

  it('a espera da missão avisa uma vez só, como missão, mesmo quando o terminal do agente dela chega depois', () => {
    const waiting = mission('m1', 'waiting_approval');
    const first = currentWaits([missionEntry(waiting)], [item(waiting)], []);
    expect(newWaits(new Set(), first)).toEqual([{ kind: 'mission', id: 'm1' }]);

    const second = currentWaits(
      [sessionEntry(terminal('t9', { missionId: 'm1' }))],
      [item(waiting)],
      [],
    );
    expect(newWaits(keysOf(first), second)).toEqual([]);
  });

  it('o terminal do agente ainda aguardando não segura a espera da missão que já voltou a rodar', () => {
    const agent = sessionEntry(terminal('t9', { missionId: 'm1' }));
    const waiting = currentWaits([agent], [item(mission('m1', 'waiting_approval'))], []);
    // A pessoa aprovou: a visão geral já diz `running`, e a lista de terminais ainda está atrasada.
    const running = currentWaits([agent], [item(mission('m1', 'running'))], []);
    const again = currentWaits([agent], [item(mission('m1', 'waiting_input'))], []);

    expect(newWaits(keysOf(waiting), running)).toEqual([]);
    expect(newWaits(keysOf(running), again)).toEqual([{ kind: 'mission', id: 'm1' }]);
  });

  it('a falha logo depois da espera avisa, mesmo sem uma leitura no meio', () => {
    const waiting = currentWaits([], [item(mission('m1', 'waiting_approval'))], []);
    const failed = currentWaits([], [], [item(mission('m1', 'failed'))]);

    expect(newWaits(keysOf(waiting), failed)).toEqual([{ kind: 'mission', id: 'm1' }]);
  });

  it('o terminal avulso aguardando avisa como terminal', () => {
    const current = currentWaits([sessionEntry(terminal('t1'))], [], []);

    expect(newWaits(new Set(), current)).toEqual([{ kind: 'terminal', id: 't1' }]);
  });

  it('plano pronto e revisão não avisam; a falha avisa', () => {
    const planned = mission('m1', 'planned');
    const review = mission('m2', 'review');
    const current = currentWaits(
      [missionEntry(planned), missionEntry(review)],
      [item(planned), item(review)],
      [item(mission('m3', 'failed'))],
    );

    expect([...current.values()]).toEqual([{ kind: 'mission', id: 'm3' }]);
  });

  it('a espera que sai e volta avisa de novo', () => {
    const entry = mission('m1', 'waiting_input');
    const waiting = currentWaits([missionEntry(entry)], [item(entry)], []);
    const none = currentWaits([], [], []);

    expect(newWaits(keysOf(waiting), none)).toEqual([]);
    expect(newWaits(keysOf(none), waiting)).toEqual([{ kind: 'mission', id: 'm1' }]);
  });
});

describe('useAttentionAlerts', () => {
  function installApi() {
    let open: ((event: AlertOpenEvent) => void) | undefined;
    const notify = vi.fn(() => Promise.resolve({ ok: true as const, data: undefined }));
    window.projectHub = {
      alerts: {
        notify,
        onOpen: (listener: (event: AlertOpenEvent) => void) => {
          open = listener;
          return () => undefined;
        },
      },
    } as unknown as ProjectHubApi;
    return { notify, open: (event: AlertOpenEvent) => open?.(event) };
  }

  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={['/']}>{children}</MemoryRouter>
  );

  it('sem a contagem confiável, não avisa; depois avisa só o que é novo', () => {
    const { notify } = installApi();
    state.items = [item(mission('m1', 'waiting_approval'))];
    state.attention = {
      entries: [missionEntry(mission('m1', 'waiting_approval'))],
      count: 1,
      known: false,
    };
    const { rerender } = renderHook(() => useAttentionAlerts(), { wrapper });
    expect(notify).not.toHaveBeenCalled();

    state.attention = { ...state.attention, known: true };
    rerender();
    expect(notify).not.toHaveBeenCalled();

    state.attention = {
      entries: [...state.attention.entries, sessionEntry(terminal('t1'))],
      count: 2,
      known: true,
    };
    rerender();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({ kind: 'terminal', id: 't1' });
  });

  it('o clique numa notificação de missão abre a missão', () => {
    const { open } = installApi();
    const { result } = renderHook(
      () => {
        useAttentionAlerts();
        return useLocation();
      },
      { wrapper },
    );

    act(() => open({ kind: 'mission', projectId: 'p1', id: 'm1' }));

    expect(result.current.pathname).toBe(missionPath('p1', 'm1'));
  });
});
