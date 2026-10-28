import { StrictMode } from 'react';
import { render } from '@testing-library/react';
import type { AppResult, ProjectHubApi, TerminalEvent } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { E2E_HOOK_KEY } from '../../src/renderer/components/terminals/e2e-hook';
import { TerminalView, fitTerminal } from '../../src/renderer/components/terminals/TerminalView';

// O xterm precisa de um navegador de verdade. Aqui ele é trocado por um terminal falso que anota o uso.
const fake = vi.hoisted(() => ({
  writes: [] as string[],
  resets: 0,
  disposed: 0,
  typed: undefined as ((data: string) => void) | undefined,
  focuses: 0,
  blurs: 0,
  options: undefined as Record<string, unknown> | undefined,
  selection: '',
  keyHandler: undefined as ((event: KeyboardEvent) => boolean) | undefined,
  // Opções em uso do terminal (`term.options`), que o app muda depois de abrir.
  runtimeOptions: undefined as Record<string, unknown> | undefined,
  // WebGL: `failLoad` simula um ambiente sem WebGL; os demais anotam o ciclo de vida do addon.
  failLoad: false,
  addonsCreated: 0,
  addonsLoaded: 0,
  addonsDisposed: 0,
  contextLoss: undefined as (() => void) | undefined,
  /** Terminal e área em que ele foi aberto, para conferir o gancho de teste. */
  instance: undefined as object | undefined,
  openedIn: undefined as HTMLElement | undefined,
  /** Medidas da tela do xterm; 0 x 0 é o terminal aberto numa área escondida, que ainda não mediu a célula. */
  screenWidth: 640,
  screenHeight: 384,
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    constructor() {
      fake.addonsCreated += 1;
    }
    onContextLoss(listener: () => void) {
      fake.contextLoss = listener;
      return { dispose() {} };
    }
    dispose() {
      fake.addonsDisposed += 1;
    }
  },
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    constructor(options: Record<string, unknown>) {
      fake.options = options;
      fake.runtimeOptions = this.options;
      fake.instance = this;
    }
    open(host: HTMLElement) {
      fake.openedIn = host;
      // A tela do xterm, com as medidas de uma célula de 8 x 16 (640 x 384 para 80 x 24).
      const screen = document.createElement('div');
      screen.className = 'xterm-screen';
      Object.defineProperty(screen, 'clientWidth', { get: () => fake.screenWidth });
      Object.defineProperty(screen, 'clientHeight', { get: () => fake.screenHeight });
      host.append(screen);
    }
    loadAddon() {
      if (fake.failLoad) throw new Error('WebGL indisponível');
      fake.addonsLoaded += 1;
    }
    focus() {
      fake.focuses += 1;
    }
    blur() {
      fake.blurs += 1;
    }
    getSelection() {
      return fake.selection;
    }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      fake.keyHandler = handler;
    }
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
  fake.focuses = 0;
  fake.blurs = 0;
  fake.options = undefined;
  fake.selection = '';
  fake.keyHandler = undefined;
  fake.runtimeOptions = undefined;
  fake.failLoad = false;
  fake.addonsCreated = 0;
  fake.addonsLoaded = 0;
  fake.addonsDisposed = 0;
  fake.contextLoss = undefined;
  fake.instance = undefined;
  fake.openedIn = undefined;
  fake.screenWidth = 640;
  fake.screenHeight = 384;
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
  Reflect.deleteProperty(window, E2E_HOOK_KEY);
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

  /** A área mede 800 x 320: com a célula de 8 x 16 do terminal falso, cabem 100 x 20. */
  function sizeHost() {
    const host = fake.openedIn as HTMLElement;
    Object.defineProperty(host, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(host, 'clientHeight', { value: 320, configurable: true });
  }

  it('o ajuste que chega depois de a montagem ser desfeita não manda tamanho ao processo', async () => {
    let subscribed: (result: AppResult<undefined>) => void = () => {};
    terminals['subscribe']?.mockReturnValue(new Promise((resolve) => (subscribed = resolve)));
    const view = render(<TerminalView terminalId="t1" />);
    sizeHost();

    view.unmount();
    subscribed(OK);
    await Promise.resolve();
    await Promise.resolve();

    expect(terminals['resize']).not.toHaveBeenCalled();
  });

  it('com a montagem dupla do StrictMode, só a montagem viva manda o tamanho', async () => {
    const view = render(
      <StrictMode>
        <TerminalView terminalId="t1" />
      </StrictMode>,
    );
    sizeHost();

    await Promise.resolve();
    await Promise.resolve();

    // Montou, desfez e montou de novo: dois terminais criados, um descartado, e um único aviso de tamanho.
    expect(fake.disposed).toBe(1);
    expect(terminals['resize']).toHaveBeenCalledTimes(1);
    expect(terminals['resize']).toHaveBeenCalledWith('t1', 100, 20);
    view.unmount();
  });
});

