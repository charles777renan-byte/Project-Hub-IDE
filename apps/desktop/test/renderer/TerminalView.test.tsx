import { render } from '@testing-library/react';
import type { AppResult, ProjectHubApi, TerminalEvent } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalView, fitTerminal } from '../../src/renderer/components/terminals/TerminalView';

// O xterm precisa de um navegador de verdade. Aqui ele é trocado por um terminal falso que anota o uso.
const fake = vi.hoisted(() => ({
  writes: [] as string[],
  resets: 0,
  disposed: 0,
  typed: undefined as ((data: string) => void) | undefined,
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    open() {}
    write(data: string) {
      fake.writes.push(data);
    }
    reset() {
      fake.resets += 1;
    }
    resize(cols: number, rows: number) {
      this.cols = cols;
      this.rows = rows;
    }
    onData(listener: (data: string) => void) {
      fake.typed = listener;
      return { dispose() {} };
    }
    dispose() {
      fake.disposed += 1;
    }
  },
}));

const OK: AppResult<undefined> = { ok: true, data: undefined };
let emit: ((event: TerminalEvent) => void) | undefined;
let terminals: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  fake.writes = [];
  fake.resets = 0;
  fake.disposed = 0;
  fake.typed = undefined;
  emit = undefined;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  terminals = {
    subscribe: vi.fn(() => Promise.resolve(OK)),
    unsubscribe: vi.fn(() => Promise.resolve(OK)),
    write: vi.fn(() => Promise.resolve(OK)),
    resize: vi.fn(() => Promise.resolve(OK)),
    onEvent: vi.fn((listener: (event: TerminalEvent) => void) => {
      emit = listener;
      return () => {
        emit = undefined;
      };
    }),
  };
  window.projectHub = { terminals } as unknown as ProjectHubApi;
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'projectHub');
});

describe('TerminalView', () => {
  it('assina o terminal, mostra a saída dele e ignora a de outro', () => {
    render(<TerminalView terminalId="t1" />);

    expect(terminals['subscribe']).toHaveBeenCalledWith('t1');
    emit?.({ type: 'data', terminalId: 't1', data: 'oi' });
    emit?.({ type: 'data', terminalId: 't2', data: 'de outro' });

    expect(fake.writes).toEqual(['oi']);
  });

  it('limpa a tela no reinício e avisa o fim do processo', () => {
    render(<TerminalView terminalId="t1" />);

    emit?.({ type: 'restart', terminalId: 't1' });
    emit?.({ type: 'exit', terminalId: 't1', exitCode: 2 });

    expect(fake.resets).toBe(1);
    expect(fake.writes.join('')).toContain('código 2');
  });

  it('manda a digitação ao terminal certo', () => {
    render(<TerminalView terminalId="t1" />);

    fake.typed?.('ls\r');

    expect(terminals['write']).toHaveBeenCalledWith('t1', 'ls\r');
  });

  it('ao sair da tela solta a assinatura e descarta o terminal, sem encerrá-lo', () => {
    const view = render(<TerminalView terminalId="t1" />);

    view.unmount();

    expect(terminals['unsubscribe']).toHaveBeenCalledWith('t1');
    expect(fake.disposed).toBe(1);
    expect(emit).toBeUndefined();
  });
});

describe('fitTerminal', () => {
  function host(screenWidth: number, screenHeight: number, width: number, height: number) {
    const element = document.createElement('div');
    const screen = document.createElement('div');
    screen.className = 'xterm-screen';
    Object.defineProperty(screen, 'clientWidth', { value: screenWidth });
    Object.defineProperty(screen, 'clientHeight', { value: screenHeight });
    Object.defineProperty(element, 'clientWidth', { value: width });
    Object.defineProperty(element, 'clientHeight', { value: height });
    element.append(screen);
    return element;
  }

  it('calcula colunas e linhas pela célula medida na tela do xterm', () => {
    const term = { cols: 80, rows: 24, resize: vi.fn() };

    // Célula de 8 x 16: uma área de 800 x 320 comporta 100 x 20.
    expect(fitTerminal(term, host(640, 384, 800, 320))).toEqual({ cols: 100, rows: 20 });
    expect(term.resize).toHaveBeenCalledWith(100, 20);
  });

  it('não mexe quando o tamanho já bate, nem antes de o xterm ter medidas', () => {
    const same = { cols: 80, rows: 24, resize: vi.fn() };
    expect(fitTerminal(same, host(640, 384, 640, 384))).toBeUndefined();
    expect(same.resize).not.toHaveBeenCalled();
    expect(fitTerminal(same, host(0, 0, 640, 384))).toBeUndefined();
  });
});
