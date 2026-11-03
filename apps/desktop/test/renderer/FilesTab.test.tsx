import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppResult, FileEntryDto, NameSearchDto, ProjectHubApi } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { FilesTab } from '../../src/renderer/components/right-panel/FilesTab';

/** A aba Arquivos: cabeçalho, alternância de buscas, campo com atraso, resultados e estados. */

function entry(path: string, kind: FileEntryDto['kind'] = 'file'): FileEntryDto {
  return { name: path.split('/').pop() ?? path, path, kind, ignored: false };
}

const ROOT = [entry('src', 'directory'), entry('README.md')];
const SRC = [entry('src/main.ts')];

type Deferred<T> = { promise: Promise<AppResult<T>>; resolve: (value: AppResult<T>) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: AppResult<T>) => void;
  const promise = new Promise<AppResult<T>>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function names(...paths: string[]): AppResult<NameSearchDto> {
  return { ok: true, data: { paths, truncated: false } };
}

type FilesApi = ProjectHubApi['files'];
type FilesMocks = { [K in 'list' | 'searchNames' | 'searchContent']: Mock<FilesApi[K]> };

function installApi(overrides: Partial<FilesMocks> = {}): FilesMocks {
  const files: FilesMocks = {
    list: vi.fn<FilesApi['list']>((_projectId, dir) =>
      Promise.resolve({ ok: true, data: dir === '' ? ROOT : SRC }),
    ),
    searchNames: vi.fn<FilesApi['searchNames']>(() => Promise.resolve(names())),
    searchContent: vi.fn<FilesApi['searchContent']>(() =>
      Promise.resolve({ ok: true, data: { matches: [], truncated: false } }),
    ),
    ...overrides,
  };
  window.projectHub = {
    files,
    projects: {
      list: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          data: [
            {
              id: 'p1',
              name: 'Meu Projeto',
              path: 'C:\\Users\\pessoa\\meu-projeto',
              repositoryKind: 'git' as const,
              available: true,
              defaultBranch: 'main',
            },
          ],
        }),
      ),
    },
    missions: {
      list: vi.fn(() => Promise.resolve({ ok: true as const, data: [] })),
      subscribe: vi.fn(() => () => undefined),
    },
  } as unknown as ProjectHubApi;
  return files;
}

function field(): HTMLElement {
  return screen.getByRole('searchbox', { name: 'Encontrar arquivos' });
}

/**
 * Digita no campo letra a letra, sem o user-event: com temporizadores falsos do Vitest a espera interna da
 * Testing Library nunca termina, e aqui só interessa a sequência de valores que o campo recebe.
 */
function typeFast(text: string, from = '') {
  for (let size = 1; size <= text.length; size += 1) {
    fireEvent.change(field(), { target: { value: from + text.slice(0, size) } });
  }
}

/** Deixa as promessas já resolvidas e os temporizadores falsos andarem. */
async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'projectHub');
});

