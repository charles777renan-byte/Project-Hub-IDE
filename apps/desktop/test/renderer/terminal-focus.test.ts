import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearTerminalFocus,
  resetTerminalFocusForTests,
  setTerminalFocus,
  useTerminalFocus,
} from '../../src/renderer/terminal-focus';

/** O foco de terminal: qual painel tem o foco, para a barra de status. */

beforeEach(() => {
  resetTerminalFocusForTests();
});

describe('terminal-focus', () => {
  it('começa sem foco', () => {
    const { result } = renderHook(() => useTerminalFocus());
    expect(result.current).toBeNull();
  });

  it('setTerminalFocus publica o foco para quem lê', () => {
    const { result } = renderHook(() => useTerminalFocus());
    act(() => setTerminalFocus({ key: 'a', title: 'Claude', inTerminal: true }));
    expect(result.current).toEqual({ key: 'a', title: 'Claude', inTerminal: true });
  });

  it('o foco que passa de um painel a outro troca o publicado', () => {
    const { result } = renderHook(() => useTerminalFocus());
    act(() => setTerminalFocus({ key: 'a', title: 'Claude', inTerminal: true }));
    act(() => setTerminalFocus({ key: 'b', title: 'Codex', inTerminal: true }));
    expect(result.current).toEqual({ key: 'b', title: 'Codex', inTerminal: true });
  });

  it('clearTerminalFocus só limpa quando o foco atual é dessa chave', () => {
    const { result } = renderHook(() => useTerminalFocus());
    act(() => setTerminalFocus({ key: 'b', title: 'Codex', inTerminal: true }));
    act(() => clearTerminalFocus('a'));
    expect(result.current).toEqual({ key: 'b', title: 'Codex', inTerminal: true });
    act(() => clearTerminalFocus('b'));
    expect(result.current).toBeNull();
  });

  it('limpar sem foco algum não avisa ninguém', () => {
    const seen: unknown[] = [];
    const { result } = renderHook(() => {
      const focus = useTerminalFocus();
      seen.push(focus);
      return focus;
    });
    const renders = seen.length;
    act(() => clearTerminalFocus('a'));
    expect(result.current).toBeNull();
    expect(seen.length).toBe(renders);
  });

  it('publicar de novo a mesma chave e o mesmo título não avisa ninguém nem troca o objeto', () => {
    const seen: unknown[] = [];
    const { result } = renderHook(() => {
      const focus = useTerminalFocus();
      seen.push(focus);
      return focus;
    });
    act(() => setTerminalFocus({ key: 'a', title: 'Claude', inTerminal: true }));
    const published = result.current;
    const renders = seen.length;
    act(() => setTerminalFocus({ key: 'a', title: 'Claude', inTerminal: true }));
    expect(seen.length).toBe(renders);
    expect(result.current).toBe(published);
    // Onde está o foco (dentro do terminal ou só no cartão) também conta como mudança.
    act(() => setTerminalFocus({ key: 'a', title: 'Claude', inTerminal: false }));
    expect(result.current).toEqual({ key: 'a', title: 'Claude', inTerminal: false });
    expect(seen.length).toBe(renders + 1);
    act(() => setTerminalFocus({ key: 'a', title: 'Claude', inTerminal: false }));
    expect(seen.length).toBe(renders + 1);
    act(() => setTerminalFocus({ key: 'a', title: 'Claude', inTerminal: true }));
    expect(seen.length).toBe(renders + 2);
    // Título novo na mesma chave é uma mudança de verdade.
    act(() => setTerminalFocus({ key: 'a', title: 'Outro', inTerminal: true }));
    expect(result.current).toEqual({ key: 'a', title: 'Outro', inTerminal: true });
    expect(seen.length).toBe(renders + 3);
  });

  it('resetTerminalFocusForTests zera o foco', () => {
    const { result } = renderHook(() => useTerminalFocus());
    act(() => setTerminalFocus({ key: 'a', title: 'Claude', inTerminal: true }));
    act(() => resetTerminalFocusForTests());
    expect(result.current).toBeNull();
  });
});
