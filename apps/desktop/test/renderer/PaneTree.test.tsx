import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import type { LayoutLeaf, LayoutNode } from '@project-hub/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaneTree } from '../../src/renderer/workspace/PaneTree';

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
    ratio: raiz,
    first: leaf('a', 'claude'),
    second: {
      type: 'split',
      id: 'meio',
      direction: 'column',
      ratio: meio,
      first: leaf('b', 'codex'),
      second: leaf('c', 'shell'),
    },
  };
}

const renderId = (l: LayoutLeaf) => <i>{l.id}</i>;

// O jsdom não mede nada: sem tamanho, a biblioteca não calcula o layout nem aceita teclado. Aqui cada
// elemento mede 1000x800 e o ResizeObserver falso avisa de cada observado ao começar a observá-lo.
beforeEach(() => {
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
    render(<PaneTree layout={padrao()} onRatio={vi.fn()} renderLeaf={renderLeaf} />);
    expect(renderLeaf.mock.calls.map(([l]) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('mostra uma divisória por divisão', () => {
    render(<PaneTree layout={padrao()} onRatio={vi.fn()} renderLeaf={renderId} />);
    expect(screen.getAllByRole('separator')).toHaveLength(2);
  });

  it('não chama onRatio na montagem', () => {
    const onRatio = vi.fn();
    render(<PaneTree layout={padrao()} onRatio={onRatio} renderLeaf={renderId} />);
    expect(onRatio).not.toHaveBeenCalled();
  });

  it('chama onRatio com o id da divisão e o ratio novo ao mover a divisória pelo teclado', () => {
    const onRatio = vi.fn();
    render(<PaneTree layout={padrao()} onRatio={onRatio} renderLeaf={renderId} />);
    const [raiz] = screen.getAllByRole('separator');
    act(() => raiz!.focus());
    fireEvent.keyDown(raiz!, { key: 'ArrowRight' });
    expect(onRatio).toHaveBeenCalledTimes(1);
    const [id, ratio] = onRatio.mock.calls[0]!;
    expect(id).toBe('raiz');
    expect(ratio).toBeGreaterThan(0.52);
    expect(ratio).toBeLessThanOrEqual(0.85);
  });

  it('mantém o ratio entre 0,15 e 0,85', () => {
    const onRatio = vi.fn();
    render(<PaneTree layout={padrao()} onRatio={onRatio} renderLeaf={renderId} />);
    const [raiz] = screen.getAllByRole('separator');
    act(() => raiz!.focus());
    fireEvent.keyDown(raiz!, { key: 'End' });
    fireEvent.keyDown(raiz!, { key: 'Home' });
    expect(onRatio.mock.calls.length).toBeGreaterThan(0);
    for (const [, r] of onRatio.mock.calls as [string, number][]) {
      expect(r).toBeGreaterThanOrEqual(0.15);
      expect(r).toBeLessThanOrEqual(0.85);
    }
  });

  it('não chama onRatio de novo quando o pai volta com o ratio já aplicado', () => {
    const onRatio = vi.fn();
    const { rerender } = render(
      <PaneTree layout={padrao()} onRatio={onRatio} renderLeaf={renderId} />,
    );
    const [raiz] = screen.getAllByRole('separator');
    act(() => raiz!.focus());
    fireEvent.keyDown(raiz!, { key: 'ArrowRight' });
    expect(onRatio).toHaveBeenCalledTimes(1);
    const novo = onRatio.mock.calls[0]![1] as number;
    rerender(<PaneTree layout={padrao(novo)} onRatio={onRatio} renderLeaf={renderId} />);
    expect(onRatio).toHaveBeenCalledTimes(1);
  });

  it('segue um ratio diferente que chega de fora, sem chamar onRatio', () => {
    const onRatio = vi.fn();
    const { rerender } = render(
      <PaneTree layout={padrao(0.52)} onRatio={onRatio} renderLeaf={renderId} />,
    );
    const antes = Number(screen.getAllByRole('separator')[0]!.getAttribute('aria-valuenow'));
    rerender(<PaneTree layout={padrao(0.3)} onRatio={onRatio} renderLeaf={renderId} />);
    const depois = Number(screen.getAllByRole('separator')[0]!.getAttribute('aria-valuenow'));
    expect(depois).not.toBe(antes);
    expect(depois).toBeCloseTo(30, 0);
    expect(onRatio).not.toHaveBeenCalled();
  });

  it('não remonta o conteúdo da folha quando só o ratio muda', () => {
    const montagens = vi.fn();
    function Folha() {
      useEffect(() => {
        montagens();
      }, []);
      return <i>folha</i>;
    }
    const renderLeaf = () => <Folha />;
    const { rerender } = render(
      <PaneTree layout={padrao(0.52)} onRatio={vi.fn()} renderLeaf={renderLeaf} />,
    );
    expect(montagens).toHaveBeenCalledTimes(3);
    rerender(<PaneTree layout={padrao(0.3, 0.7)} onRatio={vi.fn()} renderLeaf={renderLeaf} />);
    expect(montagens).toHaveBeenCalledTimes(3);
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
      ratio: 0.5,
      first: leaf(primeira, 'claude'),
      second: leaf(segunda, 'shell'),
    });
    const { rerender } = render(
      <PaneTree layout={dupla('a', 'b')} onRatio={vi.fn()} renderLeaf={renderLeaf} />,
    );
    rerender(<PaneTree layout={dupla('b', 'a')} onRatio={vi.fn()} renderLeaf={renderLeaf} />);
    expect(screen.getAllByTestId('folha').map((item) => item.textContent)).toEqual(['b', 'a']);
  });
});
