import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import type { AppResult, ProjectHubApi, TerminalSummary } from '@project-hub/contracts';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TERMINALS_POLL_MS, useTerminals } from '../../src/renderer/terminals-data';

// Leitura compartilhada dos terminais (Tarefa 7 do plano do workspace multiagente): uma leitura a cada
// 2 s para a janela inteira, enquanto houver quem a use, pausada com a janela oculta. O `window.projectHub`
// é falso, como o preload entregaria.

function terminal(id: string, extra: Partial<TerminalSummary> = {}): TerminalSummary {
  return {
    id,
    kind: 'shell',
    title: `PowerShell · Projeto ${id}`,
    projectId: 'p1',
    projectName: 'Projeto',
    state: 'running',
    provider: 'shell',
    origin: 'new',
    ...extra,
  };
}

const ok = (data: TerminalSummary[]): Promise<AppResult<TerminalSummary[]>> =>
  Promise.resolve({ ok: true, data });

const failed = (): Promise<AppResult<TerminalSummary[]>> =>
  Promise.resolve({
    ok: false,
    error: { code: 'TERMINAL_HOST_UNAVAILABLE', message: 'Falhou', retryable: false },
  });

function installApi(list: () => Promise<AppResult<TerminalSummary[]>>) {
  const spy = vi.fn(list);
  window.projectHub = { terminals: { list: spy } } as unknown as ProjectHubApi;
  return spy;
}

/** Mostra o que o hook devolve, para dois consumidores lerem a mesma coisa. */
function Probe({ name }: { name: string }) {
  const { terminals, error } = useTerminals();
  return (
    <p data-testid={name}>
      {terminals.map((item) => item.id).join(',') || 'vazio'}|{error ?? 'sem erro'}
    </p>
  );
}

