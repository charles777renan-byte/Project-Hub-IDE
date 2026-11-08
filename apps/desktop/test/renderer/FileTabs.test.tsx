import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FileContentDto, ProjectHubApi } from '@project-hub/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTabs } from '../../src/renderer/components/project/FileTabs';
import {
  checkFileOnDisk,
  closeFile,
  openFile,
  resetOpenFilesForTests,
  setActive,
  TREE_TAB,
  updateText,
  useOpenFiles,
} from '../../src/renderer/open-files';
import { show, useFakeIntersectionObserver } from './fake-intersection-observer';

/** A faixa de abas dos arquivos abertos, no topo da aba Arquivos do painel direito: a Árvore e uma aba por arquivo. */

function content(text: string): FileContentDto {
  return {
    text,
    eol: 'lf',
    bom: false,
    version: { size: text.length, mtimeMs: 1, hash: 'a'.repeat(64) },
  };
}

let write: ReturnType<typeof vi.fn<ProjectHubApi['files']['write']>>;

beforeEach(() => {
  window.localStorage.clear();
  resetOpenFilesForTests();
  write = vi.fn<ProjectHubApi['files']['write']>(() =>
    Promise.resolve({ ok: true, data: { size: 5, mtimeMs: 2, hash: 'b'.repeat(64) } }),
  );
  window.projectHub = {
    files: {
      read: vi.fn<ProjectHubApi['files']['read']>((_projectId, path) =>
        Promise.resolve({ ok: true, data: content(`texto de ${path}`) }),
      ),
      write,
    },
  } as unknown as typeof window.projectHub;
});

/** A faixa mais o estado ativo, como a aba os usa: quem fecha a faixa é quem lê o store. A Árvore aparece como `arvore`. */
function Harness() {
  const { active } = useOpenFiles('p1');
  return (
    <>
      <FileTabs projectId="p1" />
      <output data-testid="ativa">{active === TREE_TAB ? 'arvore' : active}</output>
    </>
  );
}

function strip(): HTMLElement {
  return screen.getByRole('tablist', { name: 'Arquivos abertos' });
}

function tab(name: string | RegExp, path?: string): HTMLElement {
  if (path !== undefined) {
    const found = within(strip())
      .getAllByRole('tab', { name })
      .find((item) => item.getAttribute('title') === path);
    if (found === undefined) throw new Error(`Sem aba para ${path}.`);
    return found;
  }
  return within(strip()).getByRole('tab', { name });
}

async function openTwo() {
  render(<Harness />);
  act(() => {
    openFile('p1', 'src/a.ts');
    openFile('p1', 'docs/b.md');
  });
  await screen.findByRole('tab', { name: 'b.md' });
}

