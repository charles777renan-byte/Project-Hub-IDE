import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppResult, GitStatusDto, ProjectHubApi } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { GitTab } from '../../src/renderer/components/right-panel/GitTab';
import { PROJECTS_CHANGED_EVENT } from '../../src/renderer/projects-events';
import { useGitPanel } from '../../src/renderer/use-git-panel';

/** O hook compartilhado do estado Git e a aba Código-fonte. */

function status(overrides: Partial<GitStatusDto> = {}): GitStatusDto {
  return {
    branch: 'main',
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    baseRef: 'origin/main',
    linesAdded: 0,
    linesRemoved: 0,
    files: [],
    ...overrides,
  };
}

function failure(code: string, message = 'falhou'): AppResult<GitStatusDto> {
  return { ok: false, error: { code, message } } as unknown as AppResult<GitStatusDto>;
}

let statusMock: Mock<(input: { projectId: string }) => Promise<AppResult<GitStatusDto>>>;

function install(result: () => Promise<AppResult<GitStatusDto>>) {
  statusMock = vi.fn(result);
  window.projectHub = {
    git: {
      status: statusMock,
      branchChanges: () =>
        Promise.resolve({ ok: true, data: { baseRef: null, mergeBase: null, files: [] } }),
      log: () => Promise.resolve({ ok: true, data: [] }),
    },
  } as unknown as ProjectHubApi;
}

const ok =
  (data = status()) =>
  () =>
    Promise.resolve({ ok: true as const, data });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useGitPanel', () => {
  beforeEach(() => install(ok()));

  it('com a aba fechada, não lê', async () => {
    const { result } = renderHook(() => useGitPanel('p1', false));

    await act(() => Promise.resolve());
    expect(statusMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe('loading');
  });

  it('sem projeto, não lê', async () => {
    renderHook(() => useGitPanel(null, true));

    await act(() => Promise.resolve());
    expect(statusMock).not.toHaveBeenCalled();
  });

  it('ao virar ativo, lê com o projeto e chega a ready', async () => {
    const { result, rerender } = renderHook(({ active }) => useGitPanel('p1', active), {
      initialProps: { active: false },
    });
    expect(statusMock).not.toHaveBeenCalled();

    rerender({ active: true });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(statusMock).toHaveBeenCalledWith({ projectId: 'p1' });
    expect(result.current.data?.branch).toBe('main');
  });

  it('PROJECTS_CHANGED_EVENT com a aba aberta relê; com a aba fechada, não', async () => {
    const { result, rerender } = renderHook(({ active }) => useGitPanel('p1', active), {
      initialProps: { active: true },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(statusMock).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
    });
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(2));

    rerender({ active: false });
    act(() => {
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
    });
    await new Promise((done) => setTimeout(done, 400));
    expect(statusMock).toHaveBeenCalledTimes(2);
  });

  it('o foco da janela relê, e eventos seguidos viram uma leitura só', async () => {
    const { result } = renderHook(() => useGitPanel('p1', true));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(2));
    await new Promise((done) => setTimeout(done, 400));
    expect(statusMock).toHaveBeenCalledTimes(2);
  });

  it('dois consumidores do mesmo projeto dividem uma leitura só', async () => {
    const first = renderHook(() => useGitPanel('p1', true));
    const second = renderHook(() => useGitPanel('p1', true));

    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    expect(statusMock).toHaveBeenCalledTimes(1);
  });

  it('desmontar o último consumidor desfaz o ouvinte da janela', async () => {
    const { result, unmount } = renderHook(() => useGitPanel('p1', true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    unmount();

    window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
    await new Promise((done) => setTimeout(done, 400));
    expect(statusMock).toHaveBeenCalledTimes(1);
  });

  it('reload() relê na hora', async () => {
    const { result } = renderHook(() => useGitPanel('p1', true));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.reload());

    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(2));
  });

  it('track marca ocupação enquanto a promessa roda e relê ao terminar', async () => {
    const { result } = renderHook(() => useGitPanel('p1', true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let finish!: () => void;
    const pending = new Promise<void>((done) => {
      finish = done;
    });

    act(() => {
      void result.current.track(pending);
    });
    expect(result.current.busy).toBe(true);

    await act(async () => {
      finish();
      await pending;
    });
    await waitFor(() => expect(result.current.busy).toBe(false));
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(2));
  });
});