/** Anda o relógio falso e deixa as respostas pendentes chegarem. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'hidden');
  Reflect.deleteProperty(window, 'projectHub');
});

describe('useTerminals', () => {
  it('lê na hora e depois a cada 2 s', async () => {
    const list = installApi(() => ok([terminal('t1')]));
    render(<Probe name="a" />);
    await advance(0);

    expect(list).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('a')).toHaveTextContent('t1|sem erro');

    await advance(TERMINALS_POLL_MS);
    expect(list).toHaveBeenCalledTimes(2);
    await advance(TERMINALS_POLL_MS);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('dois consumidores fazem uma leitura por ciclo, não duas', async () => {
    const list = installApi(() => ok([terminal('t1')]));
    render(
      <>
        <Probe name="a" />
        <Probe name="b" />
      </>,
    );
    await advance(0);
    expect(list).toHaveBeenCalledTimes(1);

    await advance(TERMINALS_POLL_MS);
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('a')).toHaveTextContent('t1|sem erro');
    expect(screen.getByTestId('b')).toHaveTextContent('t1|sem erro');
  });

  it('um consumidor que chega depois entra no ciclo que já existe', async () => {
    const list = installApi(() => ok([terminal('t1')]));
    render(<Probe name="a" />);
    await advance(0);
    render(<Probe name="b" />);
    await advance(0);

    // Já vê a lista que estava lida, e não abre uma segunda leitura nem um segundo ciclo.
    expect(screen.getByTestId('b')).toHaveTextContent('t1|sem erro');
    expect(list).toHaveBeenCalledTimes(1);
    await advance(TERMINALS_POLL_MS);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('o ciclo continua enquanto sobrar um consumidor e para quando o último sai', async () => {
    const list = installApi(() => ok([terminal('t1')]));
    const first = render(<Probe name="a" />);
    const second = render(<Probe name="b" />);
    await advance(0);
    expect(list).toHaveBeenCalledTimes(1);

    first.unmount();
    await advance(TERMINALS_POLL_MS);
    expect(list).toHaveBeenCalledTimes(2);

    second.unmount();
    await advance(TERMINALS_POLL_MS * 5);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('um novo primeiro consumidor reinicia o ciclo do zero, com a lista vazia', async () => {
    const list = installApi(() => ok([terminal('t1')]));
    const first = render(<Probe name="a" />);
    await advance(0);
    first.unmount();

    render(<Probe name="a" />);
    expect(screen.getByTestId('a')).toHaveTextContent('vazio|sem erro');
    await advance(0);
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('a')).toHaveTextContent('t1|sem erro');
  });

  it('funciona no StrictMode, que monta, desmonta e monta de novo', async () => {
    const list = installApi(() => ok([terminal('t1')]));
    render(
      <StrictMode>
        <Probe name="a" />
      </StrictMode>,
    );
    await advance(0);
    const afterMount = list.mock.calls.length;
    expect(screen.getByTestId('a')).toHaveTextContent('t1|sem erro');

    await advance(TERMINALS_POLL_MS);
    expect(list).toHaveBeenCalledTimes(afterMount + 1);
  });

  it('erro da API vira error e mantém a lista anterior; a próxima leitura boa limpa o erro', async () => {
    let next: () => Promise<AppResult<TerminalSummary[]>> = () => ok([terminal('t1')]);
    installApi(() => next());
    render(<Probe name="a" />);
    await advance(0);
    expect(screen.getByTestId('a')).toHaveTextContent('t1|sem erro');

    next = failed;
    await advance(TERMINALS_POLL_MS);
    expect(screen.getByTestId('a')).toHaveTextContent('t1|Falhou');

    next = () => ok([terminal('t2')]);
    await advance(TERMINALS_POLL_MS);
    expect(screen.getByTestId('a')).toHaveTextContent('t2|sem erro');
  });

  it('chamada que lança também vira error, sem apagar a lista', async () => {
    let next: () => Promise<AppResult<TerminalSummary[]>> = () => ok([terminal('t1')]);
    installApi(() => next());
    render(<Probe name="a" />);
    await advance(0);

    next = () => Promise.reject(new Error('quebrou'));
    await advance(TERMINALS_POLL_MS);
    const text = screen.getByTestId('a').textContent ?? '';
    expect(text.startsWith('t1|')).toBe(true);
    expect(text).not.toContain('sem erro');
  });

  it('pausa com a janela oculta e lê na hora quando ela volta', async () => {
    const list = installApi(() => ok([terminal('t1')]));
    render(<Probe name="a" />);
    await advance(0);
    expect(list).toHaveBeenCalledTimes(1);

    setHidden(true);
    await advance(TERMINALS_POLL_MS * 5);
    expect(list).toHaveBeenCalledTimes(1);

    setHidden(false);
    await advance(0);
    expect(list).toHaveBeenCalledTimes(2);
    await advance(TERMINALS_POLL_MS);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('descarta a resposta antiga que chega depois de uma mais nova', async () => {
    const replies: Array<(data: TerminalSummary[]) => void> = [];
    installApi(
      () =>
        new Promise((resolve) => {
          replies.push((data) => resolve({ ok: true, data }));
        }),
    );
    render(<Probe name="a" />);
    await advance(0);
    await advance(TERMINALS_POLL_MS);
    expect(replies).toHaveLength(2);

    await act(async () => replies[1]!([terminal('novo')]));
    expect(screen.getByTestId('a')).toHaveTextContent('novo|sem erro');
    await act(async () => replies[0]!([terminal('velho')]));
    expect(screen.getByTestId('a')).toHaveTextContent('novo|sem erro');
  });

  it('descarta a resposta que chega depois de o último consumidor sair', async () => {
    const replies: Array<(data: TerminalSummary[]) => void> = [];
    installApi(
      () =>
        new Promise((resolve) => {
          replies.push((data) => resolve({ ok: true, data }));
        }),
    );
    const first = render(<Probe name="a" />);
    await advance(0);
    first.unmount();

    render(<Probe name="a" />);
    await advance(0);
    expect(replies).toHaveLength(2);
    await act(async () => replies[0]!([terminal('fantasma')]));
    expect(screen.getByTestId('a')).toHaveTextContent('vazio|sem erro');
  });

  it('reload lê na hora e devolve uma promessa que termina com a leitura', async () => {
    let data = [terminal('t1')];
    const list = installApi(() => ok(data));
    const { result } = renderHook(() => useTerminals());
    await advance(0);
    expect(result.current.terminals.map((item) => item.id)).toEqual(['t1']);

    data = [terminal('t1'), terminal('t2')];
    await act(async () => {
      await result.current.reload();
    });
    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.terminals.map((item) => item.id)).toEqual(['t1', 't2']);
  });

  it('sem window.projectHub devolve lista vazia, sem erro, e não lança', async () => {
    const { result } = renderHook(() => useTerminals());
    await advance(TERMINALS_POLL_MS * 2);

    expect(result.current.terminals).toEqual([]);
    expect(result.current.error).toBeNull();
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.error).toBeNull();
  });

  it('com o preload sem a parte de terminais também devolve lista vazia, sem erro', async () => {
    window.projectHub = {} as unknown as ProjectHubApi;
    const { result } = renderHook(() => useTerminals());
    await advance(TERMINALS_POLL_MS);

    expect(result.current.terminals).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});