describe('TerminalView: aberto numa área escondida', () => {
  function sizeHost() {
    const host = fake.openedIn as HTMLElement;
    Object.defineProperty(host, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(host, 'clientHeight', { value: 320, configurable: true });
  }

  /** ResizeObserver que guarda o que observa e deixa o teste disparar o aviso. */
  function captureObservers() {
    const observed: Element[] = [];
    let notify: () => void = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe(target: Element) {
          observed.push(target);
        }
        disconnect() {}
      },
    );
    return { observed, fire: () => notify() };
  }

  /** requestAnimationFrame manual: os quadros só rodam quando o teste manda. */
  function captureFrames() {
    const frames = new Map<number, () => void>();
    let next = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      frames.set(next, callback);
      return next++;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    return {
      pending: () => frames.size,
      run: () => {
        const due = [...frames.values()];
        frames.clear();
        due.forEach((callback) => callback());
      },
    };
  }

  it('observa também a tela do xterm, para ajustar quando ele mede a célula depois de a área aparecer', async () => {
    const { observed, fire } = captureObservers();
    captureFrames();
    fake.screenWidth = 0;
    fake.screenHeight = 0;
    const view = render(<TerminalView terminalId="t1" />);
    sizeHost();
    expect(observed).toContain(fake.openedIn);
    expect(observed).toContain(fake.openedIn?.querySelector('.xterm-screen'));

    // A área aparece, mas a célula ainda não foi medida: nada de tamanho ao processo.
    fire();
    await Promise.resolve();
    await Promise.resolve();
    expect(terminals['resize']).not.toHaveBeenCalled();

    // O xterm mede (a tela passa a medir 640 x 384) e o observador da tela avisa: ajusta uma vez, no tamanho real.
    fake.screenWidth = 640;
    fake.screenHeight = 384;
    fire();
    expect(terminals['resize']).toHaveBeenCalledTimes(1);
    expect(terminals['resize']).toHaveBeenCalledWith('t1', 100, 20);
    expect((fake.instance as { cols: number }).cols).toBe(100);
    view.unmount();
  });

  it('sem aviso do observador, tenta de novo a cada quadro até o xterm medir, e para quando ajusta', async () => {
    captureObservers();
    const frames = captureFrames();
    fake.screenWidth = 0;
    fake.screenHeight = 0;
    const view = render(<TerminalView terminalId="t1" />);
    sizeHost();

    await Promise.resolve();
    await Promise.resolve();
    expect(terminals['resize']).not.toHaveBeenCalled();
    expect(frames.pending()).toBe(1);

    frames.run();
    expect(terminals['resize']).not.toHaveBeenCalled();
    expect(frames.pending()).toBe(1);

    fake.screenWidth = 640;
    fake.screenHeight = 384;
    frames.run();
    expect(terminals['resize']).toHaveBeenCalledTimes(1);
    expect(terminals['resize']).toHaveBeenCalledWith('t1', 100, 20);
    expect(frames.pending()).toBe(0);
    view.unmount();
  });

  it('com a área ainda escondida (menor que o mínimo), não manda tamanho nem fica tentando', async () => {
    captureObservers();
    const frames = captureFrames();
    fake.screenWidth = 0;
    fake.screenHeight = 0;
    const view = render(<TerminalView terminalId="t1" />);
    const host = fake.openedIn as HTMLElement;
    Object.defineProperty(host, 'clientWidth', { value: 0, configurable: true });
    Object.defineProperty(host, 'clientHeight', { value: 0, configurable: true });

    await Promise.resolve();
    await Promise.resolve();

    expect(terminals['resize']).not.toHaveBeenCalled();
    expect(frames.pending()).toBe(0);
    view.unmount();
  });

  it('desiste depois de 30 tentativas', async () => {
    captureObservers();
    const frames = captureFrames();
    fake.screenWidth = 0;
    fake.screenHeight = 0;
    const view = render(<TerminalView terminalId="t1" />);
    sizeHost();
    await Promise.resolve();
    await Promise.resolve();

    for (let attempt = 0; attempt < 40; attempt += 1) frames.run();

    expect(frames.pending()).toBe(0);
    expect(terminals['resize']).not.toHaveBeenCalled();
    view.unmount();
  });

  it('desmontar cancela o quadro pendente', async () => {
    captureObservers();
    const frames = captureFrames();
    fake.screenWidth = 0;
    fake.screenHeight = 0;
    const view = render(<TerminalView terminalId="t1" />);
    sizeHost();
    await Promise.resolve();
    await Promise.resolve();
    expect(frames.pending()).toBe(1);

    view.unmount();

    expect(frames.pending()).toBe(0);
  });
});

