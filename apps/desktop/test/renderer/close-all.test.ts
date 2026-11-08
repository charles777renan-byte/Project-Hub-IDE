import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearCloseAllRequest,
  closeAllQuestion,
  requestCloseAll,
  resetCloseAllForTests,
  setPaneCount,
  useCloseAllRequest,
  usePaneCount,
} from '../../src/renderer/workspace/close-all';

/** O pedido "fechar todos os terminais" e a contagem de painéis, que o cabeçalho e o workspace combinam por projeto. */

beforeEach(() => {
  resetCloseAllForTests();
});

describe('close-all: contagem de painéis', () => {
  it('começa em 0 para um projeto sem registro', () => {
    const { result } = renderHook(() => usePaneCount('p1'));
    expect(result.current).toBe(0);
  });

  it('guarda a contagem por projeto, sem misturar dois projetos', () => {
    const p1 = renderHook(() => usePaneCount('p1'));
    const p2 = renderHook(() => usePaneCount('p2'));
    act(() => setPaneCount('p1', 3));
    expect(p1.result.current).toBe(3);
    expect(p2.result.current).toBe(0);
    act(() => setPaneCount('p2', 5));
    act(() => setPaneCount('p1', 0));
    expect(p1.result.current).toBe(0);
    expect(p2.result.current).toBe(5);
  });
});

describe('close-all: pedido', () => {
  it('começa sem pedido', () => {
    const { result } = renderHook(() => useCloseAllRequest('p1'));
    expect(result.current).toBe(false);
  });

  it('o pedido marca só o projeto pedido', () => {
    const p1 = renderHook(() => useCloseAllRequest('p1'));
    const p2 = renderHook(() => useCloseAllRequest('p2'));
    act(() => requestCloseAll('p1'));
    expect(p1.result.current).toBe(true);
    expect(p2.result.current).toBe(false);
  });

  it('o pedido feito antes de alguém ouvir fica à espera (sobrevive à navegação)', () => {
    requestCloseAll('p1');
    const { result } = renderHook(() => useCloseAllRequest('p1'));
    expect(result.current).toBe(true);
  });

  it('clear limpa só o projeto indicado', () => {
    const p1 = renderHook(() => useCloseAllRequest('p1'));
    const p2 = renderHook(() => useCloseAllRequest('p2'));
    act(() => {
      requestCloseAll('p1');
      requestCloseAll('p2');
    });
    act(() => clearCloseAllRequest('p1'));
    expect(p1.result.current).toBe(false);
    expect(p2.result.current).toBe(true);
  });
});

describe('close-all: a pergunta', () => {
  it('vários painéis, sessões e missão', () => {
    expect(closeAllQuestion({ panes: 12, sessions: 11, missions: 1 })).toBe(
      'Fechar os 12 painéis? 11 sessões serão encerradas; as missões continuam.',
    );
  });

  it('um painel com uma sessão, no singular', () => {
    expect(closeAllQuestion({ panes: 1, sessions: 1, missions: 0 })).toBe(
      'Fechar o painel? 1 sessão será encerrada.',
    );
  });

  it('sem missão, some a segunda metade', () => {
    expect(closeAllQuestion({ panes: 3, sessions: 2, missions: 0 })).toBe(
      'Fechar os 3 painéis? 2 sessões serão encerradas.',
    );
  });

  it('só missões: sem a frase de sessões', () => {
    expect(closeAllQuestion({ panes: 2, sessions: 0, missions: 2 })).toBe(
      'Fechar os 2 painéis? As missões continuam.',
    );
  });

  it('só shells sem sessão viva: só a pergunta', () => {
    expect(closeAllQuestion({ panes: 2, sessions: 0, missions: 0 })).toBe('Fechar os 2 painéis?');
  });
});