describe('FileTabs', () => {
  it('não aparece enquanto não há arquivo aberto', () => {
    render(<Harness />);

    expect(screen.queryByRole('tablist', { name: 'Arquivos abertos' })).not.toBeInTheDocument();
  });

  it('com arquivo aberto mostra a aba fixa Árvore e uma aba por arquivo, com o nome e o caminho no title', async () => {
    await openTwo();

    const tabs = within(strip()).getAllByRole('tab');
    expect(tabs.map((item) => item.textContent)).toEqual(['Árvore', 'a.ts', 'b.md']);
    expect(tab('a.ts')).toHaveAttribute('title', 'src/a.ts');
    expect(tab('b.md')).toHaveAttribute('title', 'docs/b.md');
  });

  it('a aba ativa é a do arquivo recém-aberto e a única parada de Tab', async () => {
    await openTwo();

    expect(tab('b.md')).toHaveAttribute('aria-selected', 'true');
    expect(tab('b.md')).toHaveAttribute('tabindex', '0');
    expect(tab('a.ts')).toHaveAttribute('aria-selected', 'false');
    expect(tab('a.ts')).toHaveAttribute('tabindex', '-1');
    expect(tab('Árvore')).toHaveAttribute('aria-selected', 'false');
    expect(tab('Árvore')).toHaveAttribute('tabindex', '-1');
  });

  it('clicar numa aba a ativa, inclusive a de Árvore', async () => {
    const user = userEvent.setup();
    await openTwo();

    await user.click(tab('Árvore'));
    expect(screen.getByTestId('ativa')).toHaveTextContent('arvore');
    await user.click(tab('a.ts'));
    expect(screen.getByTestId('ativa')).toHaveTextContent('src/a.ts');
  });

  it('o botão Fechar <nome> fecha o arquivo e a faixa some com o último', async () => {
    const user = userEvent.setup();
    await openTwo();

    await user.click(screen.getByRole('button', { name: 'Fechar a.ts' }));
    expect(screen.queryByRole('tab', { name: 'a.ts' })).not.toBeInTheDocument();
    expect(screen.getByTestId('ativa')).toHaveTextContent('docs/b.md');

    await user.click(screen.getByRole('button', { name: 'Fechar b.md' }));
    expect(screen.queryByRole('tablist', { name: 'Arquivos abertos' })).not.toBeInTheDocument();
    expect(screen.getByTestId('ativa')).toHaveTextContent('arvore');
  });

  it('o botão Fechar não é uma parada de Tab e tem dica com o nome', async () => {
    const user = userEvent.setup();
    await openTwo();
    const close = screen.getByRole('button', { name: 'Fechar a.ts' });

    expect(close).toHaveAttribute('tabindex', '-1');
    await user.hover(close);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Fechar a.ts');
  });

  it('arquivo com alterações mostra o ponto e o texto escondido "alterações não salvas"', async () => {
    await openTwo();
    expect(screen.queryByText('alterações não salvas')).not.toBeInTheDocument();

    act(() => updateText('p1', 'src/a.ts', 'mudou'));

    const dirty = tab(/a\.ts/);
    expect(within(dirty).getByText('alterações não salvas')).toHaveClass('visually-hidden');
    expect(dirty).toHaveAccessibleName('a.ts alterações não salvas');
    expect(tab('b.md')).toHaveAccessibleName('b.md');
    // O ponto é só um sinal visual: o leitor de tela já ouve o texto escondido.
    expect(dirty.querySelector('.file-tabs__dirty')).toHaveAttribute('aria-hidden', 'true');
  });

  it('as setas andam pelas abas com a volta nas pontas, e Home e End vão às pontas', async () => {
    const user = userEvent.setup();
    await openTwo();
    act(() => setActive('p1', TREE_TAB));
    await user.click(tab('Árvore'));

    await user.keyboard('{ArrowRight}');
    expect(tab('a.ts')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(tab('a.ts')).toHaveFocus());

    await user.keyboard('{End}');
    expect(tab('b.md')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(tab('b.md')).toHaveFocus());

    await user.keyboard('{ArrowRight}');
    expect(tab('Árvore')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(tab('Árvore')).toHaveFocus());

    await user.keyboard('{ArrowLeft}');
    expect(tab('b.md')).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Home}');
    expect(tab('Árvore')).toHaveAttribute('aria-selected', 'true');
  });

  it('Ctrl+W fecha a aba ativa e passa o foco à vizinha', async () => {
    const user = userEvent.setup();
    await openTwo();
    await user.click(tab('a.ts'));

    await user.keyboard('{Control>}w{/Control}');

    expect(screen.queryByRole('tab', { name: 'a.ts' })).not.toBeInTheDocument();
    expect(tab('b.md')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(tab('b.md')).toHaveFocus());
  });

  it('Ctrl+W na aba Árvore não fecha nada', async () => {
    const user = userEvent.setup();
    await openTwo();
    await user.click(tab('Árvore'));

    await user.keyboard('{Control>}w{/Control}');

    expect(within(strip()).getAllByRole('tab')).toHaveLength(3);
  });

  it('o estado fechado fora da faixa (closeFile direto) também a atualiza', async () => {
    await openTwo();

    act(() => closeFile('p1', 'src/a.ts'));
    act(() => closeFile('p1', 'docs/b.md'));

    expect(screen.queryByRole('tablist', { name: 'Arquivos abertos' })).not.toBeInTheDocument();
  });
});

