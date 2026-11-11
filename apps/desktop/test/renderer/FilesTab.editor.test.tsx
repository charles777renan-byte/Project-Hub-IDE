import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  FileContentDto,
  FileEntryDto,
  FileVersionDto,
  GitStatusDto,
  ProjectHubApi,
} from '@project-hub/contracts';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesTab } from '../../src/renderer/components/right-panel/FilesTab';
import {
  openFile,
  resetOpenFilesForTests,
  setActive,
  TREE_TAB,
} from '../../src/renderer/open-files';
import { CODEMIRROR_LOAD_MS, prepareCodeMirror } from './codemirror-jsdom';

/**
 * A aba Arquivos com um arquivo aberto: a faixa (a Árvore e os arquivos) fica no topo da aba, e o editor do arquivo
 * ativo toma o lugar da árvore. A árvore não some: volta quando a pessoa escolhe a aba Árvore.
 */

beforeAll(prepareCodeMirror, CODEMIRROR_LOAD_MS);

const VERSION: FileVersionDto = { size: 5, mtimeMs: 10, hash: 'a'.repeat(64) };

function content(text: string): FileContentDto {
  return { text, eol: 'lf', bom: false, version: VERSION };
}

function entry(path: string, kind: FileEntryDto['kind'] = 'file'): FileEntryDto {
  return { name: path.split('/').pop() ?? path, path, kind, ignored: false };
}

function status(): GitStatusDto {
  return {
    branch: 'main',
    upstream: null,
    ahead: null,
    behind: null,
    baseRef: 'origin/main',
    linesAdded: null,
    linesRemoved: null,
    files: [],
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetOpenFilesForTests();
  const roots = [entry('a.ts'), entry('b.md')];
  window.projectHub = {
    files: {
      list: vi.fn(() => Promise.resolve({ ok: true as const, data: roots })),
      searchNames: vi.fn(() =>
        Promise.resolve({ ok: true as const, data: { paths: [], truncated: false } }),
      ),
      searchContent: vi.fn(() =>
        Promise.resolve({ ok: true as const, data: { matches: [], truncated: false } }),
      ),
      read: vi.fn((_projectId: string, path: string) =>
        Promise.resolve({ ok: true as const, data: content(`texto de ${path}`) }),
      ),
      write: vi.fn(() =>
        Promise.resolve({ ok: true as const, data: { size: 5, mtimeMs: 2, hash: 'b'.repeat(64) } }),
      ),
      stat: vi.fn(() => Promise.resolve({ ok: true as const, data: { exists: true } })),
    },
    git: {
      status: vi.fn(() => Promise.resolve({ ok: true as const, data: status() })),
      diff: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          error: { code: 'UNKNOWN', message: 'x', retryable: false },
        }),
      ),
      branchChanges: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          data: { baseRef: 'origin/main', mergeBase: 'abc', files: [] },
        }),
      ),
      log: vi.fn(() => Promise.resolve({ ok: true as const, data: [] })),
    },
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
});

function renderTab() {
  return render(<FilesTab projectId="p1" onOpenFile={() => undefined} />);
}

function strip(): HTMLElement {
  return screen.getByRole('tablist', { name: 'Arquivos abertos' });
}

describe('FilesTab com arquivos abertos', () => {
  it('sem arquivo aberto, a aba é a árvore e não há faixa', async () => {
    renderTab();

    expect(await screen.findByRole('tree', { name: 'Arquivos do projeto' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Arquivos abertos' })).not.toBeInTheDocument();
  });

  it('com um arquivo aberto, a faixa tem a Árvore e o arquivo, e o editor toma o lugar da árvore', async () => {
    renderTab();
    await screen.findByRole('tree', { name: 'Arquivos do projeto' });

    act(() => openFile('p1', 'a.ts'));

    expect(
      within(await screen.findByRole('tablist', { name: 'Arquivos abertos' }))
        .getAllByRole('tab')
        .map((item) => item.textContent),
    ).toEqual(['Árvore', 'a.ts']);
    expect(within(strip()).getByRole('tab', { name: 'a.ts' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByRole('button', { name: 'Salvar' })).toBeInTheDocument();
    expect(screen.queryByRole('tree', { name: 'Arquivos do projeto' })).not.toBeInTheDocument();
  });

  it('a aba Árvore volta à árvore e o arquivo segue aberto na faixa', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('tree', { name: 'Arquivos do projeto' });
    act(() => openFile('p1', 'a.ts'));
    await screen.findByRole('button', { name: 'Salvar' });

    await user.click(within(strip()).getByRole('tab', { name: 'Árvore' }));

    expect(await screen.findByRole('tree', { name: 'Arquivos do projeto' })).toBeInTheDocument();
    expect(within(strip()).getByRole('tab', { name: 'a.ts' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument();
  });

  it('a árvore segue montada enquanto o editor está ativo, e volta com a mesma pasta aberta', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('tree', { name: 'Arquivos do projeto' });
    act(() => openFile('p1', 'a.ts'));
    await screen.findByRole('button', { name: 'Salvar' });

    setActive('p1', TREE_TAB);
    await user.click(await screen.findByRole('tab', { name: 'Árvore' }));

    expect(screen.getByRole('tree', { name: 'Arquivos do projeto' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /b\.md/ })).toBeInTheDocument();
  });
});
