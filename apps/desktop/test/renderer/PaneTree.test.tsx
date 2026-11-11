import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useEffect, useState, type ComponentProps } from 'react';
import type { LayoutLeaf, LayoutNode } from '@project-hub/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaneTree } from '../../src/renderer/workspace/PaneTree';

// Um espião sobre o `Panel`: o jsdom não desenha o `minSize`, então o teste lê o que cada painel recebeu.
const painelRecebeu = vi.hoisted(() => vi.fn());
vi.mock('react-resizable-panels', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-resizable-panels')>();
  return {
    ...original,
    Panel: (props: ComponentProps<typeof original.Panel>) => {
      painelRecebeu(props);
      return createElement(original.Panel, props);
    },
  };
});

const leaf = (id: string, provider: LayoutLeaf['provider']): LayoutLeaf => ({
  type: 'leaf',
  id,
  provider,
  terminalId: null,
});

function padrao(raiz = 0.52, meio = 0.5): LayoutNode {
  return {
    type: 'split',
    id: 'raiz',
    direction: 'row',
    children: [
      leaf('a', 'claude'),
      {
        type: 'split',
        id: 'meio',
        direction: 'column',
        children: [leaf('b', 'codex'), leaf('c', 'shell')],
        sizes: [meio, 1 - meio],
      },
    ],
    sizes: [raiz, 1 - raiz],
  };
}

const renderId = (l: LayoutLeaf) => <i>{l.id}</i>;

