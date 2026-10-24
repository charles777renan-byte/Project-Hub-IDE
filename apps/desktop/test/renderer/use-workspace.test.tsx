import { act, renderHook } from '@testing-library/react';
import type { LayoutNode, WorkspaceDto } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getToasts, notify } from '../../src/renderer/notify';
import { SAVE_DELAY_MS, useWorkspace } from '../../src/renderer/workspace/use-workspace';
import { WORKSPACES_CHANGED_EVENT } from '../../src/renderer/workspaces-events';

function layoutOf(terminalA: string | null = null, terminalB: string | null = null): LayoutNode {
  return {
    type: 'split',
    id: 'raiz',
    direction: 'row',
    ratio: 0.5,
    first: { type: 'leaf', id: 'a', provider: 'claude', terminalId: terminalA },
    second: { type: 'leaf', id: 'b', provider: 'shell', terminalId: terminalB },
  };
}

const dto = (layout: LayoutNode, projectId = 'p1'): WorkspaceDto => ({
  id: `w-${projectId}`,
  projectId,
  layout,
  position: 0,
  lastActiveAt: '2026-10-22T10:00:00.000Z',
});

const api = {
  open: vi.fn(),
  saveLayout: vi.fn(),
  startSession: vi.fn(),
  endSession: vi.fn(),
  addPane: vi.fn(),
  removePane: vi.fn(),
};

beforeEach(() => {
  vi.useFakeTimers();
  api.open
    .mockReset()
    .mockImplementation(async (id: string) => ({ ok: true, data: dto(layoutOf(), id) }));
  api.saveLayout.mockReset().mockResolvedValue({ ok: true, data: undefined });
  api.startSession.mockReset();
  api.endSession.mockReset();
  api.addPane.mockReset();
  api.removePane.mockReset();
  window.projectHub = { workspaces: api } as unknown as typeof window.projectHub;
});

afterEach(() => {
  notify.clear();
  vi.useRealTimers();
});

async function mount(projectId = 'p1') {
  const view = renderHook(({ id }) => useWorkspace(id), { initialProps: { id: projectId } });
  await act(async () => {});
  return view;
}

function ratioOf(state: ReturnType<typeof useWorkspace>['state']): number {
  if (state.status !== 'ready' || state.workspace.layout?.type !== 'split') {
    throw new Error('estado');
  }
  return state.workspace.layout.ratio;
}

