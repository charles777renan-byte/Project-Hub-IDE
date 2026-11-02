import { act, render, screen, waitFor } from '@testing-library/react';
import { insertNewlineAndIndent, undo } from '@codemirror/commands';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeEditor } from '../../src/renderer/components/editor/CodeEditor';
import { shadowOf, stubLayoutForCodeMirror, viewOf } from './codemirror-jsdom';

/**
 * O editor de arquivos sobre o CodeMirror. Ele monta num Shadow Root (a CSP bloqueia o <style> que o CodeMirror
 * injeta no documento), então o que ele desenha se procura em `host.shadowRoot`, não na tela da Testing Library.
 */

beforeAll(stubLayoutForCodeMirror);

/** Espera o CodeMirror carregar (import dinâmico) e devolve o `container`. */
async function mounted(container: HTMLElement) {
  await waitFor(
    () =>
      expect(
        container.querySelector('.code-editor__host')?.shadowRoot?.querySelector('.cm-content'),
      ).toBeTruthy(),
    { timeout: 25_000 },
  );
  return container;
}

function text(container: HTMLElement): string {
  return viewOf(container).state.doc.toString();
}

describe('CodeEditor', () => {
  it('enquanto o CodeMirror carrega mostra um textarea somente leitura com o texto, e depois o troca pelo editor', async () => {
    const { container } = render(<CodeEditor value={'linha 1\nlinha 2'} language="text" />);

    const loading = screen.getByRole('textbox');
    expect(loading.tagName).toBe('TEXTAREA');
    expect(loading).toHaveAttribute('readonly');
    expect(loading).toHaveValue('linha 1\nlinha 2');

    await mounted(container);

    expect(container.querySelector('textarea')).toBeNull();
    expect(shadowOf(container).querySelector('.cm-content')).toHaveTextContent('linha 1linha 2');
    expect(text(container)).toBe('linha 1\nlinha 2');
  });

  it('monta no Shadow Root: o documento não ganha <style> nem atributo style do CodeMirror', async () => {
    const { container } = render(<CodeEditor value="a" language="typescript" />);
    await mounted(container);

    expect(document.querySelectorAll('style')).toHaveLength(0);
    expect(document.querySelector('.cm-editor')).toBeNull();
    expect(shadowOf(container).querySelector('.cm-editor')).not.toBeNull();
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('mostra os números de linha', async () => {
    const { container } = render(<CodeEditor value={'a\nb\nc'} language="text" />);
    await mounted(container);

    expect(shadowOf(container).querySelector('.cm-lineNumbers')).toHaveTextContent('123');
  });

  it('dá nome ao campo de edição para leitor de tela', async () => {
    const { container } = render(
      <CodeEditor value="a" language="text" ariaLabel="Editor de a.txt" />,
    );
    await mounted(container);

    expect(shadowOf(container).querySelector('.cm-content')).toHaveAttribute(
      'aria-label',
      'Editor de a.txt',
    );
  });

  it('realça a sintaxe da linguagem do arquivo: o código ganha trechos com classe de realce', async () => {
    const { container } = render(<CodeEditor value="const x = 1;" language="typescript" />);
    await mounted(container);

    const spans = shadowOf(container).querySelectorAll('.cm-line span');
    expect(spans.length).toBeGreaterThan(0);
  });

  it('onChange dispara com o texto novo quando a pessoa edita', async () => {
    const onChange = vi.fn();
    const { container } = render(<CodeEditor value="abc" language="text" onChange={onChange} />);
    await mounted(container);

    act(() => {
      viewOf(container).dispatch({ changes: { from: 3, insert: 'd' }, userEvent: 'input.type' });
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('abcd');
  });

  it('onCursor avisa ao montar e a cada digitação e seleção, contando a coluna em caracteres', async () => {
    const onCursor = vi.fn();
    const { container } = render(
      <CodeEditor value={'abc\né😀x'} language="text" onCursor={onCursor} />,
    );
    await mounted(container);
    expect(onCursor).toHaveBeenLastCalledWith({ line: 1, column: 1, selected: 0 });

    act(() => {
      viewOf(container).dispatch({ changes: { from: 0, insert: 'Z' }, selection: { anchor: 1 } });
    });
    expect(onCursor).toHaveBeenLastCalledWith({ line: 1, column: 2, selected: 0 });

    // A linha 2 é "é😀x": com o cursor no fim há 3 caracteres antes dele (o emoji vale 1), logo a coluna é 4.
    act(() => {
      viewOf(container).dispatch({ selection: { anchor: viewOf(container).state.doc.length } });
    });
    expect(onCursor).toHaveBeenLastCalledWith({ line: 2, column: 4, selected: 0 });

    // Selecionar "é😀" são 2 caracteres, embora ocupem 3 unidades UTF-16.
    act(() => {
      const view = viewOf(container);
      const lineStart = view.state.doc.line(2).from;
      view.dispatch({ selection: { anchor: lineStart, head: lineStart + 3 } });
    });
    expect(onCursor).toHaveBeenLastCalledWith({ line: 2, column: 3, selected: 2 });
  });

  it('trocar o value por cima substitui o documento sem disparar onChange', async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <CodeEditor value="antes" language="text" onChange={onChange} />,
    );
    await mounted(container);

    rerender(<CodeEditor value="depois" language="text" onChange={onChange} />);

    await waitFor(() => expect(text(container)).toBe('depois'));
    await act(async () => {});
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a troca de value não entra no histórico: desfazer não volta ao texto antigo', async () => {
    const { container, rerender } = render(<CodeEditor value="antes" language="text" />);
    await mounted(container);

    rerender(<CodeEditor value="depois" language="text" />);
    await waitFor(() => expect(text(container)).toBe('depois'));
    undo(viewOf(container));

    expect(text(container)).toBe('depois');
  });

  it('o value igual ao texto do editor não mexe no documento', async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <CodeEditor value="x" language="text" onChange={onChange} />,
    );
    await mounted(container);
    act(() => {
      viewOf(container).dispatch({ changes: { from: 1, insert: 'y' }, userEvent: 'input.type' });
    });
    onChange.mockClear();

    // O dono do estado devolve o texto que acabou de receber: nada a substituir.
    rerender(<CodeEditor value="xy" language="text" onChange={onChange} />);
    await act(async () => {});

    expect(text(container)).toBe('xy');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('somente leitura recusa a edição; sem a trava o mesmo comando edita', async () => {
    const { container, rerender } = render(<CodeEditor value="a" language="text" readOnly />);
    await mounted(container);

    act(() => {
      const view = viewOf(container);
      view.dispatch({ selection: { anchor: 1 } });
      insertNewlineAndIndent(view);
    });
    expect(text(container)).toBe('a');
    expect(viewOf(container).state.readOnly).toBe(true);

    rerender(<CodeEditor value="a" language="text" readOnly={false} />);
    await waitFor(() => expect(viewOf(container).state.readOnly).toBe(false));
    act(() => {
      insertNewlineAndIndent(viewOf(container));
    });
    expect(text(container)).toBe('a\n');
  });

  describe('autoFocus', () => {
    // O jsdom não dá foco a um contenteditable: o que se confere é que o editor o pede, a quem e quando. O navegador
    // ignora focus() em elemento escondido, então o host tem de estar visível no instante do pedido.
    const focused: { target: Element; hostHidden: boolean }[] = [];

    beforeEach(() => {
      focused.length = 0;
      vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
        const host = (this.getRootNode() as ShadowRoot).host;
        focused.push({ target: this, hostHidden: host?.hasAttribute('hidden') ?? false });
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('pede o foco do campo de edição com o host já visível', async () => {
      const { container } = render(<CodeEditor value="a" language="text" autoFocus />);
      await mounted(container);

      await waitFor(() => expect(focused).toHaveLength(1));
      expect(focused[0]?.target).toBe(shadowOf(container).querySelector('.cm-content'));
      expect(focused[0]?.hostHidden).toBe(false);
    });

    it('sem autoFocus o editor não rouba o foco', async () => {
      const { container } = render(<CodeEditor value="b" language="text" />);
      await mounted(container);
      await act(async () => {});

      expect(focused).toHaveLength(0);
    });
  });

  it('Ctrl+F abre a busca do editor', async () => {
    const { container } = render(<CodeEditor value="a" language="text" />);
    await mounted(container);
    const content = shadowOf(container).querySelector('.cm-content') as HTMLElement;

    act(() => {
      content.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true }),
      );
    });

    await waitFor(() => expect(shadowOf(container).querySelector('.cm-search')).not.toBeNull());
  });

  it('desmontar antes do CodeMirror carregar não monta editor nenhum', async () => {
    const { container, unmount } = render(<CodeEditor value="a" language="text" />);
    const host = container.querySelector('.code-editor__host');
    unmount();
    await act(async () => {});

    expect(host?.shadowRoot?.querySelector('.cm-editor') ?? null).toBeNull();
  });
});
