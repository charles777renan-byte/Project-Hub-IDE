import { act, fireEvent, render, screen } from '@testing-library/react';
import type { LayoutNode } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  dockedLayout,
  previewBox,
  sameArrangement,
  spotAt,
  zoneAt,
  type DropZone,
} from '../../src/renderer/workspace/pane-drag';
import { usePaneDrag } from '../../src/renderer/workspace/use-pane-drag';

const leaf = (id: string) => ({ type: 'leaf', id, provider: 'shell', terminalId: null }) as const;
const box = { left: 100, top: 50, width: 400, height: 200 };

describe('spotAt', () => {
  it('os 40% centrais, nos dois eixos, trocam os painéis de lugar', () => {
    expect(spotAt(box, 300, 150)).toBe('center');
    expect(spotAt(box, 221, 111)).toBe('center');
    expect(spotAt(box, 379, 189)).toBe('center');
  });

  it('fora do centro vale a borda mais próxima, em proporção do painel', () => {
    expect(spotAt(box, 110, 150)).toBe('left');
    expect(spotAt(box, 490, 150)).toBe('right');
    expect(spotAt(box, 300, 55)).toBe('top');
    expect(spotAt(box, 300, 245)).toBe('bottom');
    // Logo fora da faixa central: 30% da largura é 220 px a partir da esquerda.
    expect(spotAt(box, 215, 150)).toBe('left');
    // A proporção decide, não os px: a 60 px da esquerda (15% da largura) e a 40 px do topo (20% da altura), é esquerda.
    expect(spotAt(box, 160, 90)).toBe('left');
    expect(spotAt(box, 200, 60)).toBe('top');
  });

  it('ponteiro fora da caixa, ou caixa sem tamanho, não tem ponto', () => {
    expect(spotAt(box, 99, 150)).toBeNull();
    expect(spotAt(box, 300, 251)).toBeNull();
    expect(spotAt({ ...box, width: 0 }, 100, 150)).toBeNull();
  });
});

describe('previewBox', () => {
  it('a troca ocupa o destino inteiro; o encaixe, a metade daquele lado', () => {
    expect(previewBox(box, 'center')).toEqual(box);
    expect(previewBox(box, 'left')).toEqual({ left: 100, top: 50, width: 200, height: 200 });
    expect(previewBox(box, 'right')).toEqual({ left: 300, top: 50, width: 200, height: 200 });
    expect(previewBox(box, 'top')).toEqual({ left: 100, top: 50, width: 400, height: 100 });
    expect(previewBox(box, 'bottom')).toEqual({ left: 100, top: 150, width: 400, height: 100 });
  });
});

describe('zoneAt', () => {
  const boxes = [
    { id: 'a', box: { left: 0, top: 0, width: 400, height: 300 } },
    { id: 'b', box: { left: 408, top: 0, width: 400, height: 300 } },
  ];

  it('acha o painel sob o ponteiro e o ponto dele', () => {
    expect(zoneAt(boxes, 'a', 608, 150)).toEqual({ targetId: 'b', spot: 'center' });
    expect(zoneAt(boxes, 'a', 800, 150)).toEqual({ targetId: 'b', spot: 'right' });
  });

  it('o próprio painel arrastado e o vão entre painéis não são destino', () => {
    expect(zoneAt(boxes, 'a', 200, 150)).toBeNull();
    expect(zoneAt(boxes, 'a', 404, 150)).toBeNull();
    expect(zoneAt(boxes, 'a', 900, 150)).toBeNull();
  });
});

describe('dockedLayout', () => {
  const row: LayoutNode = {
    type: 'split',
    id: 'r',
    direction: 'row',
    children: [leaf('a'), leaf('b')],
    sizes: [0.5, 0.5],
  };

  it('encaixar onde o painel já está não muda nada', () => {
    expect(dockedLayout(row, 'a', 'b', 'left', () => 'n')).toBeNull();
    expect(dockedLayout(row, 'b', 'a', 'right', () => 'n')).toBeNull();
  });

  it('encaixar do outro lado, ou em cima, muda o layout', () => {
    const invertido = dockedLayout(row, 'a', 'b', 'right', () => 'n') as LayoutNode;
    expect(sameArrangement(row, invertido)).toBe(false);
    expect(dockedLayout(row, 'a', 'b', 'top', () => 'n')).toMatchObject({
      type: 'split',
      direction: 'column',
      children: [{ id: 'a' }, { id: 'b' }],
    });
  });
});