describe('useWorkspace', () => {
  it('abre o workspace ao montar e passa a ready, avisando as abas', async () => {
    const changed = vi.fn();
    window.addEventListener(WORKSPACES_CHANGED_EVENT, changed);
    const { result } = renderHook(() => useWorkspace('p1'));
    expect(result.current.state).toEqual({ status: 'loading' });
    await act(async () => {});
    window.removeEventListener(WORKSPACES_CHANGED_EVENT, changed);
    expect(api.open).toHaveBeenCalledWith('p1');
    expect(result.current.state.status).toBe('ready');
    expect(result.current.activeLeafId).toBe('a');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('erro da API vira error com a mensagem', async () => {
    api.open.mockResolvedValue({ ok: false, error: { code: 'x', message: 'Projeto sumiu' } });
    const { result } = await mount();
    expect(result.current.state).toEqual({ status: 'error', message: 'Projeto sumiu' });
  });

  it('setRatio muda na hora, limita a 0,1 a 0,9 e grava uma vez depois de 400 ms', async () => {
    const { result } = await mount();
    act(() => result.current.setRatio('raiz', 0.6));
    act(() => result.current.setRatio('raiz', 0.7));
    act(() => result.current.setRatio('raiz', 0.99));
    expect(ratioOf(result.current.state)).toBe(0.9);
    expect(api.saveLayout).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DELAY_MS - 1);
    });
    expect(api.saveLayout).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(api.saveLayout).toHaveBeenCalledTimes(1);
    expect(api.saveLayout.mock.calls[0]![0]).toBe('w-p1');
    expect((api.saveLayout.mock.calls[0]![1] as { ratio: number }).ratio).toBe(0.9);
  });

  it('flush grava na hora o que está pendente', async () => {
    const { result } = await mount();
    act(() => result.current.setRatio('raiz', 0.3));
    await act(async () => result.current.flush());
    expect(api.saveLayout).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DELAY_MS * 2);
    });
    expect(api.saveLayout).toHaveBeenCalledTimes(1);
  });

  it('desmontar com gravação pendente grava', async () => {
    const { result, unmount } = await mount();
    act(() => result.current.setRatio('raiz', 0.3));
    unmount();
    expect(api.saveLayout).toHaveBeenCalledTimes(1);
  });

  it('startSession grava antes, adota o DTO devolvido e devolve null', async () => {
    const order: string[] = [];
    api.saveLayout.mockImplementation(async () => {
      order.push('save');
      return { ok: true, data: undefined };
    });
    api.startSession.mockImplementation(async () => {
      order.push('start');
      return { ok: true, data: dto(layoutOf('t1')) };
    });
    const { result } = await mount();
    act(() => result.current.setRatio('raiz', 0.3));
    let outcome: string | null = 'x';
    await act(async () => {
      outcome = await result.current.startSession('a');
    });
    expect(order).toEqual(['save', 'start']);
    expect(api.startSession).toHaveBeenCalledWith('w-p1', 'a');
    expect(outcome).toBeNull();
    const state = result.current.state;
    expect(state.status === 'ready' && JSON.stringify(state.workspace.layout)).toContain('"t1"');
  });

  it('falha de startSession devolve a mensagem e mantém o layout', async () => {
    api.startSession.mockResolvedValue({ ok: false, error: { code: 'x', message: 'Sem Codex' } });
    const { result } = await mount();
    const before = result.current.state;
    let outcome: string | null = null;
    await act(async () => {
      outcome = await result.current.startSession('a');
    });
    expect(outcome).toBe('Sem Codex');
    expect(result.current.state).toBe(before);
  });

  it('endSession adota o DTO e devolve null', async () => {
    api.open.mockResolvedValue({ ok: true, data: dto(layoutOf('t1')) });
    api.endSession.mockResolvedValue({ ok: true, data: dto(layoutOf()) });
    const { result } = await mount();
    let outcome: string | null = 'x';
    await act(async () => {
      outcome = await result.current.endSession('a');
    });
    expect(outcome).toBeNull();
    expect(api.endSession).toHaveBeenCalledWith('w-p1', 'a');
  });

  it('showTerminal de terminal que já está numa folha só ativa a folha e não grava', async () => {
    api.open.mockResolvedValue({ ok: true, data: dto(layoutOf(null, 't9')) });
    const { result } = await mount();
    let target: string | null = null;
    act(() => {
      target = result.current.showTerminal('t9');
    });
    expect(target).toBe('b');
    expect(result.current.activeLeafId).toBe('b');
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DELAY_MS * 2);
    });
    expect(api.saveLayout).not.toHaveBeenCalled();
  });

  it('showTerminal de terminal livre põe na folha ativa e grava', async () => {
    const { result } = await mount();
    act(() => result.current.activate('b'));
    act(() => {
      result.current.showTerminal('t5');
    });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DELAY_MS);
    });
    expect(api.saveLayout).toHaveBeenCalledTimes(1);
    const saved = api.saveLayout.mock.calls[0]![1] as { second: { terminalId: string | null } };
    expect(saved.second.terminalId).toBe('t5');
  });

  it('detach zera o terminalId e grava', async () => {
    api.open.mockResolvedValue({ ok: true, data: dto(layoutOf('t1')) });
    const { result } = await mount();
    act(() => result.current.detach('a'));
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DELAY_MS);
    });
    const saved = api.saveLayout.mock.calls[0]![1] as { first: { terminalId: string | null } };
    expect(saved.first.terminalId).toBeNull();
  });

  it('trocar o projectId reabre', async () => {
    const { result, rerender } = await mount('p1');
    rerender({ id: 'p2' });
    await act(async () => {});
    expect(api.open).toHaveBeenLastCalledWith('p2');
    const state = result.current.state;
    expect(state.status === 'ready' && state.workspace.projectId).toBe('p2');
  });

  it('resposta de startSession em voo depois de trocar de projeto não contamina o novo', async () => {
    let resolve: (value: unknown) => void = () => {};
    api.startSession.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { result, rerender } = await mount('p1');
    let outcome: string | null = 'x';
    let pending: Promise<string | null> = Promise.resolve(null);
    act(() => {
      pending = result.current.startSession('a');
    });
    await act(async () => {});
    rerender({ id: 'p2' });
    await act(async () => {});
    await act(async () => {
      resolve({ ok: true, data: dto(layoutOf('t1'), 'p1') });
      outcome = await pending;
    });
    expect(outcome).toBeNull();
    const state = result.current.state;
    expect(state.status === 'ready' && state.workspace.projectId).toBe('p2');
    expect(state.status === 'ready' && JSON.stringify(state.workspace.layout)).not.toContain('t1');
  });

  it('setRatio durante o startSession é preservado e é o que grava', async () => {
    let resolve: (value: unknown) => void = () => {};
    api.startSession.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { result } = await mount();
    let pending: Promise<string | null> = Promise.resolve(null);
    act(() => {
      pending = result.current.startSession('a');
    });
    await act(async () => {});
    act(() => result.current.setRatio('raiz', 0.3));
    await act(async () => {
      resolve({ ok: true, data: dto(layoutOf('t1')) });
      await pending;
    });
    expect(ratioOf(result.current.state)).toBe(0.3);
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DELAY_MS);
    });
    const saved = api.saveLayout.mock.calls.at(-1)![1] as {
      ratio: number;
      first: { terminalId: string | null };
    };
    expect(saved.ratio).toBe(0.3);
    expect(saved.first.terminalId).toBe('t1');
  });

  it('gravação que falha volta a ficar pendente e é tentada de novo', async () => {
    api.saveLayout.mockRejectedValueOnce(new Error('falhou'));
    const { result } = await mount();
    act(() => result.current.setRatio('raiz', 0.3));
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DELAY_MS);
    });
    expect(api.saveLayout).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DELAY_MS);
    });
    expect(api.saveLayout).toHaveBeenCalledTimes(2);
  });

  it('a ativação inicial não pede o foco do terminal; clique e barra lateral pedem', async () => {
    api.open.mockResolvedValue({ ok: true, data: dto(layoutOf(null, 't9')) });
    const { result } = await mount();
    expect(result.current.activeLeafId).toBe('a');
    expect(result.current.focusLeafId).toBeNull();

    act(() => result.current.activate('b'));
    expect(result.current.focusLeafId).toBeNull();
    act(() => result.current.activateWithFocus('a'));
    expect(result.current.focusLeafId).toBe('a');
    act(() => {
      result.current.showTerminal('t9');
    });
    expect(result.current.focusLeafId).toBe('b');
  });

  it('divisória movida durante startSession volta a ser gravada em vez de ser sobrescrita', async () => {
    let finish: (() => void) | undefined;
    api.startSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ ok: true, data: dto(layoutOf('t1')) });
        }),
    );
    const { result } = await mount();
    let pending: Promise<string | null> | undefined;
    await act(async () => {
      pending = result.current.startSession('a');
    });
    act(() => result.current.setRatio('raiz', 0.3));
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DELAY_MS);
    });
    api.saveLayout.mockClear();
    await act(async () => {
      finish?.();
      await pending;
    });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DELAY_MS);
    });
    expect(api.saveLayout).toHaveBeenCalledTimes(1);
    const saved = api.saveLayout.mock.calls[0]![1] as {
      ratio: number;
      first: { terminalId: string };
    };
    expect(saved.ratio).toBe(0.3);
    expect(saved.first.terminalId).toBe('t1');
  });

  it('recusa VALIDATION_FAILED não é repetida e vira saveError', async () => {
    api.saveLayout.mockResolvedValue({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'inválido' },
    });
    const { result } = await mount();
    act(() => result.current.setRatio('raiz', 0.3));
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DELAY_MS);
    });
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DELAY_MS * 5);
    });
    expect(api.saveLayout).toHaveBeenCalledTimes(1);
    expect(result.current.saveError).not.toBeNull();
  });

  it('a recusa gravada na desmontagem vira aviso mesmo sem o hook montado', async () => {
    api.saveLayout.mockResolvedValue({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'inválido' },
    });
    const { result, unmount } = await mount();
    act(() => result.current.setRatio('raiz', 0.3));
    unmount();
    await act(async () => {});
    expect(getToasts().map((toast) => toast.message)).toEqual([
      'O layout não pôde ser gravado e não será tentado de novo.',
    ]);
  });

  it('o aviso do layout se aposenta quando a próxima edição volta a gravar', async () => {
    api.saveLayout.mockResolvedValueOnce({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'inválido' },
    });
    const { result } = await mount();
    act(() => result.current.setRatio('raiz', 0.3));
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DELAY_MS);
    });
    expect(getToasts()).toHaveLength(1);
    act(() => result.current.setRatio('raiz', 0.4));
    expect(getToasts()).toHaveLength(0);
  });

  it('o aviso do layout se aposenta na troca de projeto', async () => {
    api.saveLayout.mockResolvedValue({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'inválido' },
    });
    const { result, rerender } = await mount();
    act(() => result.current.setRatio('raiz', 0.3));
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DELAY_MS);
    });
    expect(getToasts()).toHaveLength(1);
    rerender({ id: 'p2' });
    await act(async () => {});
    expect(getToasts()).toHaveLength(0);
  });

  describe('painéis', () => {
    const tres = (): LayoutNode => ({
      type: 'split',
      id: 'raiz',
      direction: 'row',
      ratio: 0.5,
      first: { type: 'leaf', id: 'a', provider: 'claude', terminalId: null },
      second: {
        type: 'split',
        id: 'meio',
        direction: 'column',
        ratio: 0.5,
        first: { type: 'leaf', id: 'b', provider: 'shell', terminalId: null },
        second: { type: 'leaf', id: 'c', provider: 'codex', terminalId: null },
      },
    });
    const vazio = null as unknown as LayoutNode;

    it('addPane grava antes, adota o layout devolvido inteiro e ativa a folha nova com foco', async () => {
      const order: string[] = [];
      api.saveLayout.mockImplementation(async () => {
        order.push('save');
        return { ok: true, data: undefined };
      });
      api.addPane.mockImplementation(async () => {
        order.push('add');
        return { ok: true, data: dto(tres()) };
      });
      const { result } = await mount();
      act(() => result.current.setRatio('raiz', 0.3));
      let outcome: string | null = 'x';
      await act(async () => {
        outcome = await result.current.addPane('codex');
      });
      expect(order).toEqual(['save', 'add']);
      expect(api.addPane).toHaveBeenCalledWith('w-p1', 'codex');
      expect(outcome).toBeNull();
      const state = result.current.state;
      expect(state.status === 'ready' && state.workspace.layout).toEqual(tres());
      expect(result.current.activeLeafId).toBe('c');
      expect(result.current.focusLeafId).toBe('c');
    });

    it('addPane com erro do IPC devolve o texto e não muda o layout', async () => {
      api.addPane.mockResolvedValue({
        ok: false,
        error: { code: 'x', message: 'Limite atingido' },
      });
      const { result } = await mount();
      const before = result.current.state;
      let outcome: string | null = null;
      await act(async () => {
        outcome = await result.current.addPane('shell');
      });
      expect(outcome).toBe('Limite atingido');
      expect(result.current.state).toBe(before);
      expect(result.current.activeLeafId).toBe('a');
    });

    it('addPane que lança devolve um texto de erro', async () => {
      api.addPane.mockRejectedValue(new Error('boom'));
      const { result } = await mount();
      let outcome: string | null = null;
      await act(async () => {
        outcome = await result.current.addPane('shell');
      });
      expect(typeof outcome).toBe('string');
    });

    it('resposta de addPane de projeto antigo (geração trocada) é ignorada', async () => {
      let resolve: (value: unknown) => void = () => {};
      api.addPane.mockReturnValue(new Promise((r) => (resolve = r)));
      const { result, rerender } = await mount('p1');
      let pending: Promise<string | null> = Promise.resolve(null);
      act(() => {
        pending = result.current.addPane('codex');
      });
      await act(async () => {});
      rerender({ id: 'p2' });
      await act(async () => {});
      await act(async () => {
        resolve({ ok: true, data: dto(tres(), 'p1') });
        await pending;
      });
      const state = result.current.state;
      expect(state.status === 'ready' && state.workspace.projectId).toBe('p2');
      expect(state.status === 'ready' && state.workspace.layout).toEqual(layoutOf());
      expect(result.current.activeLeafId).toBe('a');
    });

    it('removePane adota o devolvido e ativa a primeira restante se a ativa saiu', async () => {
      const restante: LayoutNode = { type: 'leaf', id: 'b', provider: 'shell', terminalId: null };
      api.removePane.mockResolvedValue({ ok: true, data: dto(restante) });
      const { result } = await mount();
      let outcome: string | null = 'x';
      await act(async () => {
        outcome = await result.current.removePane('a');
      });
      expect(api.removePane).toHaveBeenCalledWith('w-p1', 'a');
      expect(outcome).toBeNull();
      const state = result.current.state;
      expect(state.status === 'ready' && state.workspace.layout).toEqual(restante);
      expect(result.current.activeLeafId).toBe('b');
    });

    it('removePane mantém a folha ativa quando ela continua no layout', async () => {
      const restante: LayoutNode = { type: 'leaf', id: 'a', provider: 'claude', terminalId: null };
      api.removePane.mockResolvedValue({ ok: true, data: dto(restante) });
      const { result } = await mount();
      await act(async () => {
        await result.current.removePane('b');
      });
      expect(result.current.activeLeafId).toBe('a');
    });

    it('removePane da última folha deixa o layout null e sem folha ativa', async () => {
      api.removePane.mockResolvedValue({ ok: true, data: dto(vazio) });
      const { result } = await mount();
      await act(async () => {
        await result.current.removePane('a');
      });
      const state = result.current.state;
      expect(state.status === 'ready' && state.workspace.layout).toBeNull();
      expect(result.current.activeLeafId).toBeNull();
    });

    it('removePane com erro devolve o texto e não muda o layout', async () => {
      api.removePane.mockResolvedValue({ ok: false, error: { code: 'x', message: 'Sem painel' } });
      const { result } = await mount();
      const before = result.current.state;
      let outcome: string | null = null;
      await act(async () => {
        outcome = await result.current.removePane('zzz');
      });
      expect(outcome).toBe('Sem painel');
      expect(result.current.state).toBe(before);
    });

    it('showTerminal com layout null devolve null sem erro', async () => {
      api.open.mockResolvedValue({ ok: true, data: dto(vazio) });
      const { result } = await mount();
      let id: string | null = 'x';
      act(() => {
        id = result.current.showTerminal('t1');
      });
      expect(id).toBeNull();
      expect(result.current.activeLeafId).toBeNull();
    });
  });
});
