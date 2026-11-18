import type { AppResult, TerminalSummary } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TERMINALS_WATCH_MS, createTerminalsWatch } from '../src/main/terminals-watch';

function terminal(state: TerminalSummary['state']): TerminalSummary {
  return {
    id: 't1',
    kind: 'shell',
    title: 'Claude 1',
    projectId: 'p1',
    projectName: 'loja',
    state,
    provider: 'claude',
    origin: 'new',
    startedAt: '2026-11-17T10:00:00.000Z',
  } as TerminalSummary;
}

function setup(responses: AppResult<TerminalSummary[]>[]) {
  let index = 0;
  const list = vi.fn(() => Promise.resolve(responses[Math.min(index++, responses.length - 1)]!));
  const publishChanged = vi.fn();
  const watch = createTerminalsWatch({ list, publishChanged });
  return { watch, list, publishChanged };
}

const ok = (data: TerminalSummary[]): AppResult<TerminalSummary[]> => ({ ok: true, data });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createTerminalsWatch', () => {
  it('ativo, a primeira leitura sinaliza (a tela relê), e depois só a mudança de estado sinaliza', async () => {
    const { watch, publishChanged } = setup([
      ok([terminal('running')]),
      ok([terminal('running')]),
      ok([terminal('waiting')]),
      ok([terminal('waiting')]),
    ]);

    watch.setActive(true);
    await vi.advanceTimersByTimeAsync(TERMINALS_WATCH_MS);
    expect(publishChanged).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TERMINALS_WATCH_MS);
    expect(publishChanged).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TERMINALS_WATCH_MS);
    expect(publishChanged).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(TERMINALS_WATCH_MS);
    expect(publishChanged).toHaveBeenCalledTimes(2);
    watch.dispose();
  });

  it('inativo, não lê', async () => {
    const { watch, list } = setup([ok([terminal('running')])]);

    await vi.advanceTimersByTimeAsync(TERMINALS_WATCH_MS * 3);
    watch.setActive(true);
    watch.setActive(false);
    await vi.advanceTimersByTimeAsync(TERMINALS_WATCH_MS * 3);

    expect(list).not.toHaveBeenCalled();
  });

  it('reativar recomeça do zero: a primeira leitura sinaliza de novo', async () => {
    const { watch, publishChanged } = setup([ok([terminal('running')])]);

    watch.setActive(true);
    await vi.advanceTimersByTimeAsync(TERMINALS_WATCH_MS);
    watch.setActive(false);
    watch.setActive(true);
    await vi.advanceTimersByTimeAsync(TERMINALS_WATCH_MS);

    expect(publishChanged).toHaveBeenCalledTimes(2);
    watch.dispose();
  });

  it('leitura com falha não publica nem lança erro', async () => {
    const { watch, publishChanged } = setup([
      { ok: false, error: { code: 'UNKNOWN', message: 'x', retryable: false } },
    ]);

    watch.setActive(true);
    await vi.advanceTimersByTimeAsync(TERMINALS_WATCH_MS * 2);

    expect(publishChanged).not.toHaveBeenCalled();
    watch.dispose();
  });
});
