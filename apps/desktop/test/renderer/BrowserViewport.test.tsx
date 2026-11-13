import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserViewport } from '../../src/renderer/components/right-panel/BrowserViewport';
import { browserTab, installBrowserApi } from './browser-fixtures';

let rect = { x: 1000, y: 80, width: 600, height: 780 };
let frames: FrameRequestCallback[] = [];
let observers: ResizeObserverCallback[] = [];

/** Roda os quadros pedidos até agora (o `requestAnimationFrame` falso só guarda). */
function flushFrames() {
  act(() => {
    const pending = frames;
    frames = [];
    for (const frame of pending) frame(0);
  });
}

/** Simula uma mudança de tamanho da área. */
function resize(next: Partial<typeof rect>) {
  rect = { ...rect, ...next };
  act(() => {
    for (const callback of observers) callback([], {} as ResizeObserver);
  });
}

beforeEach(() => {
  rect = { x: 1000, y: 80, width: 600, height: 780 };
  frames = [];
  observers = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames[id - 1] = () => undefined;
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        observers.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({ ...rect, top: rect.y, left: rect.x, right: 0, bottom: 0, toJSON: () => rect }) as DOMRect,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BrowserViewport', () => {
  it('ao montar, informa o retângulo medido', () => {
    const { api } = installBrowserApi();
    render(<BrowserViewport projectId="p1" tab={browserTab()} hidden={false} onRetry={vi.fn()} />);
    flushFrames();
    expect(api.setBounds).toHaveBeenLastCalledWith('p1', {
      x: 1000,
      y: 80,
      width: 600,
      height: 780,
    });
  });

  it('várias medições no mesmo quadro viram um pedido só', () => {
    const { api } = installBrowserApi();
    render(<BrowserViewport projectId="p1" tab={browserTab()} hidden={false} onRetry={vi.fn()} />);
    flushFrames();
    api.setBounds.mockClear();
    resize({ width: 500 });
    resize({ width: 480 });
    resize({ width: 470 });
    flushFrames();
    expect(api.setBounds).toHaveBeenCalledExactlyOnceWith('p1', {
      x: 1000,
      y: 80,
      width: 470,
      height: 780,
    });
  });

  it('medição igual à anterior não manda nada', () => {
    const { api } = installBrowserApi();
    render(<BrowserViewport projectId="p1" tab={browserTab()} hidden={false} onRetry={vi.fn()} />);
    flushFrames();
    api.setBounds.mockClear();
    resize({});
    flushFrames();
    expect(api.setBounds).not.toHaveBeenCalled();
  });

  it('a janela mudar de tamanho mede de novo', () => {
    const { api } = installBrowserApi();
    render(<BrowserViewport projectId="p1" tab={browserTab()} hidden={false} onRetry={vi.fn()} />);
    flushFrames();
    rect = { ...rect, x: 1200 };
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    flushFrames();
    expect(api.setBounds).toHaveBeenLastCalledWith('p1', {
      x: 1200,
      y: 80,
      width: 600,
      height: 780,
    });
  });

  it('com hidden, informa null', () => {
    const { api } = installBrowserApi();
    const { rerender } = render(
      <BrowserViewport projectId="p1" tab={browserTab()} hidden={false} onRetry={vi.fn()} />,
    );
    flushFrames();
    rerender(<BrowserViewport projectId="p1" tab={browserTab()} hidden onRetry={vi.fn()} />);
    flushFrames();
    expect(api.setBounds).toHaveBeenLastCalledWith('p1', null);
  });

  it('área sem tamanho (painel recolhido) informa null', () => {
    const { api } = installBrowserApi();
    render(<BrowserViewport projectId="p1" tab={browserTab()} hidden={false} onRetry={vi.fn()} />);
    flushFrames();
    resize({ width: 0 });
    flushFrames();
    expect(api.setBounds).toHaveBeenLastCalledWith('p1', null);
  });

  it('ao desmontar, informa null', () => {
    const { api } = installBrowserApi();
    const { unmount } = render(
      <BrowserViewport projectId="p1" tab={browserTab()} hidden={false} onRetry={vi.fn()} />,
    );
    flushFrames();
    unmount();
    expect(api.setBounds).toHaveBeenLastCalledWith('p1', null);
  });

  it('com erro, mostra a mensagem e "Tentar de novo", e esconde a página', async () => {
    const { api } = installBrowserApi();
    const onRetry = vi.fn();
    const tab = browserTab({ error: { code: 'OFFLINE', message: 'Sem conexão com a internet.' } });
    render(<BrowserViewport projectId="p1" tab={tab} hidden={false} onRetry={onRetry} />);
    flushFrames();
    expect(screen.getByRole('alert')).toHaveTextContent('Sem conexão com a internet.');
    expect(api.setBounds).toHaveBeenLastCalledWith('p1', null);
    expect(api.setBounds).not.toHaveBeenCalledWith('p1', expect.objectContaining({ width: 600 }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('aba sem endereço mostra "Digite uma URL para começar" e esconde a página', () => {
    const { api } = installBrowserApi();
    render(
      <BrowserViewport
        projectId="p1"
        tab={browserTab({ url: '', title: '' })}
        hidden={false}
        onRetry={vi.fn()}
      />,
    );
    flushFrames();
    expect(screen.getByText('Digite uma URL para começar')).toBeInTheDocument();
    expect(api.setBounds).toHaveBeenLastCalledWith('p1', null);
  });

  it('quando o erro some, volta a informar o retângulo', () => {
    const { api } = installBrowserApi();
    const failed = browserTab({
      error: { code: 'UNKNOWN', message: 'Não foi possível abrir esta página.' },
    });
    const { rerender } = render(
      <BrowserViewport projectId="p1" tab={failed} hidden={false} onRetry={vi.fn()} />,
    );
    flushFrames();
    rerender(
      <BrowserViewport projectId="p1" tab={browserTab()} hidden={false} onRetry={vi.fn()} />,
    );
    flushFrames();
    expect(api.setBounds).toHaveBeenLastCalledWith('p1', {
      x: 1000,
      y: 80,
      width: 600,
      height: 780,
    });
  });
});
