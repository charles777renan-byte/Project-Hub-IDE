import { act, renderHook } from '@testing-library/react';
import type {
  AppError,
  AppResult,
  CheckDto,
  GithubPanelDto,
  PrReadingDto,
  ProjectHubApi,
} from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GITHUB_POLL_MS,
  GITHUB_RELOAD_DELAY_MS,
  hasPendingChecks,
  useGithubPanel,
} from '../../src/renderer/use-github-panel';

/** Leitura do PR da branch atual: uma carga, falhas distintas, dado antigo em falha de rede, 30 s e troca de projeto. */

const PASSED: CheckDto = {
  kind: 'check-run',
  name: 'build',
  workflowName: 'CI',
  status: 'COMPLETED',
  conclusion: 'SUCCESS',
  startedAt: '2026-11-03T20:00:00Z',
  completedAt: '2026-11-03T20:03:00Z',
  detailsUrl: 'https://github.com/o/r/actions/runs/1',
};
const RUNNING: CheckDto = {
  ...PASSED,
  name: 'e2e',
  status: 'IN_PROGRESS',
  conclusion: null,
  completedAt: null,
};

function reading(checks: CheckDto[], title = 'Painel de checks'): PrReadingDto {
  return {
    pr: {
      number: 12,
      title,
      state: 'OPEN',
      isDraft: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      url: 'https://github.com/o/r/pull/12',
      updatedAt: '2026-11-03T20:53:49Z',
      headRefName: 'feat/checks',
      baseRefName: 'main',
      additions: 10,
      deletions: 2,
      reviewDecision: null,
    },
    checks,
    comments: [{ author: 'ana', body: '<b>oi</b>', createdAt: '2026-11-03T20:10:00Z' }],
    readAt: '2026-11-03T20:54:00Z',
  };
}

function okPr(checks: CheckDto[], title?: string): AppResult<GithubPanelDto> {
  return {
    ok: true,
    data: { kind: 'pr', result: { state: 'ok', reading: reading(checks, title) } },
  };
}

function fail(code: AppError['code'], message: string): AppResult<never> {
  return { ok: false, error: { code, message, retryable: code === 'GH_NETWORK_FAILED' } };
}

function installApi(pr: (input: { projectId: string }) => Promise<AppResult<GithubPanelDto>>) {
  const api = {
    pr: vi.fn(pr),
    comment: vi.fn(() => Promise.resolve({ ok: true, data: undefined } as AppResult<void>)),
    merge: vi.fn(() => Promise.resolve({ ok: true, data: undefined } as AppResult<void>)),
  };
  window.projectHub = { github: api } as unknown as ProjectHubApi;
  return api;
}

/** Deixa as promessas resolverem (a leitura não usa temporizador). */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('hasPendingChecks', () => {
  it('conta check sem resultado, de qualquer um dos dois tipos', () => {
    const pendingContext: CheckDto = {
      kind: 'status-context',
      name: 'ci/x',
      state: 'PENDING',
      targetUrl: null,
      startedAt: null,
    };
    expect(hasPendingChecks([PASSED])).toBe(false);
    expect(hasPendingChecks([PASSED, RUNNING])).toBe(true);
    expect(hasPendingChecks([PASSED, { ...PASSED, status: 'QUEUED', conclusion: null }])).toBe(
      true,
    );
    expect(hasPendingChecks([pendingContext])).toBe(true);
    expect(hasPendingChecks([{ ...pendingContext, state: 'SUCCESS' }])).toBe(false);
    expect(hasPendingChecks([])).toBe(false);
  });
});