describe('usePaneDrag', () => {
  const onDrop = vi.fn();
  const accepts = vi.fn((_sourceId: string, _zone: DropZone) => true);

  function Bancada() {
    const { drag, onGripPointerDown } = usePaneDrag({
      area: document.querySelector<HTMLElement>('[data-testid="area"]'),
      accepts,
      onDrop,
    });
    return (
      <>
        <span data-testid="alca" onPointerDown={(event) => onGripPointerDown('a', event)} />
        <output data-testid="estado">{JSON.stringify(drag)}</output>
      </>
    );
  }

  function montar() {
    onDrop.mockClear();
    accepts.mockClear().mockReturnValue(true);
    const area = document.createElement('div');
    area.dataset.testid = 'area';
    area.getBoundingClientRect = () => new DOMRect(10, 20, 808, 300);
    const lugar = (id: string, left: number) => {
      const slot = document.createElement('div');
      slot.className = 'pane-tree__leaf';
      slot.dataset.leafId = id;
      slot.getBoundingClientRect = () => new DOMRect(left, 20, 400, 300);
      area.append(slot);
      return slot;
    };
    const a = lugar('a', 10);
    lugar('b', 418);
    document.body.append(area);
    // A área precisa existir antes da primeira renderização (a bancada a procura no documento).
    const view = render(<Bancada />);
    view.rerender(<Bancada />);
    const estado = () => JSON.parse(screen.getByTestId('estado').textContent || 'null');
    return { alca: screen.getByTestId('alca'), a, estado, limpar: () => area.remove() };
  }

  const descer = (alca: HTMLElement) =>
    fireEvent.pointerDown(alca, { pointerId: 1, button: 0, clientX: 30, clientY: 30 });
  const mover = (alca: HTMLElement, clientX: number, clientY: number) =>
    act(() => {
      fireEvent.pointerMove(alca, { pointerId: 1, clientX, clientY });
    });

  it('menos de 6 px não é arrasto: nada aparece e soltar não move nada', () => {
    const { alca, estado, limpar } = montar();
    descer(alca);
    mover(alca, 33, 33);
    expect(estado()).toBeNull();
    fireEvent.pointerUp(alca, { pointerId: 1 });
    expect(onDrop).not.toHaveBeenCalled();
    limpar();
  });

  it('arrastar para a borda direita de outro painel mostra a prévia daquela metade e soltar encaixa ali', () => {
    const { alca, a, estado, limpar } = montar();
    descer(alca);
    mover(alca, 800, 170);
    expect(estado()).toMatchObject({
      sourceId: 'a',
      x: 800,
      y: 170,
      zone: { targetId: 'b', spot: 'right' },
      // Em px a partir do canto da área (10, 20): a metade direita de `b`.
      preview: { left: 608, top: 0, width: 200, height: 300 },
    });
    expect(a).toHaveAttribute('data-drag-source', 'true');
    act(() => {
      fireEvent.pointerUp(alca, { pointerId: 1 });
    });
    expect(onDrop).toHaveBeenCalledWith('a', { targetId: 'b', spot: 'right' });
    expect(estado()).toBeNull();
    expect(a).not.toHaveAttribute('data-drag-source');
    limpar();
  });

  it('soltar no meio de outro painel pede a troca', () => {
    const { alca, limpar } = montar();
    descer(alca);
    mover(alca, 618, 170);
    act(() => {
      fireEvent.pointerUp(alca, { pointerId: 1 });
    });
    expect(onDrop).toHaveBeenCalledWith('a', { targetId: 'b', spot: 'center' });
    limpar();
  });

  it('Esc cancela: a prévia some, a tecla não segue adiante e soltar depois não move nada', () => {
    const { alca, estado, limpar } = montar();
    descer(alca);
    mover(alca, 800, 170);
    const tecla = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(tecla);
    });
    expect(tecla.defaultPrevented).toBe(true);
    expect(estado()).toBeNull();
    fireEvent.pointerUp(alca, { pointerId: 1 });
    expect(onDrop).not.toHaveBeenCalled();
    limpar();
  });

  it('soltar fora de qualquer painel, ou num destino recusado, cancela', () => {
    const { alca, estado, limpar } = montar();
    descer(alca);
    mover(alca, 2000, 2000);
    expect(estado()).toMatchObject({ zone: null, preview: null });
    act(() => {
      fireEvent.pointerUp(alca, { pointerId: 1 });
    });
    expect(onDrop).not.toHaveBeenCalled();

    accepts.mockReturnValue(false);
    descer(alca);
    mover(alca, 800, 170);
    expect(estado()).toMatchObject({ zone: null, preview: null });
    act(() => {
      fireEvent.pointerUp(alca, { pointerId: 1 });
    });
    expect(onDrop).not.toHaveBeenCalled();
    limpar();
  });

  it('o botão direito não começa arrasto', () => {
    const { alca, estado, limpar } = montar();
    fireEvent.pointerDown(alca, { pointerId: 1, button: 2, clientX: 30, clientY: 30 });
    mover(alca, 800, 170);
    expect(estado()).toBeNull();
    limpar();
  });
});