describe('FilesTab', () => {
  it('lê a raiz ao montar, mostra o nome do projeto e o botão Atualizar', async () => {
    const files = installApi();
    render(<FilesTab projectId="p1" onOpenFile={vi.fn()} />);

    expect(files.list).toHaveBeenCalledWith('p1', '');
    expect(await screen.findByRole('treeitem', { name: /^src/ })).toBeInTheDocument();
    expect(await screen.findByText('Meu Projeto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atualizar' })).toBeInTheDocument();
  });

  it('tem a alternância Nomes e Conteúdo, com Nomes escolhida', async () => {
    installApi();
    const user = userEvent.setup();
    render(<FilesTab projectId="p1" onOpenFile={vi.fn()} />);

    const list = screen.getByRole('tablist', { name: 'Tipo de busca' });
    const [nomes, conteudo] = within(list).getAllByRole('tab');
    expect(nomes).toHaveTextContent('Nomes');
    expect(nomes).toHaveAttribute('aria-selected', 'true');
    expect(conteudo).toHaveTextContent('Conteúdo');
    expect(conteudo).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByRole('checkbox', { name: 'Regex' })).not.toBeInTheDocument();

    await user.click(conteudo!);

    expect(conteudo).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('checkbox', { name: 'Regex' })).toBeInTheDocument();

    await user.keyboard('{ArrowLeft}');
    expect(nomes).toHaveAttribute('aria-selected', 'true');
    expect(nomes).toHaveFocus();
  });

  it('digitar rápido em Nomes faz uma só chamada, 150 ms depois da última tecla', async () => {
    const files = installApi({ searchNames: vi.fn(() => Promise.resolve(names('src/main.ts'))) });
    render(<FilesTab projectId="p1" onOpenFile={vi.fn()} />);
    await screen.findByRole('treeitem', { name: /^src/ });
    vi.useFakeTimers();

    typeFast('main');
    await advance(149);
    expect(files.searchNames).not.toHaveBeenCalled();
    await advance(1);

    expect(files.searchNames).toHaveBeenCalledTimes(1);
    expect(files.searchNames).toHaveBeenCalledWith('p1', 'main');
    expect(screen.getByRole('button', { name: /main\.ts/ })).toBeInTheDocument();
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
  });

  it('mostra só o último resultado, mesmo se a resposta antiga chegar depois', async () => {
    const first = deferred<NameSearchDto>();
    const second = deferred<NameSearchDto>();
    const searchNames = vi
      .fn<(projectId: string, query: string) => Promise<AppResult<NameSearchDto>>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    installApi({ searchNames });
    render(<FilesTab projectId="p1" onOpenFile={vi.fn()} />);
    await screen.findByRole('treeitem', { name: /^src/ });
    vi.useFakeTimers();

    typeFast('a');
    await advance(150);
    typeFast('b', 'a');
    await advance(150);
    expect(searchNames).toHaveBeenCalledTimes(2);

    await act(async () => second.resolve(names('novo/ab.ts')));
    await act(async () => first.resolve(names('velho/a.ts')));

    expect(screen.getByRole('button', { name: /ab\.ts/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /velho/ })).not.toBeInTheDocument();
  });

  it('enquanto espera a busca mostra "Carregando…", e sem resultado "Nenhum arquivo encontrado"', async () => {
    const pending = deferred<NameSearchDto>();
    const searchNames = vi
      .fn<(projectId: string, query: string) => Promise<AppResult<NameSearchDto>>>()
      .mockReturnValueOnce(pending.promise);
    installApi({ searchNames });
    render(<FilesTab projectId="p1" onOpenFile={vi.fn()} />);
    await screen.findByRole('treeitem', { name: /^src/ });
    vi.useFakeTimers();

    typeFast('zzz');
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    expect(screen.queryByText('Nenhum arquivo encontrado')).not.toBeInTheDocument();
    await advance(150);
    await act(async () => pending.resolve(names()));

    expect(screen.queryByText('Carregando…')).not.toBeInTheDocument();
    expect(screen.getByText('Nenhum arquivo encontrado')).toBeInTheDocument();
  });

  it('Enter ou clique num resultado de nome abre o arquivo', async () => {
    installApi({
      searchNames: vi.fn(() => Promise.resolve(names('src/main.ts', 'docs/main.md'))),
    });
    const onOpenFile = vi.fn();
    const user = userEvent.setup();
    render(<FilesTab projectId="p1" onOpenFile={onOpenFile} />);

    await user.type(field(), 'main');
    const first = await screen.findByRole('button', { name: /main\.ts/ });
    first.focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: /main\.md/ }));

    expect(onOpenFile).toHaveBeenNthCalledWith(1, 'src/main.ts');
    expect(onOpenFile).toHaveBeenNthCalledWith(2, 'docs/main.md');
  });

  it('as setas andam entre os resultados, a partir do campo', async () => {
    installApi({ searchNames: vi.fn(() => Promise.resolve(names('a/um.ts', 'b/dois.ts'))) });
    const user = userEvent.setup();
    render(<FilesTab projectId="p1" onOpenFile={vi.fn()} />);

    await user.type(field(), 'ts');
    await screen.findByRole('button', { name: /um\.ts/ });
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: /um\.ts/ })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: /dois\.ts/ })).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(field()).toHaveFocus();
  });

  it('em Conteúdo espera 300 ms e mostra o caminho, "linha 12" e o trecho', async () => {
    const searchContent = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: {
          matches: [{ path: 'src/main.ts', line: 12, text: '  const alvo = 1;' }],
          truncated: false,
        },
      }),
    );
    installApi({ searchContent });
    const onOpenFile = vi.fn();
    render(<FilesTab projectId="p1" onOpenFile={onOpenFile} />);
    await screen.findByRole('treeitem', { name: /^src/ });
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('tab', { name: 'Conteúdo' }));
    typeFast('alvo');
    await advance(299);
    expect(searchContent).not.toHaveBeenCalled();
    await advance(1);

    expect(searchContent).toHaveBeenCalledWith('p1', 'alvo', false);
    const result = screen.getByRole('button', { name: /src\/main\.ts/ });
    expect(result).toHaveTextContent('linha 12');
    expect(result).toHaveTextContent('const alvo = 1;');

    fireEvent.click(result);
    expect(onOpenFile).toHaveBeenCalledWith('src/main.ts');
  });

  it('a opção Regex manda regex verdadeiro e refaz a busca', async () => {
    const searchContent = vi.fn(() =>
      Promise.resolve({ ok: true as const, data: { matches: [], truncated: false } }),
    );
    installApi({ searchContent });
    const user = userEvent.setup();
    render(<FilesTab projectId="p1" onOpenFile={vi.fn()} />);

    await user.click(screen.getByRole('tab', { name: 'Conteúdo' }));
    await user.type(field(), 'a.+b');
    await waitFor(() => expect(searchContent).toHaveBeenCalledWith('p1', 'a.+b', false));
    await user.click(screen.getByRole('checkbox', { name: 'Regex' }));

    await waitFor(() => expect(searchContent).toHaveBeenLastCalledWith('p1', 'a.+b', true));
  });

  it('o erro do processo principal aparece com role="alert"', async () => {
    installApi({
      searchContent: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'A expressão regular é inválida.',
            retryable: false,
          },
        }),
      ),
    });
    const user = userEvent.setup();
    render(<FilesTab projectId="p1" onOpenFile={vi.fn()} />);

    await user.click(screen.getByRole('tab', { name: 'Conteúdo' }));
    await user.click(screen.getByRole('checkbox', { name: 'Regex' }));
    await user.type(field(), '(');

    expect(await screen.findByRole('alert')).toHaveTextContent('A expressão regular é inválida.');
  });

  it('um erro ao listar a raiz também aparece com role="alert"', async () => {
    installApi({
      list: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'O arquivo não existe mais no projeto.',
            retryable: false,
          },
        }),
      ),
    });
    render(<FilesTab projectId="p1" onOpenFile={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O arquivo não existe mais no projeto.',
    );
  });

  it('avisa "Índice parcial: refine a busca" quando a busca parou no limite', async () => {
    installApi({
      searchNames: vi.fn(() =>
        Promise.resolve({ ok: true as const, data: { paths: ['a/x.ts'], truncated: true } }),
      ),
    });
    const user = userEvent.setup();
    render(<FilesTab projectId="p1" onOpenFile={vi.fn()} />);

    await user.type(field(), 'x');

    expect(await screen.findByText('Índice parcial: refine a busca')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /x\.ts/ })).toBeInTheDocument();
  });

  it('apagar o campo volta para a árvore', async () => {
    installApi({ searchNames: vi.fn(() => Promise.resolve(names('src/main.ts'))) });
    const user = userEvent.setup();
    render(<FilesTab projectId="p1" onOpenFile={vi.fn()} />);

    await user.type(field(), 'main');
    await screen.findByRole('button', { name: /main\.ts/ });
    await user.clear(field());

    expect(await screen.findByRole('tree')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /main\.ts/ })).not.toBeInTheDocument();
  });

  it('Atualizar recarrega a raiz e as pastas abertas', async () => {
    const files = installApi();
    const user = userEvent.setup();
    render(<FilesTab projectId="p1" onOpenFile={vi.fn()} />);
    await user.click(await screen.findByRole('treeitem', { name: /^src/ }));
    await screen.findByRole('treeitem', { name: /^main\.ts/ });
    files.list.mockClear();

    await user.click(screen.getByRole('button', { name: 'Atualizar' }));

    await waitFor(() => expect(files.list).toHaveBeenCalledTimes(2));
    expect(files.list.mock.calls.map(([, dir]) => dir).sort()).toEqual(['', 'src']);
  });

  it('não mostra resultado de busca do projeto anterior depois da troca', async () => {
    const old = deferred<NameSearchDto>();
    const searchNames = vi
      .fn<(projectId: string, query: string) => Promise<AppResult<NameSearchDto>>>()
      .mockReturnValueOnce(old.promise);
    installApi({ searchNames });
    const user = userEvent.setup();
    const { rerender } = render(<FilesTab projectId="p1" onOpenFile={vi.fn()} />);
    await user.type(field(), 'velho');
    await waitFor(() => expect(searchNames).toHaveBeenCalledTimes(1));

    rerender(<FilesTab projectId="p2" onOpenFile={vi.fn()} />);
    await act(async () => old.resolve(names('antigo/velho.ts')));

    expect(screen.queryByRole('button', { name: /velho\.ts/ })).not.toBeInTheDocument();
    expect(field()).toHaveValue('');
  });

  it('não exibe caminho absoluto em lugar nenhum', async () => {
    installApi({
      searchNames: vi.fn(() => Promise.resolve(names('src/main.ts'))),
    });
    const user = userEvent.setup();
    const { container } = render(<FilesTab projectId="p1" onOpenFile={vi.fn()} />);
    await screen.findByText('Meu Projeto');
    await user.type(field(), 'main');
    await screen.findByRole('button', { name: /main\.ts/ });

    expect(container.textContent).not.toMatch(/[A-Za-z]:[\\/]|Users|\\/);
  });

  describe('Git na árvore', () => {
    function installGit(status: () => Promise<unknown>) {
      installApi();
      const api = window.projectHub as unknown as Record<string, unknown>;
      api['git'] = { status: vi.fn(status) };
    }

    it('com o status do Git pronto, a árvore mostra a letra do arquivo aninhado e o ponto da pasta', async () => {
      installGit(() =>
        Promise.resolve({
          ok: true,
          data: {
            branch: 'main',
            upstream: null,
            ahead: null,
            behind: null,
            baseRef: 'origin/main',
            linesAdded: null,
            linesRemoved: null,
            files: [{ path: 'src/main.ts', staged: null, unstaged: 'M' }],
          },
        }),
      );
      const user = userEvent.setup();
      render(<FilesTab projectId="p1" onOpenFile={vi.fn()} />);
      const folder = await screen.findByRole('treeitem', { name: /^src/ });
      await waitFor(() => expect(folder).toHaveAccessibleName(/contém alterações/));

      await user.click(folder);

      expect(
        await screen.findByRole('treeitem', { name: /^main.ts modificado/ }),
      ).toHaveTextContent('M');
    });

    it('sem repositório Git, não há letra, ponto nem aviso', async () => {
      installGit(() =>
        Promise.resolve({
          ok: false,
          error: { code: 'VALIDATION_FAILED', message: 'Não é um repositório.', retryable: false },
        }),
      );
      render(<FilesTab projectId="p1" onOpenFile={vi.fn()} />);
      const folder = await screen.findByRole('treeitem', { name: /^src/ });
      await waitFor(() =>
        expect((window.projectHub.git.status as Mock).mock.calls.length).toBeGreaterThan(0),
      );

      expect(folder).not.toHaveAccessibleName(/contém alterações/);
      expect(document.querySelector('.files-tree__git, .files-tree__dot')).toBeNull();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