describe('useGitPanel: mapeamento da resposta', () => {
  it.each([
    ['VALIDATION_FAILED', 'not-git'],
    ['PROJECT_PATH_UNAVAILABLE', 'unavailable'],
    ['GIT_FAILED', 'error'],
  ] as const)('o código %s vira %s', async (code, expected) => {
    install(() => Promise.resolve(failure(code, 'mensagem do processo principal')));

    const { result } = renderHook(() => useGitPanel('p1', true));

    await waitFor(() => expect(result.current.status).toBe(expected));
    expect(result.current.data).toBeNull();
    if (expected === 'error') expect(result.current.message).toBe('mensagem do processo principal');
  });

  it('uma exceção vira error com o texto geral', async () => {
    install(() => Promise.reject(new Error('sem preload')));

    const { result } = renderHook(() => useGitPanel('p1', true));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.message).toBe('Não foi possível ler o estado do Git.');
  });
});

describe('GitTab', () => {
  it('sem projeto, mostra o aviso de abrir um projeto e não lê', async () => {
    install(ok());

    render(<GitTab projectId={null} active />);

    expect(screen.getByText('Abra um projeto para ver os arquivos')).toBeInTheDocument();
    await act(() => Promise.resolve());
    expect(statusMock).not.toHaveBeenCalled();
  });

  it('carregando, diz que carrega', () => {
    install(() => new Promise(() => undefined));

    render(<GitTab projectId="p1" active />);

    expect(screen.getByText('Carregando…')).toBeInTheDocument();
  });

  it('pronto, mostra a branch e a contagem de arquivos alterados', async () => {
    install(
      ok(
        status({
          branch: 'feat/x',
          files: [
            { path: 'a.ts', staged: null, unstaged: 'M' },
            { path: 'b.ts', staged: 'A', unstaged: null },
          ],
        }),
      ),
    );

    render(<GitTab projectId="p1" active />);

    expect(await screen.findByText('feat/x')).toBeInTheDocument();
    expect(screen.getByText('2 arquivos alterados')).toBeInTheDocument();
  });

  it('com o HEAD destacado, mostra "HEAD destacado"', async () => {
    install(ok(status({ branch: null })));

    render(<GitTab projectId="p1" active />);

    expect(await screen.findByText('HEAD destacado')).toBeInTheDocument();
    expect(screen.getByText('Nenhum arquivo alterado')).toBeInTheDocument();
  });

  it('fora de um repositório, diz que a pasta não é Git', async () => {
    install(() => Promise.resolve(failure('VALIDATION_FAILED')));

    render(<GitTab projectId="p1" active />);

    expect(await screen.findByText('Esta pasta não é um repositório Git')).toBeInTheDocument();
  });

  it('com a pasta ausente, diz "Pasta indisponível"', async () => {
    install(() => Promise.resolve(failure('PROJECT_PATH_UNAVAILABLE')));

    render(<GitTab projectId="p1" active />);

    expect(await screen.findByText('Pasta indisponível')).toBeInTheDocument();
  });

  it('no erro, mostra a mensagem e "Tentar de novo" relê', async () => {
    const user = userEvent.setup();
    install(() => Promise.resolve(failure('GIT_FAILED', 'o git quebrou')));

    render(<GitTab projectId="p1" active />);

    expect(await screen.findByText('o git quebrou')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(2));
  });

  it('o botão Atualizar tem nome acessível e relê', async () => {
    const user = userEvent.setup();
    install(ok());

    render(<GitTab projectId="p1" active />);

    await user.click(await screen.findByRole('button', { name: 'Atualizar' }));
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(2));
  });

  it('com a aba inativa, não lê', async () => {
    install(ok());

    render(<GitTab projectId="p1" active={false} />);

    await act(() => Promise.resolve());
    expect(statusMock).not.toHaveBeenCalled();
  });
});

type Pending = {
  promise: Promise<AppResult<GitStatusDto>>;
  resolve: (data: GitStatusDto) => void;
};

function pending(): Pending {
  let resolve!: (data: GitStatusDto) => void;
  const promise = new Promise<AppResult<GitStatusDto>>((done) => {
    resolve = (data) => done({ ok: true, data });
  });
  return { promise, resolve };
}