// O jsdom não mede nada: sem tamanho, a biblioteca não calcula o layout nem aceita teclado. Aqui cada
// elemento mede 1000x800 e o ResizeObserver falso avisa de cada observado ao começar a observá-lo.
beforeEach(() => {
  painelRecebeu.mockClear();
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        const box = [{ inlineSize: 1000, blockSize: 800 }];
        this.callback(
          [{ target, borderBoxSize: box, contentBoxSize: box } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
});

describe('PaneTree', () => {
  it('chama renderLeaf uma vez por folha, na ordem a, b, c', () => {
    const renderLeaf = vi.fn((l: LayoutLeaf) => <span>{l.id}</span>);
    render(<PaneTree layout={padrao()} onSizes={vi.fn()} renderLeaf={renderLeaf} />);
    expect(renderLeaf.mock.calls.map(([l]) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('mostra uma divisória por divisão', () => {
    render(<PaneTree layout={padrao()} onSizes={vi.fn()} renderLeaf={renderId} />);
    expect(screen.getAllByRole('separator')).toHaveLength(2);
  });

  it('não chama onSizes na montagem', () => {
    const onSizes = vi.fn();
    render(<PaneTree layout={padrao()} onSizes={onSizes} renderLeaf={renderId} />);
    expect(onSizes).not.toHaveBeenCalled();
  });

  it('chama onSizes com o id da divisão e os tamanhos novos ao mover a divisória pelo teclado', () => {
    const onSizes = vi.fn();
    render(<PaneTree layout={padrao()} onSizes={onSizes} renderLeaf={renderId} />);
    const [raiz] = screen.getAllByRole('separator');
    act(() => raiz!.focus());
    fireEvent.keyDown(raiz!, { key: 'ArrowRight' });
    expect(onSizes).toHaveBeenCalledTimes(1);
    const [id, sizes] = onSizes.mock.calls[0] as [string, number[]];
    expect(id).toBe('raiz');
    expect(sizes).toHaveLength(2);
    expect(sizes[0]).toBeGreaterThan(0.52);
    expect(sizes[0]! + sizes[1]!).toBeCloseTo(1);
  });

  it('mantém cada lado entre 5% e 95%', () => {
    const onSizes = vi.fn();
    render(<PaneTree layout={padrao()} onSizes={onSizes} renderLeaf={renderId} />);
    const [raiz] = screen.getAllByRole('separator');
    act(() => raiz!.focus());
    fireEvent.keyDown(raiz!, { key: 'End' });
    fireEvent.keyDown(raiz!, { key: 'Home' });
    expect(onSizes.mock.calls.length).toBeGreaterThan(0);
    for (const [, sizes] of onSizes.mock.calls as [string, number[]][]) {
      for (const size of sizes) {
        expect(size).toBeGreaterThanOrEqual(0.05 - 1e-6);
        expect(size).toBeLessThanOrEqual(0.95 + 1e-6);
      }
    }
  });

  it('não chama onSizes de novo quando o pai volta com os tamanhos já aplicados', () => {
    const onSizes = vi.fn();
    const { rerender } = render(
      <PaneTree layout={padrao()} onSizes={onSizes} renderLeaf={renderId} />,
    );
    const [raiz] = screen.getAllByRole('separator');
    act(() => raiz!.focus());
    fireEvent.keyDown(raiz!, { key: 'ArrowRight' });
    expect(onSizes).toHaveBeenCalledTimes(1);
    const novo = (onSizes.mock.calls[0]![1] as number[])[0]!;
    rerender(<PaneTree layout={padrao(novo)} onSizes={onSizes} renderLeaf={renderId} />);
    expect(onSizes).toHaveBeenCalledTimes(1);
  });

  it('segue tamanhos diferentes que chegam de fora, sem chamar onSizes', () => {
    const onSizes = vi.fn();
    const { rerender } = render(
      <PaneTree layout={padrao(0.52)} onSizes={onSizes} renderLeaf={renderId} />,
    );
    const antes = Number(screen.getAllByRole('separator')[0]!.getAttribute('aria-valuenow'));
    rerender(<PaneTree layout={padrao(0.3)} onSizes={onSizes} renderLeaf={renderId} />);
    const depois = Number(screen.getAllByRole('separator')[0]!.getAttribute('aria-valuenow'));
    expect(depois).not.toBe(antes);
    expect(depois).toBeCloseTo(30, 0);
    expect(onSizes).not.toHaveBeenCalled();
  });

  it('não remonta o conteúdo da folha quando só os tamanhos mudam', () => {
    const montagens = vi.fn();
    function Folha() {
      useEffect(() => {
        montagens();
      }, []);
      return <i>folha</i>;
    }
    const renderLeaf = () => <Folha />;
    const { rerender } = render(
      <PaneTree layout={padrao(0.52)} onSizes={vi.fn()} renderLeaf={renderLeaf} />,
    );
    expect(montagens).toHaveBeenCalledTimes(3);
    rerender(<PaneTree layout={padrao(0.3, 0.7)} onSizes={vi.fn()} renderLeaf={renderLeaf} />);
    expect(montagens).toHaveBeenCalledTimes(3);
  });

  it('abrir e fechar um painel ao lado não remonta o conteúdo da folha que já estava lá', () => {
    const montagens = vi.fn();
    function Folha({ id }: { id: string }) {
      useEffect(() => {
        montagens(id);
      }, [id]);
      return <i>{id}</i>;
    }
    const renderLeaf = (l: LayoutLeaf) => <Folha id={l.id} />;
    const sozinha = leaf('a', 'claude');
    const comNova: LayoutNode = {
      type: 'split',
      id: 'raiz-nova',
      direction: 'row',
      children: [leaf('a', 'claude'), leaf('n', 'shell')],
      sizes: [0.5, 0.5],
    };
    const { rerender } = render(
      <PaneTree layout={sozinha} onSizes={vi.fn()} renderLeaf={renderLeaf} />,
    );
    rerender(<PaneTree layout={comNova} onSizes={vi.fn()} renderLeaf={renderLeaf} />);
    rerender(<PaneTree layout={sozinha} onSizes={vi.fn()} renderLeaf={renderLeaf} />);
    expect(montagens.mock.calls.map(([id]) => id)).toEqual(['a', 'n']);
    // O conteúdo de "a" ficou no lugar da folha, e o de "n" saiu.
    expect(screen.getByText('a').closest('.pane-tree__leaf')).not.toBeNull();
    expect(screen.queryByText('n')).not.toBeInTheDocument();
  });

  it('o foco dentro da folha continua nela quando a estrutura muda', () => {
    const renderLeaf = (l: LayoutLeaf) => <button type="button">{`botão ${l.id}`}</button>;
    const sozinha = leaf('a', 'claude');
    const { rerender } = render(
      <PaneTree layout={sozinha} onSizes={vi.fn()} renderLeaf={renderLeaf} />,
    );
    act(() => screen.getByRole('button', { name: 'botão a' }).focus());
    rerender(
      <PaneTree
        layout={{
          type: 'split',
          id: 'raiz-nova',
          direction: 'column',
          children: [leaf('a', 'claude'), leaf('n', 'shell')],
          sizes: [0.5, 0.5],
        }}
        onSizes={vi.fn()}
        renderLeaf={renderLeaf}
      />,
    );
    expect(screen.getByRole('button', { name: 'botão a' })).toHaveFocus();
  });

  it('identifica cada nó filho pelo id: trocar a ordem das folhas não carrega o estado de uma para a outra', () => {
    function Folha({ id }: { id: string }) {
      const [inicial] = useState(id);
      return <i data-testid="folha">{inicial}</i>;
    }
    const renderLeaf = (l: LayoutLeaf) => <Folha id={l.id} />;
    const dupla = (primeira: string, segunda: string): LayoutNode => ({
      type: 'split',
      id: 'raiz',
      direction: 'row',
      children: [leaf(primeira, 'claude'), leaf(segunda, 'shell')],
      sizes: [0.5, 0.5],
    });
    const { rerender } = render(
      <PaneTree layout={dupla('a', 'b')} onSizes={vi.fn()} renderLeaf={renderLeaf} />,
    );
    rerender(<PaneTree layout={dupla('b', 'a')} onSizes={vi.fn()} renderLeaf={renderLeaf} />);
    expect(screen.getAllByTestId('folha').map((item) => item.textContent)).toEqual(['b', 'a']);
  });

  describe('mínimo por painel', () => {
    /** O `minSize` de cada painel, por id (o último valor que o painel recebeu). */
    function minimos(): Record<string, unknown> {
      const porId: Record<string, unknown> = {};
      for (const [props] of painelRecebeu.mock.calls as [{ id: string; minSize: unknown }][])
        porId[props.id] = props.minSize;
      return porId;
    }

    it('sem minWidth e minHeight, cada painel segue com 5%', () => {
      render(<PaneTree layout={padrao()} onSizes={vi.fn()} renderLeaf={renderId} />);
      expect(minimos()).toEqual({ a: '5', meio: '5', b: '5', c: '5' });
    });

    it('divisão em linha: cada lado pede em px a largura mínima do que tem dentro', () => {
      const duasColunasEUma: LayoutNode = {
        type: 'split',
        id: 'raiz',
        direction: 'row',
        children: [
          {
            type: 'split',
            id: 'esq',
            direction: 'row',
            children: [leaf('a', 'claude'), leaf('b', 'codex')],
            sizes: [0.5, 0.5],
          },
          leaf('c', 'shell'),
        ],
        sizes: [0.5, 0.5],
      };
      render(
        <PaneTree
          layout={duasColunasEUma}
          onSizes={vi.fn()}
          minWidth={340}
          minHeight={260}
          renderLeaf={renderId}
        />,
      );
      expect(minimos()).toMatchObject({ esq: '688px', c: '340px', a: '340px', b: '340px' });
    });

    it('divisão em coluna: cada lado pede em px a altura mínima do que tem dentro', () => {
      render(
        <PaneTree
          layout={padrao()}
          onSizes={vi.fn()}
          minWidth={340}
          minHeight={260}
          renderLeaf={renderId}
        />,
      );
      // `padrao`: a | (b sobre c). Na linha raiz, a pede 340 px e o lado direito, que só empilha, também 340.
      // Na coluna do meio, cada folha pede 260 px de altura.
      expect(minimos()).toMatchObject({ a: '340px', meio: '340px', b: '260px', c: '260px' });
    });
  });

  it('sem onSizes, mover a divisória não quebra nada e não chama ninguém', () => {
    render(<PaneTree layout={padrao()} renderLeaf={renderId} />);
    const [raiz] = screen.getAllByRole('separator');
    act(() => raiz!.focus());
    expect(() => fireEvent.keyDown(raiz!, { key: 'ArrowRight' })).not.toThrow();
  });

  it('uma divisão de três filhos desenha três painéis e duas divisórias, com os tamanhos dados', () => {
    const tres: LayoutNode = {
      type: 'split',
      id: 'raiz',
      direction: 'row',
      children: [leaf('a', 'claude'), leaf('b', 'codex'), leaf('c', 'shell')],
      sizes: [0.2, 0.3, 0.5],
    };
    render(<PaneTree layout={tres} renderLeaf={renderId} />);
    const divisorias = screen.getAllByRole('separator');
    expect(divisorias).toHaveLength(2);
    expect(Number(divisorias[0]!.getAttribute('aria-valuenow'))).toBeCloseTo(20, 0);
  });

  it('duplo clique na divisória pede para igualar os dois lados dela', () => {
    const onEqualize = vi.fn();
    const tres: LayoutNode = {
      type: 'split',
      id: 'raiz',
      direction: 'row',
      children: [leaf('a', 'claude'), leaf('b', 'codex'), leaf('c', 'shell')],
      sizes: [0.2, 0.3, 0.5],
    };
    render(<PaneTree layout={tres} onEqualize={onEqualize} renderLeaf={renderId} />);
    fireEvent.doubleClick(screen.getAllByRole('separator')[1]!);
    expect(onEqualize).toHaveBeenCalledWith('raiz', 1);
  });

  it('cada lugar de folha leva o id dela, e mudar a estrutura não remonta o conteúdo', () => {
    const montagens = vi.fn();
    function Folha({ id }: { id: string }) {
      useEffect(() => {
        montagens(id);
      }, [id]);
      return <i>{id}</i>;
    }
    const renderLeaf = (l: LayoutLeaf) => <Folha id={l.id} />;
    const { container, rerender } = render(<PaneTree layout={padrao()} renderLeaf={renderLeaf} />);
    expect(
      [...container.querySelectorAll('[data-leaf-id]')].map((slot) =>
        slot.getAttribute('data-leaf-id'),
      ),
    ).toEqual(['a', 'b', 'c']);
    const noDeA = container.querySelector('[data-leaf-id="a"]')!.firstElementChild;
    // `c` sai da coluna e vai para a esquerda de `a`: os grupos mudam, o conteúdo de cada folha fica.
    rerender(
      <PaneTree
        layout={{
          type: 'split',
          id: 'raiz',
          direction: 'row',
          children: [leaf('c', 'shell'), leaf('a', 'claude'), leaf('b', 'codex')],
          sizes: [0.26, 0.26, 0.48],
        }}
        renderLeaf={renderLeaf}
      />,
    );
    expect(montagens).toHaveBeenCalledTimes(3);
    expect(container.querySelector('[data-leaf-id="a"]')!.firstElementChild).toBe(noDeA);
  });
});
