import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  askBeforeClosing,
  setAskBeforeClosing,
  useAskBeforeClosing,
} from '../../src/renderer/close-confirm';

/** A preferência "perguntar antes de fechar um terminal com agente rodando", guardada no app inteiro. */

const KEY = 'project-hub:perguntar-ao-fechar-terminal';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('close-confirm', () => {
  it('o padrão é perguntar', () => {
    expect(askBeforeClosing()).toBe(true);
  });

  it('setAskBeforeClosing(false) grava "false" e a leitura passa a ser não perguntar', () => {
    setAskBeforeClosing(false);
    expect(window.localStorage.getItem(KEY)).toBe('false');
    expect(askBeforeClosing()).toBe(false);
  });

  it('setAskBeforeClosing(true) volta a perguntar', () => {
    setAskBeforeClosing(false);
    setAskBeforeClosing(true);
    expect(askBeforeClosing()).toBe(true);
  });

  it('valor estranho no armazenamento conta como perguntar', () => {
    window.localStorage.setItem(KEY, 'talvez');
    expect(askBeforeClosing()).toBe(true);
    window.localStorage.setItem(KEY, '');
    expect(askBeforeClosing()).toBe(true);
  });

  it('sem acesso ao localStorage, pergunta e a gravação não quebra', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(askBeforeClosing()).toBe(true);
    expect(() => setAskBeforeClosing(false)).not.toThrow();
  });

  it('o hook começa no valor guardado e re-renderiza quando a preferência muda', () => {
    window.localStorage.setItem(KEY, 'false');
    const { result } = renderHook(() => useAskBeforeClosing());
    expect(result.current).toBe(false);
    act(() => setAskBeforeClosing(true));
    expect(result.current).toBe(true);
    act(() => setAskBeforeClosing(false));
    expect(result.current).toBe(false);
  });

  it('dois leitores veem a mesma mudança', () => {
    const first = renderHook(() => useAskBeforeClosing());
    const second = renderHook(() => useAskBeforeClosing());
    act(() => setAskBeforeClosing(false));
    expect(first.result.current).toBe(false);
    expect(second.result.current).toBe(false);
  });
});