describe('useGitPanel: gatilhos e descarte', () => {
  beforeEach(() => install(ok()));

  it('só o foco da janela, sem outro evento, relê', async () => {
    const { result } = renderHook(() => useGitPanel('p1', true));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(2));
  });

  it('descarta a resposta antiga que chega depois da mais nova', async () => {
    const first = pending();
    const second = pending();
    const queue = [first, second];
    install(() => queue.shift()?.promise ?? Promise.resolve(failure('GIT_FAILED')));
    const { result } = renderHook(() => useGitPanel('p1', true));
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(1));

    act(() => result.current.reload());
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.resolve(status({ branch: 'nova' }));
      await second.promise;
    });
    await waitFor(() => expect(result.current.data?.branch).toBe('nova'));
    await act(async () => {
      first.resolve(status({ branch: 'antiga' }));
      await first.promise;
    });

    expect(result.current.data?.branch).toBe('nova');
  });

  it('a resposta de uma entrada que saiu não vale para a que voltou', async () => {
    const stale = pending();
    const fresh = pending();
    const queue = [stale, fresh];
    install(() => queue.shift()?.promise ?? Promise.resolve(failure('GIT_FAILED')));
    const old = renderHook(() => useGitPanel('p1', true));
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(1));
    old.unmount();

    const back = renderHook(() => useGitPanel('p1', true));
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(2));
    await act(async () => {
      fresh.resolve(status({ branch: 'nova' }));
      await fresh.promise;
    });
    await waitFor(() => expect(back.result.current.data?.branch).toBe('nova'));
    await act(async () => {
      stale.resolve(status({ branch: 'antiga' }));
      await stale.promise;
    });

    expect(back.result.current.data?.branch).toBe('nova');
  });

  it('o fim de um track de entrada que saiu não relê a que voltou', async () => {
    const old = renderHook(() => useGitPanel('p1', true));
    await waitFor(() => expect(old.result.current.status).toBe('ready'));
    let finish!: () => void;
    const write = new Promise<void>((done) => {
      finish = done;
    });
    act(() => {
      void old.result.current.track(write);
    });
    old.unmount();
    const back = renderHook(() => useGitPanel('p1', true));
    await waitFor(() => expect(back.result.current.status).toBe('ready'));
    const reads = statusMock.mock.calls.length;

    await act(async () => {
      finish();
      await write;
    });
    await new Promise((done) => setTimeout(done, 50));

    expect(statusMock).toHaveBeenCalledTimes(reads);
  });

  it('liberar o último consumidor remove os ouvintes da janela e nenhum evento lê depois', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { result, unmount } = renderHook(() => useGitPanel('p1', true));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    unmount();

    const removed = remove.mock.calls.map(([name]) => name);
    expect(removed).toContain(PROJECTS_CHANGED_EVENT);
    expect(removed).toContain('focus');
    window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
    window.dispatchEvent(new Event('focus'));
    await new Promise((done) => setTimeout(done, 400));
    expect(statusMock).toHaveBeenCalledTimes(1);
  });
});

describe('GitTab: dica do botão Atualizar', () => {
  it('a dica diz "Atualizar" e o botão tem aria-label "Atualizar"', async () => {
    const user = userEvent.setup();
    install(ok());
    render(<GitTab projectId="p1" active />);
    const button = await screen.findByRole('button', { name: 'Atualizar' });

    await user.tab();

    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-label', 'Atualizar');
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Atualizar');
  });
});

describe('GitTab: escritas', () => {
  it('uma escrita relê o estado ao terminar; a falha aparece em alerta', async () => {
    const user = userEvent.setup();
    install(ok(status({ files: [{ path: 'a.ts', staged: null, unstaged: 'M' }] })));
    const stage = vi.fn(() =>
      Promise.resolve({ ok: false, error: { code: 'GIT_FAILED', message: 'sem permissão' } }),
    );
    (window.projectHub.git as unknown as { stage: unknown }).stage = stage;
    render(<GitTab projectId="p1" active />);

    await user.click(await screen.findByRole('button', { name: 'Colocar em stage a.ts' }));

    expect(stage).toHaveBeenCalledWith({ projectId: 'p1', paths: ['a.ts'] });
    expect(await screen.findByRole('alert')).toHaveTextContent('sem permissão');
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(2));
  });
});
