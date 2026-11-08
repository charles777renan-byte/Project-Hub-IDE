import { act, renderHook, waitFor } from '@testing-library/react';
import type {
  AppResult,
  ProjectHubApi,
  SessionSummary,
  SessionsListInput,
  SessionsListResult,
} from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSIONS_TEXT } from '../../src/renderer/components/right-panel/sessions-text';
import type { SessionScope } from '../../src/renderer/components/right-panel/sessions-state';
import { useSessions } from '../../src/renderer/components/right-panel/use-sessions';

/** O hook de carga da aba Sessões: escopo, recarga, foco, falha e resposta atrasada. */

const EMPTY: SessionsListResult = { sessions: [], indexing: [] };

function summary(id: string): SessionSummary {
  return {
    id: `${id.padEnd(8, '0')}-1111-1111-1111-111111111111`,
    provider: 'claude',
    title: `Sessão ${id}`,
    folder: 'C:\\trabalho',
    projectId: 'p1',
    branch: null,
    isWorktree: false,
    startedAt: '2026-11-07T10:00:00.000Z',
    lastActivityAt: '2026-11-07T10:30:00.000Z',
    messages: 2,
    subagents: 0,
    model: null,
    firstPrompt: null,
    lastAgentText: null,
    lastTurns: null,
    resumable: true,
    resumeBlockedReason: null,
  };
}

const ONE: SessionsListResult = { sessions: [summary('a')], indexing: [] };
const TWO: SessionsListResult = { sessions: [summary('a'), summary('b')], indexing: [] };

function ok(data: SessionsListResult): AppResult<SessionsListResult> {
  return { ok: true, data };
}

function installList(impl: (input: SessionsListInput) => Promise<AppResult<SessionsListResult>>) {
  const list = vi.fn(impl);
  window.projectHub = { sessions: { list, resume: vi.fn() } } as unknown as ProjectHubApi;
  return list;
}

function deferred() {
  let resolve!: (value: AppResult<SessionsListResult>) => void;
  const promise = new Promise<AppResult<SessionsListResult>>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('useSessions', () => {
  it('carrega ao montar, com o escopo e o projeto', async () => {
    const list = installList(() => Promise.resolve(ok(ONE)));
    const { result } = renderHook(() => useSessions('workspace', 'p1'));
    expect(result.current.state.status).toBe('loading');
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', data: ONE }));
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({ scope: 'workspace', projectId: 'p1' });
  });

  it('o escopo Todos sem projeto pede só o escopo', async () => {
    const list = installList(() => Promise.resolve(ok(EMPTY)));
    renderHook(() => useSessions('all', null));
    await waitFor(() => expect(list).toHaveBeenCalledWith({ scope: 'all' }));
  });

  it('o escopo Todos com projeto leva o projeto junto', async () => {
    const list = installList(() => Promise.resolve(ok(EMPTY)));
    renderHook(() => useSessions('all', 'p1'));
    await waitFor(() => expect(list).toHaveBeenCalledWith({ scope: 'all', projectId: 'p1' }));
  });

  it('escopo de projeto sem projeto não chama o canal e fica pronto e vazio', async () => {
    const list = installList(() => Promise.resolve(ok(ONE)));
    const { result } = renderHook(() => useSessions('project', null));
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', data: EMPTY }));
    expect(list).not.toHaveBeenCalled();
  });

  it('trocar o escopo recarrega com o novo pedido', async () => {
    const list = installList(() => Promise.resolve(ok(ONE)));
    const { result, rerender } = renderHook(
      ({ scope }: { scope: SessionScope }) => useSessions(scope, 'p1'),
      { initialProps: { scope: 'workspace' as SessionScope } },
    );
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    rerender({ scope: 'project' });
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({ scope: 'project', projectId: 'p1' }),
    );
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
  });

  it('refresh() relê a lista agora', async () => {
    const list = installList(() => Promise.resolve(ok(ONE)));
    const { result } = renderHook(() => useSessions('workspace', 'p1'));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    act(() => {
      result.current.refresh();
    });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it('relê quando a janela ganha o foco', async () => {
    const list = installList(() => Promise.resolve(ok(ONE)));
    const { result } = renderHook(() => useSessions('workspace', 'p1'));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it('para de ouvir o foco quando é desmontado', async () => {
    const list = installList(() => Promise.resolve(ok(ONE)));
    const { result, unmount } = renderHook(() => useSessions('workspace', 'p1'));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    unmount();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('falha que volta no envelope vira estado de erro, nunca lista vazia', async () => {
    installList(() =>
      Promise.resolve({
        ok: false,
        error: { code: 'UNKNOWN', message: 'Disco indisponível', retryable: true },
      }),
    );
    const { result } = renderHook(() => useSessions('workspace', 'p1'));
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'error', message: 'Disco indisponível' }),
    );
  });

  it('exceção do canal vira erro com o texto padrão', async () => {
    installList(() => Promise.reject(new Error('IPC caiu')));
    const { result } = renderHook(() => useSessions('workspace', 'p1'));
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: 'error',
        message: SESSIONS_TEXT.loadError,
      }),
    );
  });

  it('resposta atrasada de um pedido antigo não sobrescreve a do mais novo', async () => {
    const first = deferred();
    const second = deferred();
    let calls = 0;
    installList(() => (calls++ === 0 ? first.promise : second.promise));

    const { result } = renderHook(() => useSessions('workspace', 'p1'));
    act(() => {
      result.current.refresh();
    });
    await act(async () => {
      second.resolve(ok(TWO));
    });
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', data: TWO }));

    await act(async () => {
      first.resolve(ok(ONE));
    });
    expect(result.current.state).toEqual({ status: 'ready', data: TWO });
  });
});
