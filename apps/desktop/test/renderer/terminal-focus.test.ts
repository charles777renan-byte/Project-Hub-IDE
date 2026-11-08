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
    act(() => setTerminalFocus({ key: 'a', title: 'Claude' }));
    expect(result.current).toEqual({ key: 'a', title: 'Claude' });
  });

  it('o foco que passa de um painel a outro troca o publicado', () => {
    const { result } = renderHook(() => useTerminalFocus());
    act(() => setTerminalFocus({ key: 'a', title: 'Claude' }));
    act(() => setTerminalFocus({ key: 'b', title: 'Codex' }));
    expect(result.current).toEqual({ key: 'b', title: 'Codex' });
  });

  it('clearTerminalFocus só limpa quando o foco atual é dessa chave', () => {
    const { result } = renderHook(() => useTerminalFocus());
    act(() => setTerminalFocus({ key: 'b', title: 'Codex' }));
    act(() => clearTerminalFocus('a'));
    expect(result.current).toEqual({ key: 'b', title: 'Codex' });
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

  it('resetTerminalFocusForTests zera o foco', () => {
    const { result } = renderHook(() => useTerminalFocus());
    act(() => setTerminalFocus({ key: 'a', title: 'Claude' }));
    act(() => resetTerminalFocusForTests());
    expect(result.current).toBeNull();
  });
});
