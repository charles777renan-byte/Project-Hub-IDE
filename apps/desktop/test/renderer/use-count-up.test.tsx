import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNT_UP_MS, useCountUp } from '../../src/renderer/workspace/use-count-up';

/**
 * O contador do gasto de tokens (workspace/use-count-up.ts). O jsdom não tem relógio de quadros nem
 * `matchMedia`: o teste entrega os dois, com o tempo na mão, para andar a subida quadro a quadro.
 */

let now = 0;
let queue = new Map<number, FrameRequestCallback>();
let nextId = 1;
let reduceMotion = false;

/** Avança o relógio e roda os quadros que estavam pedidos. */
function advance(ms: number) {
  now += ms;
  const due = [...queue.entries()];
  queue = new Map();
  act(() => {
    for (const [, callback] of due) callback(now);
  });
}

beforeEach(() => {
  now = 0;
  queue = new Map();
  nextId = 1;
  reduceMotion = false;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextId++;
    queue.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    queue.delete(id);
  });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduceMotion && query.includes('prefers-reduced-motion'),
    media: query,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useCountUp', () => {
  it('mostra o primeiro valor direto, sem contar de zero', () => {
    const { result } = renderHook(() => useCountUp(12_345));
    expect(result.current).toEqual({ value: 12_345, counting: false });
    expect(queue.size).toBe(0);
  });

  it('sobe até o novo alvo passando por valores intermediários, e termina exatamente nele', () => {
    const { result, rerender } = renderHook(({ target }) => useCountUp(target), {
      initialProps: { target: 1_000 },
    });
    rerender({ target: 2_000 });
    expect(result.current.counting).toBe(true);
    expect(result.current.value).toBe(1_000);

    advance(COUNT_UP_MS / 2);
    const middle = result.current.value as number;
    expect(middle).toBeGreaterThan(1_000);
    expect(middle).toBeLessThan(2_000);
    expect(result.current.counting).toBe(true);

    advance(COUNT_UP_MS);
    expect(result.current).toEqual({ value: 2_000, counting: false });
    expect(queue.size).toBe(0);
  });

  it('nunca passa do alvo e só cresce durante a subida', () => {
    const { result, rerender } = renderHook(({ target }) => useCountUp(target), {
      initialProps: { target: 0 },
    });
    rerender({ target: 999 });
    let previous = 0;
    for (let step = 0; step < 20; step += 1) {
      advance(COUNT_UP_MS / 10);
      const value = result.current.value as number;
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(999);
      previous = value;
    }
    expect(result.current.value).toBe(999);
  });

  it('um alvo novo no meio da subida continua do número que já está na tela', () => {
    const { result, rerender } = renderHook(({ target }) => useCountUp(target), {
      initialProps: { target: 1_000 },
    });
    rerender({ target: 2_000 });
    advance(COUNT_UP_MS / 2);
    const onScreen = result.current.value as number;

    rerender({ target: 3_000 });
    expect(result.current.value).toBe(onScreen);
    expect(result.current.counting).toBe(true);

    advance(COUNT_UP_MS * 2);
    expect(result.current).toEqual({ value: 3_000, counting: false });
  });

  it('um alvo menor (sessão nova) ou ausente vai direto, sem contar para trás', () => {
    const { result, rerender } = renderHook(({ target }) => useCountUp(target), {
      initialProps: { target: 5_000 as number | undefined },
    });
    rerender({ target: 40 });
    expect(result.current).toEqual({ value: 40, counting: false });

    rerender({ target: undefined });
    expect(result.current).toEqual({ value: undefined, counting: false });

    // Voltando a ter número, o primeiro valor também aparece direto.
    rerender({ target: 700 });
    expect(result.current).toEqual({ value: 700, counting: false });
  });

  it('com "reduzir movimento" o número vai direto ao alvo', () => {
    reduceMotion = true;
    const { result, rerender } = renderHook(({ target }) => useCountUp(target), {
      initialProps: { target: 100 },
    });
    rerender({ target: 5_000 });
    expect(result.current).toEqual({ value: 5_000, counting: false });
    expect(queue.size).toBe(0);
  });

  it('ao desmontar no meio da subida, cancela o quadro pedido', () => {
    const { rerender, unmount } = renderHook(({ target }) => useCountUp(target), {
      initialProps: { target: 1 },
    });
    rerender({ target: 100 });
    expect(queue.size).toBe(1);
    unmount();
    expect(queue.size).toBe(0);
  });
});