describe('FileTabs: fechar com alterações não salvas', () => {
  const closeButton = (name: string) => screen.getByRole('button', { name: `Fechar ${name}` });

  /** Abre os dois arquivos e suja o primeiro. */
  async function openDirty() {
    await openTwo();
    act(() => updateText('p1', 'src/a.ts', 'texto de src/a.ts!'));
  }

  const ask = () => screen.getByRole('group', { name: 'Fechar a.ts com alterações não salvas' });

  it('fechar uma aba suja mostra Salvar, Descartar e Voltar na própria faixa, sem fechar', async () => {
    const user = userEvent.setup();
    await openDirty();

    await user.click(closeButton('a.ts'));

    expect(ask()).toHaveTextContent('a.ts tem alterações não salvas.');
    expect(within(ask()).getByRole('button', { name: 'Salvar' })).toBeInTheDocument();
    expect(within(ask()).getByRole('button', { name: 'Descartar' })).toBeInTheDocument();
    expect(within(ask()).getByRole('button', { name: 'Voltar' })).toBeInTheDocument();
    expect(tab(/a\.ts/)).toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();
    // O foco vai para dentro da pergunta, para o teclado decidir.
    expect(within(ask()).getByRole('button', { name: 'Salvar' })).toHaveFocus();
  });

  it('a pergunta fica fora do tablist, que só guarda abas', async () => {
    const user = userEvent.setup();
    await openDirty();

    await user.click(closeButton('a.ts'));

    expect(strip()).not.toContainElement(ask());
  });

  it('Voltar não fecha a aba, tira a pergunta e devolve o foco à aba', async () => {
    const user = userEvent.setup();
    await openDirty();
    await user.click(closeButton('a.ts'));

    await user.click(within(ask()).getByRole('button', { name: 'Voltar' }));

    expect(screen.queryByRole('group', { name: /Fechar a\.ts/ })).not.toBeInTheDocument();
    expect(tab(/a\.ts/)).toBeInTheDocument();
    await waitFor(() => expect(tab(/a\.ts/)).toHaveFocus());
  });

  it('Esc também volta', async () => {
    const user = userEvent.setup();
    await openDirty();
    await user.click(closeButton('a.ts'));

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('group', { name: /Fechar a\.ts/ })).not.toBeInTheDocument();
    expect(tab(/a\.ts/)).toBeInTheDocument();
  });

  it('Descartar fecha a aba sem gravar', async () => {
    const user = userEvent.setup();
    await openDirty();
    await user.click(closeButton('a.ts'));

    await user.click(within(ask()).getByRole('button', { name: 'Descartar' }));

    expect(screen.queryByRole('tab', { name: /a\.ts/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Fechar a\.ts/ })).not.toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();
  });

  it('Salvar grava o texto com a versão lida e fecha a aba', async () => {
    const user = userEvent.setup();
    await openDirty();
    await user.click(closeButton('a.ts'));

    await user.click(within(ask()).getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: /a\.ts/ })).not.toBeInTheDocument(),
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({
      projectId: 'p1',
      path: 'src/a.ts',
      text: 'texto de src/a.ts!',
      eol: 'lf',
      bom: false,
      expected: content('texto de src/a.ts').version,
    });
  });

  it('Salvar com texto digitado durante a gravação mantém a aba e a pergunta, sem perder o que foi digitado', async () => {
    const user = userEvent.setup();
    await openDirty();
    let finish: (result: Awaited<ReturnType<ProjectHubApi['files']['write']>>) => void = () => {};
    write.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    await user.click(closeButton('a.ts'));

    await user.click(within(ask()).getByRole('button', { name: 'Salvar' }));
    // A pessoa digita enquanto a gravação ainda não voltou.
    act(() => updateText('p1', 'src/a.ts', 'texto de src/a.ts!!'));
    await act(async () => {
      finish({ ok: true, data: { size: 5, mtimeMs: 2, hash: 'b'.repeat(64) } });
    });

    // O gravado já não é o texto de agora: fechar perderia a digitação.
    expect(tab(/a\.ts/)).toBeInTheDocument();
    await waitFor(() =>
      expect(within(ask()).getByRole('button', { name: 'Salvar' })).toBeEnabled(),
    );

    // Salvar de novo grava o texto novo e, agora limpo, fecha.
    await user.click(within(ask()).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: /a\.ts/ })).not.toBeInTheDocument(),
    );
    expect(write).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'texto de src/a.ts!!' }),
    );
  });

  it('Salvar que falha mantém a aba e a pergunta, com a mensagem do processo principal', async () => {
    const user = userEvent.setup();
    await openDirty();
    write.mockResolvedValue({
      ok: false,
      error: { code: 'UNKNOWN', message: 'Disco cheio.', retryable: false },
    });
    await user.click(closeButton('a.ts'));

    await user.click(within(ask()).getByRole('button', { name: 'Salvar' }));

    expect(await within(ask()).findByRole('alert')).toHaveTextContent('Disco cheio.');
    expect(tab(/a\.ts/)).toBeInTheDocument();
  });

  it('fechar uma aba limpa continua fechando direto', async () => {
    const user = userEvent.setup();
    await openDirty();

    await user.click(closeButton('b.md'));

    expect(screen.queryByRole('tab', { name: 'b.md' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('Ctrl+W numa aba suja faz a mesma pergunta', async () => {
    const user = userEvent.setup();
    await openDirty();
    await user.click(tab(/a\.ts/));

    await user.keyboard('{Control>}w{/Control}');

    expect(ask()).toBeInTheDocument();
    expect(tab(/a\.ts/)).toBeInTheDocument();
  });

  it('a pergunta some se o arquivo foi fechado por outro caminho', async () => {
    const user = userEvent.setup();
    await openDirty();
    await user.click(closeButton('a.ts'));

    act(() => closeFile('p1', 'src/a.ts'));

    expect(screen.queryByRole('group', { name: /Fechar a\.ts/ })).not.toBeInTheDocument();
  });

  it('Salvar não passa por cima de um aviso do disco: mostra o motivo e não grava', async () => {
    const user = userEvent.setup();
    await openDirty();
    window.projectHub.files.stat = vi.fn<ProjectHubApi['files']['stat']>(() =>
      Promise.resolve({ ok: true, data: { exists: false } }),
    );
    await checkFileOnDisk('p1', 'src/a.ts');
    await user.click(closeButton('a.ts'));

    await user.click(within(ask()).getByRole('button', { name: 'Salvar' }));

    expect(await within(ask()).findByRole('alert')).toHaveTextContent('O arquivo não existe mais.');
    expect(write).not.toHaveBeenCalled();
    expect(tab(/a\.ts/)).toBeInTheDocument();
  });
});

describe('abas fora de vista (botão ⌄)', () => {
  useFakeIntersectionObserver();

  /** Quatro abas: a Árvore, dois `index.ts` de pastas diferentes e `x.ts`. A Árvore e `x.ts` estão à vista. */
  async function openWithSameName() {
    render(<Harness />);
    act(() => {
      openFile('p1', 'src/a/index.ts');
      openFile('p1', 'src/b/index.ts');
      openFile('p1', 'x.ts');
    });
    await screen.findByRole('tab', { name: 'x.ts' });
    show(TREE_TAB, 'x.ts');
  }

  it('abas escondidas com o mesmo nome ganham rótulos distintos, sem aviso de chave repetida', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await openWithSameName();

    await user.click(screen.getByRole('button', { name: 'Abas fora de vista' }));

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'src/a/index.ts',
      'src/b/index.ts',
    ]);
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key|unique "key"/);
    errors.mockRestore();
  });

  it('escolher cada uma ativa o arquivo certo e leva o foco para a aba dele', async () => {
    const user = userEvent.setup();
    await openWithSameName();

    await user.click(screen.getByRole('button', { name: 'Abas fora de vista' }));
    await user.click(screen.getByRole('menuitem', { name: 'src/b/index.ts' }));

    expect(screen.getByTestId('ativa')).toHaveTextContent('src/b/index.ts');
    await waitFor(() => expect(document.activeElement).toBe(tab('index.ts', 'src/b/index.ts')));

    await user.click(screen.getByRole('button', { name: 'Abas fora de vista' }));
    await user.click(screen.getByRole('menuitem', { name: 'src/a/index.ts' }));

    expect(screen.getByTestId('ativa')).toHaveTextContent('src/a/index.ts');
    await waitFor(() => expect(document.activeElement).toBe(tab('index.ts', 'src/a/index.ts')));
  });

  it('escolher a última escondida, que faz o botão sumir, deixa o foco na aba escolhida', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    act(() => {
      openFile('p1', 'src/a.ts');
      openFile('p1', 'docs/b.md');
    });
    await screen.findByRole('tab', { name: 'b.md' });
    show(TREE_TAB, 'src/a.ts');

    await user.click(screen.getByRole('button', { name: 'Abas fora de vista' }));
    await user.click(screen.getByRole('menuitem', { name: 'b.md' }));
    // A aba rolou para a vista: o navegador avisa e o botão desmonta.
    show(TREE_TAB, 'src/a.ts', 'docs/b.md');

    expect(screen.queryByRole('button', { name: 'Abas fora de vista' })).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(tab('b.md')));
  });
});