describe('TerminalView: renderizador WebGL', () => {
  it('liga o WebGL ao abrir, dá 1px de espaço à célula e descarta o addon uma única vez ao desmontar', () => {
    const view = render(<TerminalView terminalId="t1" />);

    expect(fake.addonsLoaded).toBe(1);
    expect(fake.runtimeOptions?.['letterSpacing']).toBe(1);

    view.unmount();

    expect(fake.addonsDisposed).toBe(1);
    expect(fake.disposed).toBe(1);
  });

  it('segue com o renderizador do DOM, sem erro, quando o WebGL não carrega', () => {
    fake.failLoad = true;

    const view = render(<TerminalView terminalId="t1" />);
    emit?.({ type: 'data', terminalId: 't1', data: 'oi' });
    view.unmount();

    // O terminal funciona (a saída entra, o descarte acontece) e o addon que não ativou é descartado.
    expect(fake.writes).toEqual(['oi']);
    expect(fake.addonsLoaded).toBe(0);
    expect(fake.addonsDisposed).toBe(1);
    expect(fake.runtimeOptions?.['letterSpacing']).toBeUndefined();
    expect(fake.disposed).toBe(1);
  });

  it('ao perder o contexto, descarta o addon, devolve o espaço do DOM e não descarta de novo ao desmontar', () => {
    const view = render(<TerminalView terminalId="t1" />);

    fake.contextLoss?.();

    expect(fake.addonsDisposed).toBe(1);
    expect(fake.runtimeOptions?.['letterSpacing']).toBe(0);
    emit?.({ type: 'data', terminalId: 't1', data: 'ainda escreve' });
    expect(fake.writes).toEqual(['ainda escreve']);

    view.unmount();

    expect(fake.addonsDisposed).toBe(1);
  });

  it('ao perder o contexto e voltar ao DOM, ajusta as colunas de novo e avisa o processo; depois de desmontar, não', () => {
    const view = render(<TerminalView terminalId="t1" />);
    const host = fake.openedIn as HTMLElement;
    // A área mede 800 x 320: com a célula de 8 x 16, cabem 100 x 20.
    Object.defineProperty(host, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(host, 'clientHeight', { value: 320, configurable: true });

    fake.contextLoss?.();

    expect(terminals['resize']).toHaveBeenCalledWith('t1', 100, 20);

    terminals['resize']?.mockClear();
    view.unmount();
    fake.contextLoss?.();

    expect(terminals['resize']).not.toHaveBeenCalled();
  });

  it('um addon por terminal: cada montagem cria e descarta o seu', () => {
    const first = render(<TerminalView terminalId="t1" />);
    const second = render(<TerminalView terminalId="t2" />);

    expect(fake.addonsCreated).toBe(2);
    first.unmount();
    second.unmount();
    expect(fake.addonsDisposed).toBe(2);
  });
});

describe('TerminalView: gancho de leitura só dos testes', () => {
  it('sem o gancho (o app de verdade), nada é guardado nem criado no window', () => {
    const view = render(<TerminalView terminalId="t1" />);

    expect(Reflect.has(window, E2E_HOOK_KEY)).toBe(false);
    view.unmount();
    expect(Reflect.has(window, E2E_HOOK_KEY)).toBe(false);
  });

  it('com o gancho, guarda o terminal pela área onde abriu e o tira ao desmontar', () => {
    const terminals = new Map<HTMLElement, unknown>();
    Object.assign(window, { [E2E_HOOK_KEY]: { terminals } });

    const view = render(<TerminalView terminalId="t1" />);

    expect(terminals.size).toBe(1);
    expect(fake.openedIn).toBeDefined();
    expect(terminals.get(fake.openedIn as HTMLElement)).toBe(fake.instance);
    view.unmount();
    expect(terminals.size).toBe(0);
  });
});

describe('TerminalView interativo', () => {
  it('foca o terminal quando active vira true e ao montar já ativo, não enquanto segue falso', () => {
    const view = render(<TerminalView terminalId="t1" active={false} />);
    expect(fake.focuses).toBe(0);

    view.rerender(<TerminalView terminalId="t1" active />);
    expect(fake.focuses).toBe(1);

    view.unmount();
    render(<TerminalView terminalId="t1" active />);
    expect(fake.focuses).toBe(2);
  });

  it('guarda 5000 linhas de histórico e mantém a fonte de 13px', () => {
    render(<TerminalView terminalId="t1" />);

    expect(fake.options?.['scrollback']).toBe(5000);
    expect(fake.options?.['fontSize']).toBe(13);
    expect(String(fake.options?.['fontFamily'])).toContain('JetBrains Mono');
  });

  describe('teclado e cópia', () => {
    let writeText: ReturnType<typeof vi.fn>;
    const key = (init: KeyboardEventInit, type = 'keydown') => new KeyboardEvent(type, init);

    beforeEach(() => {
      writeText = vi.fn(() => Promise.resolve());
      vi.stubGlobal('navigator', { clipboard: { writeText } });
    });

    it('Ctrl+C com seleção copia e não deixa a tecla ir ao programa', () => {
      render(<TerminalView terminalId="t1" />);
      fake.selection = 'texto';

      expect(fake.keyHandler?.(key({ key: 'c', ctrlKey: true }))).toBe(false);
      expect(writeText).toHaveBeenCalledWith('texto');
    });

    it('Ctrl+C sem seleção segue ao programa e não copia', () => {
      render(<TerminalView terminalId="t1" />);

      expect(fake.keyHandler?.(key({ key: 'c', ctrlKey: true }))).toBe(true);
      expect(writeText).not.toHaveBeenCalled();
    });

    it('Ctrl+Shift+C copia a seleção e consome a tecla; sem seleção não copia nada', () => {
      render(<TerminalView terminalId="t1" />);
      fake.selection = 'abc';
      expect(fake.keyHandler?.(key({ key: 'C', ctrlKey: true, shiftKey: true }))).toBe(false);
      expect(writeText).toHaveBeenCalledWith('abc');

      writeText.mockClear();
      fake.selection = '';
      expect(fake.keyHandler?.(key({ key: 'C', ctrlKey: true, shiftKey: true }))).toBe(false);
      expect(writeText).not.toHaveBeenCalled();
    });

    it('Ctrl+Shift+Tab tira o foco do terminal para o painel, sem mandar nada ao programa', () => {
      const pane = document.createElement('section');
      pane.className = 'pane';
      pane.tabIndex = -1;
      document.body.append(pane);
      render(<TerminalView terminalId="t1" />, {
        container: pane.appendChild(document.createElement('div')),
      });
      const event = key({ key: 'Tab', ctrlKey: true, shiftKey: true, cancelable: true });

      expect(fake.keyHandler?.(event)).toBe(false);

      expect(fake.blurs).toBe(1);
      expect(event.defaultPrevented).toBe(true);
      expect(terminals['write']).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(pane);
      pane.remove();
    });

    it('Tab e Shift+Tab sozinhos seguem ao programa', () => {
      render(<TerminalView terminalId="t1" />);

      expect(fake.keyHandler?.(key({ key: 'Tab' }))).toBe(true);
      expect(fake.keyHandler?.(key({ key: 'Tab', shiftKey: true }))).toBe(true);
      expect(fake.blurs).toBe(0);
    });

    it('só age no keydown e deixa Ctrl+V para o evento de colar do navegador', () => {
      render(<TerminalView terminalId="t1" />);
      fake.selection = 'texto';

      expect(fake.keyHandler?.(key({ key: 'c', ctrlKey: true }, 'keyup'))).toBe(true);
      expect(fake.keyHandler?.(key({ key: 'v', ctrlKey: true }))).toBe(true);
      expect(writeText).not.toHaveBeenCalled();
    });

    it('se a área de transferência rejeita, copia por execCommand com um textarea que some depois', async () => {
      writeText.mockImplementation(() => Promise.reject(new Error('negado')));
      const execCommand = vi.fn(() => {
        // O textarea precisa estar no documento e com o texto, ou o execCommand não copia nada.
        const area = document.querySelector('textarea');
        expect(area?.value).toBe('texto');
        return true;
      });
      Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
      render(<TerminalView terminalId="t1" />);
      fake.selection = 'texto';

      expect(fake.keyHandler?.(key({ key: 'c', ctrlKey: true }))).toBe(false);
      await vi.waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
      await vi.waitFor(() => expect(document.querySelector('textarea')).toBeNull());
      Reflect.deleteProperty(document, 'execCommand');
    });

    it('sem navigator.clipboard usa o execCommand e nunca lança', () => {
      vi.stubGlobal('navigator', {});
      const execCommand = vi.fn(() => {
        throw new Error('falhou');
      });
      Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
      render(<TerminalView terminalId="t1" />);
      fake.selection = 'texto';

      expect(() => fake.keyHandler?.(key({ key: 'c', ctrlKey: true }))).not.toThrow();
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(document.querySelector('textarea')).toBeNull();
      Reflect.deleteProperty(document, 'execCommand');
    });
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

  it('não redimensiona enquanto a área mede menos de 48px de largura ou 24px de altura', () => {
    const term = { cols: 80, rows: 24, resize: vi.fn() };

    expect(fitTerminal(term, host(640, 384, 40, 320))).toBeUndefined();
    expect(fitTerminal(term, host(640, 384, 800, 20))).toBeUndefined();
    expect(fitTerminal(term, host(640, 384, 0, 0))).toBeUndefined();
    expect(term.resize).not.toHaveBeenCalled();
    expect(fitTerminal(term, host(640, 384, 48, 24))).toEqual({ cols: 6, rows: 1 });
  });
});
