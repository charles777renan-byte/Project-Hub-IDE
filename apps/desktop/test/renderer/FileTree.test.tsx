import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppResult, FileEntryDto, ProjectHubApi } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileTree } from '../../src/renderer/components/right-panel/FileTree';
import { useProjectFiles } from '../../src/renderer/components/right-panel/use-project-files';

/** A árvore de arquivos: papéis ARIA, uma parada de Tab e o teclado de uma árvore. */

function entry(path: string, kind: FileEntryDto['kind'] = 'file', ignored = false): FileEntryDto {
  return { name: path.split('/').pop() ?? path, path, kind, ignored };
}

const TREE: Record<string, FileEntryDto[]> = {
  '': [
    entry('docs', 'directory'),
    entry('node_modules', 'directory', true),
    entry('src', 'directory'),
    entry('README.md'),
  ],
  docs: [],
  node_modules: [entry('node_modules/leftpad.js')],
  src: [entry('src/ui', 'directory'), entry('src/main.ts'), entry('src/util.ts')],
  'src/ui': [entry('src/ui/Botao.tsx')],
};

function installApi() {
  const list = vi.fn((_projectId: string, dir: string): Promise<AppResult<FileEntryDto[]>> => {
    return Promise.resolve({ ok: true, data: TREE[dir] ?? [] });
  });
  window.projectHub = { files: { list } } as unknown as ProjectHubApi;
  return list;
}

function Harness({ onOpenFile }: { onOpenFile: (path: string) => void }) {
  const files = useProjectFiles('p1');
  return <FileTree files={files} onOpenFile={onOpenFile} />;
}

async function renderTree() {
  const list = installApi();
  const onOpenFile = vi.fn();
  const user = userEvent.setup();
  render(<Harness onOpenFile={onOpenFile} />);
  await screen.findByRole('treeitem', { name: /^src/ });
  return { list, onOpenFile, user };
}

function item(name: string): HTMLElement {
  return screen.getByRole('treeitem', { name: new RegExp(`^${name}(?:\\b|$)`) });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('FileTree', () => {
  it('lê a raiz ao montar e a pasta só ao expandi-la', async () => {
    const { list, user } = await renderTree();
    expect(list).toHaveBeenCalledWith('p1', '');
    expect(list).not.toHaveBeenCalledWith('p1', 'src');

    await user.click(item('src'));

    await screen.findByRole('treeitem', { name: /^main\.ts/ });
    expect(list).toHaveBeenCalledWith('p1', 'src');
  });

  it('usa tree, treeitem e group, com aria-expanded só nas pastas e aria-level por nível', async () => {
    const { user } = await renderTree();
    expect(screen.getByRole('tree', { name: 'Arquivos do projeto' })).toBeInTheDocument();
    expect(item('src')).toHaveAttribute('aria-expanded', 'false');
    expect(item('src')).toHaveAttribute('aria-level', '1');
    expect(item('README.md')).not.toHaveAttribute('aria-expanded');

    await user.click(item('src'));
    await screen.findByRole('treeitem', { name: /^main\.ts/ });

    expect(item('src')).toHaveAttribute('aria-expanded', 'true');
    expect(item('main.ts')).toHaveAttribute('aria-level', '2');
    expect(screen.getByRole('group')).toContainElement(item('main.ts'));
  });

  it('recolher e reexpandir mostra cada entrada uma vez só', async () => {
    const { user } = await renderTree();

    await user.click(item('src'));
    await screen.findByRole('treeitem', { name: /^main\.ts/ });
    await user.click(item('src'));
    expect(screen.queryByRole('treeitem', { name: /^main\.ts/ })).not.toBeInTheDocument();
    await user.click(item('src'));

    expect(screen.getAllByRole('treeitem', { name: /^main\.ts/ })).toHaveLength(1);
  });

  it('tem uma parada de Tab só: o primeiro item, e o Tab seguinte sai da árvore', async () => {
    const { user } = await renderTree();
    const tabbable = screen.getAllByRole('treeitem').filter((node) => node.tabIndex === 0);
    expect(tabbable).toHaveLength(1);

    await user.tab();
    expect(item('docs')).toHaveFocus();
    await user.tab();
    expect(document.body).toHaveFocus();
  });

  it('as setas para cima e para baixo percorrem os itens visíveis', async () => {
    const { user } = await renderTree();
    await user.tab();

    await user.keyboard('{ArrowDown}');
    expect(item('node_modules')).toHaveFocus();
    expect(item('node_modules').tabIndex).toBe(0);
    expect(item('docs').tabIndex).toBe(-1);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(item('README.md')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('README.md')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(item('src')).toHaveFocus();
  });

  it('seta para a direita expande a pasta e, já aberta, entra no primeiro filho', async () => {
    const { user } = await renderTree();
    await user.tab();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(item('src')).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    await screen.findByRole('treeitem', { name: /^main\.ts/ });
    expect(item('src')).toHaveAttribute('aria-expanded', 'true');
    expect(item('src')).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(item('ui')).toHaveFocus();
  });

  it('seta para a esquerda recolhe a pasta aberta e, em arquivo ou pasta fechada, sobe para o pai', async () => {
    const { user } = await renderTree();
    await user.tab();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowRight}');
    await screen.findByRole('treeitem', { name: /^main\.ts/ });
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(item('main.ts')).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(item('src')).toHaveFocus();
    expect(item('src')).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{ArrowLeft}');
    expect(item('src')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('treeitem', { name: /^main\.ts/ })).not.toBeInTheDocument();
  });

  it('Home vai ao primeiro item, End ao último visível', async () => {
    const { user } = await renderTree();
    await user.tab();

    await user.keyboard('{End}');
    expect(item('README.md')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(item('docs')).toHaveFocus();
  });

  it('Enter abre o arquivo com o caminho relativo, e em pasta expande e recolhe', async () => {
    const { user, onOpenFile } = await renderTree();
    await user.tab();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await screen.findByRole('treeitem', { name: /^main\.ts/ });
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(item('src')).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith('src/main.ts');
  });

  it('clicar num arquivo o abre', async () => {
    const { user, onOpenFile } = await renderTree();

    await user.click(item('README.md'));

    expect(onOpenFile).toHaveBeenCalledWith('README.md');
  });

  it('marca o item atual com aria-selected', async () => {
    const { user } = await renderTree();
    await user.tab();
    await user.keyboard('{ArrowDown}');

    expect(item('node_modules')).toHaveAttribute('aria-selected', 'true');
    expect(item('docs')).toHaveAttribute('aria-selected', 'false');
  });

  it('pasta ignorada fica esmaecida, e o estado não vai só na cor', async () => {
    await renderTree();

    expect(item('node_modules')).toHaveClass('files-tree__item--ignored');
    expect(item('node_modules')).toHaveAttribute('aria-description', 'Ignorada pelo Git');
    expect(item('src')).not.toHaveClass('files-tree__item--ignored');
  });

  it('pasta aberta sem entradas diz que está vazia', async () => {
    const { user } = await renderTree();

    await user.click(item('docs'));

    await waitFor(() => expect(screen.getByText('Pasta vazia')).toBeInTheDocument());
  });

  it('não mostra caminho absoluto: só o nome de cada entrada', async () => {
    const { user } = await renderTree();
    await user.click(item('src'));
    await screen.findByRole('treeitem', { name: /^main\.ts/ });

    const text = screen.getByRole('tree').textContent ?? '';
    expect(text).not.toMatch(/[A-Za-z]:[\\/]|\\|\/\w/);
    expect(item('main.ts')).toHaveTextContent('main.ts');
  });
});