describe('useGithubPanel', () => {
  it('lê o PR uma vez ao abrir e entrega a leitura', async () => {
    const api = installApi(() => Promise.resolve(okPr([PASSED])));
    const { result } = renderHook(() => useGithubPanel('p1', false));

    expect(result.current.state.status).toBe('loading');
    await settle();

    expect(api.pr).toHaveBeenCalledTimes(1);
    expect(api.pr).toHaveBeenCalledWith({ projectId: 'p1' });
    const { state } = result.current;
    expect(state.status).toBe('ready');
    if (state.status !== 'ready') return;
    expect(state.stale).toBe(false);
    expect(state.reading.pr.title).toBe('Painel de checks');
    // O corpo do comentário chega como texto, sem tratamento.
    expect(state.reading.comments[0]?.body).toBe('<b>oi</b>');
    expect(state.refreshing).toBe(false);
  });

  it('sem projeto, não lê nada', async () => {
    const api = installApi(() => Promise.resolve(okPr([])));
    const { result } = renderHook(() => useGithubPanel(null, true));
    await settle();

    expect(api.pr).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe('loading');
  });

  it('distingue sem PR, pasta que não é do GitHub, sem gh, sem login e falha de rede', async () => {
    const cases: Array<[AppResult<GithubPanelDto>, string, string?]> = [
      [{ ok: true, data: { kind: 'no-pr' } }, 'no-pr'],
      [{ ok: true, data: { kind: 'not-applicable' } }, 'not-applicable'],
      [fail('GH_NOT_AVAILABLE', 'GitHub CLI não encontrado'), 'no-gh', 'GitHub CLI não encontrado'],
      [fail('GH_NOT_AUTHENTICATED', 'Faça gh auth login'), 'no-login', 'Faça gh auth login'],
      [fail('GH_NETWORK_FAILED', 'sem rede'), 'network', 'sem rede'],
      [fail('PROJECT_PATH_UNAVAILABLE', 'Pasta indisponível'), 'error', 'Pasta indisponível'],
    ];
    for (const [response, status, message] of cases) {
      installApi(() => Promise.resolve(response));
      const { result, unmount } = renderHook(() => useGithubPanel('p1', false));
      await settle();
      expect(result.current.state.status).toBe(status);
      if ('message' in result.current.state) expect(result.current.state.message).toBe(message);
      unmount();
    }
  });

  it('uma exceção do preload vira estado de erro com o texto geral', async () => {
    installApi(() => Promise.reject(new Error('boom')));
    const { result } = renderHook(() => useGithubPanel('p1', false));
    await settle();

    expect(result.current.state).toMatchObject({
      status: 'error',
      message: 'Não foi possível ler o PR.',
    });
  });

  it('sem o grupo github na API, vira estado de erro em vez de quebrar', async () => {
    window.projectHub = {} as unknown as ProjectHubApi;
    const { result } = renderHook(() => useGithubPanel('p1', false));
    await settle();

    expect(result.current.state.status).toBe('error');
  });

  it('falha de rede depois de uma leitura boa mantém a lista, marcada como desatualizada', async () => {
    const responses = [okPr([PASSED]), fail('GH_NETWORK_FAILED', 'sem rede'), okPr([PASSED])];
    const api = installApi(() => Promise.resolve(responses.shift() ?? okPr([])));
    const { result } = renderHook(() => useGithubPanel('p1', false));
    await settle();

    act(() => result.current.refresh());
    await settle();

    const stale = result.current.state;
    expect(stale.status).toBe('ready');
    if (stale.status !== 'ready') return;
    expect(stale.stale).toBe(true);
    expect(stale.error?.code).toBe('GH_NETWORK_FAILED');
    expect(stale.reading.checks).toEqual([PASSED]);

    // A próxima leitura boa tira a marca.
    act(() => result.current.refresh());
    await settle();
    expect(api.pr).toHaveBeenCalledTimes(3);
    expect(result.current.state).toMatchObject({ status: 'ready', stale: false, error: null });
  });

  it('o resultado "stale" do processo principal também chega como desatualizado', async () => {
    const error: AppError = { code: 'GH_NETWORK_FAILED', message: 'sem rede', retryable: true };
    installApi(() =>
      Promise.resolve({
        ok: true,
        data: { kind: 'pr', result: { state: 'stale', reading: reading([PASSED]), error } },
      }),
    );
    const { result } = renderHook(() => useGithubPanel('p1', false));
    await settle();

    expect(result.current.state).toMatchObject({ status: 'ready', stale: true, error });
  });

  it('sem gh ou sem login depois de uma leitura boa troca a lista pelo estado, e "sem PR" também', async () => {
    const responses = [
      okPr([PASSED]),
      fail('GH_NOT_AUTHENTICATED', 'Faça gh auth login'),
      okPr([PASSED]),
      { ok: true, data: { kind: 'no-pr' } } as AppResult<GithubPanelDto>,
    ];
    installApi(() => Promise.resolve(responses.shift() ?? okPr([])));
    const { result } = renderHook(() => useGithubPanel('p1', false));
    await settle();

    for (const status of ['no-login', 'ready', 'no-pr']) {
      act(() => result.current.refresh());
      await settle();
      expect(result.current.state.status).toBe(status);
    }
  });

  it('só a leitura mais nova vale: a resposta velha, que chega depois, não sobrescreve', async () => {
    const resolvers: Array<(value: AppResult<GithubPanelDto>) => void> = [];
    installApi(() => new Promise((resolve) => resolvers.push(resolve)));
    const { result } = renderHook(() => useGithubPanel('p1', false));
    act(() => result.current.refresh());
    expect(resolvers).toHaveLength(2);

    await act(async () => {
      resolvers[1]?.(okPr([PASSED], 'nova'));
      await Promise.resolve();
    });
    await act(async () => {
      resolvers[0]?.(okPr([PASSED], 'velha'));
      await Promise.resolve();
    });

    const { state } = result.current;
    expect(state.status === 'ready' && state.reading.pr.title).toBe('nova');
    expect(state.refreshing).toBe(false);
  });

  it('marca "refreshing" enquanto a leitura roda', async () => {
    let finish: (value: AppResult<GithubPanelDto>) => void = () => undefined;
    installApi(() => new Promise((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useGithubPanel('p1', false));

    expect(result.current.state.refreshing).toBe(true);
    await act(async () => {
      finish(okPr([PASSED]));
      await Promise.resolve();
    });
    expect(result.current.state.refreshing).toBe(false);
  });

  describe('recarga', () => {
    it('ao a janela ganhar o foco, juntando focos seguidos numa leitura só', async () => {
      const api = installApi(() => Promise.resolve(okPr([PASSED])));
      renderHook(() => useGithubPanel('p1', false));
      await settle();
      expect(api.pr).toHaveBeenCalledTimes(1);

      act(() => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('focus'));
        vi.advanceTimersByTime(GITHUB_RELOAD_DELAY_MS);
      });
      await settle();

      expect(api.pr).toHaveBeenCalledTimes(2);
    });

    it('depois de desmontar, o foco da janela não lê mais', async () => {
      const api = installApi(() => Promise.resolve(okPr([PASSED])));
      const { unmount } = renderHook(() => useGithubPanel('p1', false));
      await settle();
      unmount();

      act(() => {
        window.dispatchEvent(new Event('focus'));
        vi.advanceTimersByTime(GITHUB_RELOAD_DELAY_MS * 2);
      });

      expect(api.pr).toHaveBeenCalledTimes(1);
    });

    it('a cada 30 s com a aba visível e check pendente', async () => {
      const api = installApi(() => Promise.resolve(okPr([PASSED, RUNNING])));
      renderHook(() => useGithubPanel('p1', true));
      await settle();
      expect(api.pr).toHaveBeenCalledTimes(1);

      for (const expected of [2, 3]) {
        act(() => {
          vi.advanceTimersByTime(GITHUB_POLL_MS);
        });
        await settle();
        expect(api.pr).toHaveBeenCalledTimes(expected);
      }
    });

    it('sem check pendente, não relê sozinho', async () => {
      const api = installApi(() => Promise.resolve(okPr([PASSED])));
      renderHook(() => useGithubPanel('p1', true));
      await settle();

      act(() => {
        vi.advanceTimersByTime(GITHUB_POLL_MS * 3);
      });
      await settle();

      expect(api.pr).toHaveBeenCalledTimes(1);
    });

    it('com a aba fechada, não relê sozinho, mesmo com check pendente', async () => {
      const api = installApi(() => Promise.resolve(okPr([RUNNING])));
      renderHook(() => useGithubPanel('p1', false));
      await settle();

      act(() => {
        vi.advanceTimersByTime(GITHUB_POLL_MS * 3);
      });
      await settle();

      expect(api.pr).toHaveBeenCalledTimes(1);
    });

    it('abrir e fechar a aba liga e desliga o intervalo; os checks terminarem também', async () => {
      const responses = [okPr([RUNNING]), okPr([PASSED])];
      const api = installApi(() => Promise.resolve(responses.shift() ?? okPr([PASSED])));
      const { rerender } = renderHook(({ visible }) => useGithubPanel('p1', visible), {
        initialProps: { visible: false },
      });
      await settle();

      act(() => {
        vi.advanceTimersByTime(GITHUB_POLL_MS);
      });
      expect(api.pr).toHaveBeenCalledTimes(1);

      rerender({ visible: true });
      act(() => {
        vi.advanceTimersByTime(GITHUB_POLL_MS);
      });
      await settle();
      expect(api.pr).toHaveBeenCalledTimes(2);

      // Nessa leitura os checks terminaram: o intervalo para.
      act(() => {
        vi.advanceTimersByTime(GITHUB_POLL_MS * 3);
      });
      await settle();
      expect(api.pr).toHaveBeenCalledTimes(2);
    });

    it('não empilha uma leitura sobre outra que ainda não voltou', async () => {
      let first = true;
      const resolvers: Array<(value: AppResult<GithubPanelDto>) => void> = [];
      const api = installApi(() => {
        if (first) {
          first = false;
          return Promise.resolve(okPr([RUNNING]));
        }
        return new Promise((resolve) => resolvers.push(resolve));
      });
      renderHook(() => useGithubPanel('p1', true));
      await settle();

      act(() => {
        vi.advanceTimersByTime(GITHUB_POLL_MS * 3);
      });

      expect(api.pr).toHaveBeenCalledTimes(2);
    });
  });

  it('trocar de projeto zera o estado e lê o novo', async () => {
    const api = installApi(({ projectId }) =>
      Promise.resolve(okPr([PASSED], projectId === 'p1' ? 'do p1' : 'do p2')),
    );
    const { result, rerender } = renderHook(({ id }) => useGithubPanel(id, false), {
      initialProps: { id: 'p1' as string | null },
    });
    await settle();
    expect(result.current.state.status === 'ready' && result.current.state.reading.pr.title).toBe(
      'do p1',
    );

    rerender({ id: 'p2' });
    // Entre a troca e a resposta, o estado do projeto anterior não aparece.
    expect(result.current.state.status).not.toBe('ready');
    await settle();

    expect(api.pr).toHaveBeenLastCalledWith({ projectId: 'p2' });
    expect(result.current.state.status === 'ready' && result.current.state.reading.pr.title).toBe(
      'do p2',
    );

    rerender({ id: null });
    expect(result.current.state.status).toBe('loading');
  });

  it('voltar a um projeto depois de sair dele não traz a leitura antiga', async () => {
    installApi(() => Promise.resolve(okPr([PASSED])));
    const { result, rerender } = renderHook(({ id }) => useGithubPanel(id, false), {
      initialProps: { id: 'p1' },
    });
    await settle();
    rerender({ id: 'p2' });
    await settle();
    installApi(() => new Promise(() => undefined));
    rerender({ id: 'p1' });

    expect(result.current.state.status).toBe('loading');
  });

  describe('comentar e mesclar', () => {
    it('comment envia o número do PR da tela e relê ao terminar', async () => {
      const api = installApi(() => Promise.resolve(okPr([PASSED])));
      const { result } = renderHook(() => useGithubPanel('p1', false));
      await settle();

      let outcome: AppResult<void> | undefined;
      await act(async () => {
        outcome = await result.current.comment('Boa!');
      });

      expect(api.comment).toHaveBeenCalledWith({ projectId: 'p1', prNumber: 12, body: 'Boa!' });
      expect(outcome).toEqual({ ok: true, data: undefined });
      expect(api.pr).toHaveBeenCalledTimes(2);
      expect(result.current.state.writing).toBe(false);
    });

    it('merge envia a forma escolhida e, mesmo recusado, relê e devolve o erro', async () => {
      const api = installApi(() => Promise.resolve(okPr([PASSED])));
      api.merge.mockResolvedValueOnce(fail('GH_PR_NOT_MERGEABLE', 'O PR não pode ser mesclado'));
      const { result } = renderHook(() => useGithubPanel('p1', false));
      await settle();

      let outcome: AppResult<void> | undefined;
      await act(async () => {
        outcome = await result.current.merge('squash');
      });

      expect(api.merge).toHaveBeenCalledWith({ projectId: 'p1', prNumber: 12, method: 'squash' });
      expect(outcome).toMatchObject({ ok: false, error: { code: 'GH_PR_NOT_MERGEABLE' } });
      expect(api.pr).toHaveBeenCalledTimes(2);
    });

    it('marca "writing" enquanto a escrita roda', async () => {
      const api = installApi(() => Promise.resolve(okPr([PASSED])));
      let finish: (value: AppResult<void>) => void = () => undefined;
      api.comment.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
      const { result } = renderHook(() => useGithubPanel('p1', false));
      await settle();

      let pending: Promise<AppResult<void>> | undefined;
      act(() => {
        pending = result.current.comment('oi');
      });
      expect(result.current.state.writing).toBe(true);

      await act(async () => {
        finish({ ok: true, data: undefined });
        await pending;
      });
      expect(result.current.state.writing).toBe(false);
    });

    it('uma exceção do preload na escrita vira erro com o texto geral', async () => {
      const api = installApi(() => Promise.resolve(okPr([PASSED])));
      api.comment.mockRejectedValueOnce(new Error('boom'));
      const { result } = renderHook(() => useGithubPanel('p1', false));
      await settle();

      let outcome: AppResult<void> | undefined;
      await act(async () => {
        outcome = await result.current.comment('oi');
      });

      expect(outcome).toMatchObject({
        ok: false,
        error: { message: 'Não foi possível concluir a operação no GitHub.' },
      });
      expect(result.current.state.writing).toBe(false);
    });

    it('uma exceção síncrona do preload na escrita não deixa "writing" ligado', async () => {
      const api = installApi(() => Promise.resolve(okPr([PASSED])));
      api.merge.mockImplementationOnce(() => {
        throw new Error('boom');
      });
      const { result } = renderHook(() => useGithubPanel('p1', false));
      await settle();

      let outcome: AppResult<void> | undefined;
      await act(async () => {
        outcome = await result.current.merge('merge');
      });

      expect(outcome).toMatchObject({
        ok: false,
        error: { message: 'Não foi possível concluir a operação no GitHub.' },
      });
      expect(result.current.state.writing).toBe(false);
    });

    it('sem PR na tela, não chama o processo principal e devolve GH_PR_NOT_FOUND', async () => {
      const api = installApi(() => Promise.resolve({ ok: true, data: { kind: 'no-pr' } }));
      const { result } = renderHook(() => useGithubPanel('p1', false));
      await settle();

      const comment = await result.current.comment('oi');
      const merge = await result.current.merge('merge');

      expect(api.comment).not.toHaveBeenCalled();
      expect(api.merge).not.toHaveBeenCalled();
      expect(comment).toMatchObject({ ok: false, error: { code: 'GH_PR_NOT_FOUND' } });
      expect(merge).toMatchObject({ ok: false, error: { code: 'GH_PR_NOT_FOUND' } });
    });
  });
});
