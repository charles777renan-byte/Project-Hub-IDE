import { act } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

/** O jsdom não tem ResizeObserver nem layout. Este falso guarda o que cada instância observa e deixa o teste medir. */
export class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed = new Set<Element>();
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.add(target);
  }

  unobserve(target: Element) {
    this.observed.delete(target);
  }

  disconnect() {
    this.observed.clear();
    this.disconnected = true;
  }

  /** Avisa uma medida do alvo, como o navegador faria ao mudar o tamanho da caixa. */
  report(target: Element, width: number, height: number) {
    // Além do `contentRect`, as caixas que a biblioteca das divisórias lê (`inlineSize` e `blockSize`).
    const box = [{ inlineSize: width, blockSize: height }];
    const entry = {
      target,
      contentRect: { width, height },
      borderBoxSize: box,
      contentBoxSize: box,
    } as unknown as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
}

/** A instância viva (a mais recente que ainda observa algo). */
export function liveResize(): FakeResizeObserver {
  const found = FakeResizeObserver.instances.filter((item) => !item.disconnected).at(-1);
  if (found === undefined) throw new Error('Nenhum ResizeObserver vivo.');
  return found;
}

/** Diz ao observador vivo que o elemento observado passou a medir `width` × `height`. */
export function measure(width: number, height: number) {
  const live = liveResize();
  const [target] = [...live.observed];
  if (target === undefined) throw new Error('O observador vivo não observa nada.');
  act(() => live.report(target, width, height));
}

/** Instala o falso a cada teste e o tira ao fim. */
export function useFakeResizeObserver() {
  beforeEach(() => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
}
