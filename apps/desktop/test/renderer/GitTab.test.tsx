import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppResult, GitStatusDto, ProjectHubApi } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { GitTab } from '../../src/renderer/components/right-panel/GitTab';
import { PROJECTS_CHANGED_EVENT } from '../../src/renderer/projects-events';
import { useGitPanel } from '../../src/renderer/use-git-panel';
import { readCss, ruleDeclarations } from './css-rules';

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

  it('pronto, mostra a branch no cabeçalho', async () => {
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
  });

  it('com o HEAD destacado, mostra "HEAD destacado"', async () => {
    install(ok(status({ branch: null })));

    render(<GitTab projectId="p1" active />);

    expect(await screen.findByText('HEAD destacado')).toBeInTheDocument();
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

describe('GitTab: ações de commit e remote', () => {
  const STAGED = { path: 'a.ts', staged: 'M', unstaged: null } as const;
  const DIRTY = { path: 'b.ts', staged: null, unstaged: 'M' } as const;
  const okVoid = () => Promise.resolve({ ok: true, data: undefined });
  const fail = (message: string) =>
    Promise.resolve({ ok: false, error: { code: 'GIT_FAILED', message } });

  type Mocks = Record<'commit' | 'push' | 'publish' | 'pull' | 'fetch' | 'log', Mock>;
  let git: Mocks;
  let calls: string[];

  function commits(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      sha: `sha${index}`,
      shortSha: `s${index}`,
      author: 'Ana',
      date: '2026-11-01T10:00:00Z',
      refs: [],
      subject: `commit número ${index}`,
    }));
  }

  function installRemote(data: GitStatusDto, overrides: Partial<Mocks> = {}) {
    calls = [];
    const record = (name: string, result: () => Promise<unknown>) =>
      vi.fn(() => {
        calls.push(name);
        return result();
      });
    git = {
      commit: record('commit', () => Promise.resolve({ ok: true, data: { commit: 'abc' } })),
      push: record('push', () => Promise.resolve({ ok: true, data: { branch: 'main' } })),
      publish: record('publish', () => Promise.resolve({ ok: true, data: { branch: 'main' } })),
      pull: record('pull', () => Promise.resolve({ ok: true, data: { updated: true } })),
      fetch: record('fetch', okVoid),
      log: vi.fn(() => Promise.resolve({ ok: true, data: commits(0) })),
      ...overrides,
    } as Mocks;
    statusMock = vi.fn(() => Promise.resolve({ ok: true as const, data }));
    window.projectHub = {
      git: {
        status: statusMock,
        branchChanges: () =>
          Promise.resolve({ ok: true, data: { baseRef: null, mergeBase: null, files: [] } }),
        ...git,
      },
    } as unknown as ProjectHubApi;
  }

  async function choose(user: ReturnType<typeof userEvent.setup>, item: string) {
    await user.click(await screen.findByRole('button', { name: 'Mais ações de commit e remote' }));
    await user.click(screen.getByRole('menuitem', { name: item }));
  }

  it('fetch roda direto, sem diálogo, e o estado é relido', async () => {
    const user = userEvent.setup();
    installRemote(status());
    render(<GitTab projectId="p1" active />);

    await choose(user, 'Fetch');

    expect(git.fetch).toHaveBeenCalledWith({ projectId: 'p1' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(2));
  });

  it('a falha do fetch aparece em alerta', async () => {
    const user = userEvent.setup();
    installRemote(status(), { fetch: vi.fn(() => fail('sem rede')) as never });
    render(<GitTab projectId="p1" active />);

    await choose(user, 'Fetch');

    expect(await screen.findByRole('alert')).toHaveTextContent('sem rede');
  });

  it('push abre o diálogo com os commits e só envia depois de confirmar', async () => {
    const user = userEvent.setup();
    installRemote(status({ ahead: 2 }), {
      log: vi.fn(() => Promise.resolve({ ok: true, data: commits(5) })) as never,
    });
    render(<GitTab projectId="p1" active />);

    await choose(user, 'Push');

    const dialog = await screen.findByRole('dialog', {
      name: 'Enviar 2 commits de main para origin/main?',
    });
    expect(git.log).toHaveBeenCalledWith({ projectId: 'p1' });
    expect(await screen.findByText('commit número 0')).toBeInTheDocument();
    expect(screen.getByText('commit número 1')).toBeInTheDocument();
    expect(screen.queryByText('commit número 2')).not.toBeInTheDocument();
    expect(git.push).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Enviar' }));

    expect(git.push).toHaveBeenCalledWith({ projectId: 'p1' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(2));
  });

  it('com mais de 50 commits à frente, lista 50 e diz "e mais X"', async () => {
    const user = userEvent.setup();
    installRemote(status({ ahead: 60 }), {
      log: vi.fn(() => Promise.resolve({ ok: true, data: commits(50) })) as never,
    });
    render(<GitTab projectId="p1" active />);

    await choose(user, 'Push');

    expect(await screen.findByText('e mais 10')).toBeInTheDocument();
    expect(screen.getAllByText(/^commit número /)).toHaveLength(50);
  });

  it('Cancelar no diálogo de push não envia e devolve o foco ao botão do menu', async () => {
    const user = userEvent.setup();
    installRemote(status({ ahead: 1 }));
    render(<GitTab projectId="p1" active />);

    await choose(user, 'Push');
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));

    expect(git.push).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mais ações de commit e remote' })).toHaveFocus();
  });

  it('push sem commits à frente fica desligado e não abre diálogo', async () => {
    const user = userEvent.setup();
    installRemote(status({ ahead: 0 }));
    render(<GitTab projectId="p1" active />);

    await choose(user, 'Push');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(git.push).not.toHaveBeenCalled();
  });

  it('sem upstream, oferece Publicar (e não Push) e publica só depois de confirmar', async () => {
    const user = userEvent.setup();
    installRemote(status({ upstream: null }));
    render(<GitTab projectId="p1" active />);

    await choose(user, 'Publicar branch');

    const dialog = await screen.findByRole('dialog', {
      name: 'Publicar a branch main no origin e definir o upstream?',
    });
    expect(git.publish).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Publicar' }));

    expect(git.publish).toHaveBeenCalledWith({ projectId: 'p1' });
    expect(git.push).not.toHaveBeenCalled();
  });

  it('pull sem commits atrás não abre diálogo e diz que já está atualizada', async () => {
    const user = userEvent.setup();
    installRemote(status({ behind: 0 }), {
      pull: vi.fn(() => Promise.resolve({ ok: true, data: { updated: false } })) as never,
    });
    render(<GitTab projectId="p1" active />);

    await choose(user, 'Pull');

    expect(git.pull).toHaveBeenCalledWith({ projectId: 'p1' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('A branch já está atualizada.');
  });

  it('pull com commits atrás abre o diálogo e só traz depois de "Trazer"', async () => {
    const user = userEvent.setup();
    installRemote(status({ behind: 3 }));
    render(<GitTab projectId="p1" active />);

    await choose(user, 'Pull');

    const dialog = await screen.findByRole('dialog', {
      name: 'Trazer 3 commits de origin/main? (só avança, sem criar commit de merge)',
    });
    expect(git.pull).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Trazer' }));

    expect(git.pull).toHaveBeenCalledWith({ projectId: 'p1' });
  });

  it('pull com a branch divergida explica no diálogo, sem botão "Trazer"', async () => {
    const user = userEvent.setup();
    installRemote(status({ ahead: 1, behind: 2 }));
    render(<GitTab projectId="p1" active />);

    await choose(user, 'Pull');

    const dialog = await screen.findByRole('dialog', {
      name: 'A branch divergiu: resolva no terminal.',
    });
    expect(within(dialog).queryByRole('button', { name: 'Trazer' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
    expect(git.pull).not.toHaveBeenCalled();
  });

  it('"Commit" no menu commita com a mensagem aparada, sem diálogo, e limpa a mensagem', async () => {
    const user = userEvent.setup();
    installRemote(status({ files: [STAGED] }));
    render(<GitTab projectId="p1" active />);
    const box = await screen.findByRole('textbox', { name: 'Mensagem do commit' });
    await user.type(box, '  feat: algo  ');

    await choose(user, 'Commit');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(git.commit).toHaveBeenCalledWith({ projectId: 'p1', message: 'feat: algo' });
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('"Commit e push" abre o diálogo antes de qualquer escrita, com a mensagem, o stage e o que fica de fora', async () => {
    const user = userEvent.setup();
    installRemote(status({ files: [STAGED, DIRTY], ahead: 0 }));
    render(<GitTab projectId="p1" active />);
    await user.type(await screen.findByRole('textbox', { name: 'Mensagem do commit' }), 'feat: x');

    await choose(user, 'Commit e push');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('feat: x')).toBeInTheDocument();
    expect(within(dialog).getByText('a.ts')).toBeInTheDocument();
    expect(within(dialog).getByText(/1 arquivo fica de fora/)).toBeInTheDocument();
    expect(git.commit).not.toHaveBeenCalled();
    expect(git.push).not.toHaveBeenCalled();
  });

  it('confirmar "Commit e push" commita e só então envia', async () => {
    const user = userEvent.setup();
    installRemote(status({ files: [STAGED] }));
    render(<GitTab projectId="p1" active />);
    await user.type(await screen.findByRole('textbox', { name: 'Mensagem do commit' }), 'feat: x');

    await choose(user, 'Commit e push');
    await user.click(await screen.findByRole('button', { name: 'Commitar e enviar' }));

    await waitFor(() => expect(git.push).toHaveBeenCalledWith({ projectId: 'p1' }));
    expect(git.commit).toHaveBeenCalledWith({ projectId: 'p1', message: 'feat: x' });
    expect(calls).toEqual(['commit', 'push']);
  });

  it('sem upstream, "Commit e push" confirma com "Commitar e publicar" e publica', async () => {
    const user = userEvent.setup();
    installRemote(status({ files: [STAGED], upstream: null }));
    render(<GitTab projectId="p1" active />);
    await user.type(await screen.findByRole('textbox', { name: 'Mensagem do commit' }), 'feat: x');

    await choose(user, 'Commit e push');
    await user.click(await screen.findByRole('button', { name: 'Commitar e publicar' }));

    await waitFor(() => expect(git.publish).toHaveBeenCalledWith({ projectId: 'p1' }));
    expect(calls).toEqual(['commit', 'publish']);
  });

  it('se o commit falha, não envia e mostra o erro', async () => {
    const user = userEvent.setup();
    installRemote(status({ files: [STAGED] }), {
      commit: vi.fn(() => fail('hook recusou')) as never,
    });
    render(<GitTab projectId="p1" active />);
    const box = await screen.findByRole('textbox', { name: 'Mensagem do commit' });
    await user.type(box, 'feat: x');

    await choose(user, 'Commit e push');
    await user.click(await screen.findByRole('button', { name: 'Commitar e enviar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('hook recusou');
    expect(git.push).not.toHaveBeenCalled();
    expect(box).toHaveValue('feat: x');
  });

  it('a saída de hook com várias linhas aparece como texto puro, sem virar HTML', async () => {
    const user = userEvent.setup();
    const message = 'Um hook do Git recusou o commit.\n\nerro: <b>falhou</b>\n  linha 2';
    installRemote(status({ files: [STAGED] }), { commit: vi.fn(() => fail(message)) as never });
    render(<GitTab projectId="p1" active />);
    await user.type(await screen.findByRole('textbox', { name: 'Mensagem do commit' }), 'feat: x');

    await choose(user, 'Commit');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(message);
    expect(alert.querySelector('b')).toBeNull();
    expect(alert).toHaveClass('git-tab__error');
  });

  it('uma nova ação limpa o aviso "já está atualizada"', async () => {
    const user = userEvent.setup();
    installRemote(status(), {
      pull: vi.fn(() => Promise.resolve({ ok: true, data: { updated: false } })) as never,
    });
    render(<GitTab projectId="p1" active />);
    await choose(user, 'Pull');
    await screen.findByText('A branch já está atualizada.');

    await choose(user, 'Fetch');

    await waitFor(() =>
      expect(screen.queryByText('A branch já está atualizada.')).not.toBeInTheDocument(),
    );
  });
});

describe('GitTab: estilos', () => {
  it('o alerta de escrita mantém as quebras de linha da saída de um hook', () => {
    const css = readCss('right-panel.css');

    expect(ruleDeclarations(css, '.git-tab__error').get('white-space')).toBe('pre-wrap');
  });
});
