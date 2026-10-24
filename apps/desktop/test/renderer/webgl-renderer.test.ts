import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachWebglRenderer } from '../../src/renderer/components/terminals/webgl-renderer';

// O addon WebGL precisa de GPU. Aqui ele é falso e anota a ordem das chamadas; os canvases são falsos também,
// com o `getContext` de cada um no lugar do que o jsdom dá (nada).
const fake = vi.hoisted(() => ({
  log: [] as string[],
  contextLoss: undefined as (() => void) | undefined,
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    onContextLoss(listener: () => void) {
      fake.contextLoss = listener;
      return { dispose() {} };
    }
    dispose() {
      fake.log.push('dispose');
    }
  },
}));

type ContextKind = 'webgl' | '2d';

/** Canvas com contexto `kind`: o `getContext('webgl2')` só devolve um contexto no WebGL, e como o do navegador. */
function canvas(name: string, kind: ContextKind, loseContext?: () => void): HTMLCanvasElement {
  const element = document.createElement('canvas');
  const gl = {
    getExtension: (extension: string) =>
      extension === 'WEBGL_lose_context'
        ? {
            loseContext:
              loseContext ??
              (() => {
                fake.log.push(`loseContext:${name}`);
              }),
          }
        : null,
  };
  Object.defineProperty(element, 'getContext', {
    value: (type: string) => (type === 'webgl2' && kind === 'webgl' ? gl : null),
  });
  return element;
}

type Setup = {
  /** Cria os canvases do addon quando o terminal o carrega, e pode falhar depois (ou antes) de criá-los. */
  onLoad?: 'ok' | 'throw-before-canvas' | 'throw-after-canvas';
  withElement?: boolean;
  loseContext?: () => void;
};

function setup({ onLoad = 'ok', withElement = true, loseContext }: Setup = {}) {
  const element = document.createElement('div');
  const screen = document.createElement('div');
  screen.className = 'xterm-screen';
  element.append(screen);
  // Um canvas que já estava lá antes do addon, com contexto WebGL: não pode ser tocado.
  screen.append(canvas('previo', 'webgl'));
  const term = {
    element: withElement ? element : undefined,
    options: { letterSpacing: 0 },
    loadAddon: vi.fn(() => {
      if (onLoad === 'throw-before-canvas') throw new Error('WebGL2 not supported');
      screen.append(canvas('webgl', 'webgl', loseContext), canvas('links', '2d'));
      if (onLoad === 'throw-after-canvas') throw new Error('falhou ao iniciar o estado');
    }),
  };
  return { term: term as unknown as Parameters<typeof attachWebglRenderer>[0], raw: term, screen };
}

beforeEach(() => {
  fake.log = [];
  fake.contextLoss = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('attachWebglRenderer', () => {
  it('liga o addon e dá 1px de espaço à célula', () => {
    const { term, raw } = setup();

    attachWebglRenderer(term);

    expect(raw.loadAddon).toHaveBeenCalledTimes(1);
    expect(raw.options.letterSpacing).toBe(1);
  });

  it('ao soltar, descarta o addon e só depois solta o contexto do canvas dele, uma única vez', () => {
    const { term, raw } = setup();
    const release = attachWebglRenderer(term);

    release();

    // Perder o contexto antes do dispose faria o addon agendar o aviso de contexto perdido.
    expect(fake.log).toEqual(['dispose', 'loseContext:webgl']);
    expect(raw.options.letterSpacing).toBe(0);

    release();
    release();

    expect(fake.log).toEqual(['dispose', 'loseContext:webgl']);
  });

  it('não toca no canvas que já estava no terminal nem no da camada de links (2D)', () => {
    const { term } = setup();

    attachWebglRenderer(term)();

    expect(fake.log).not.toContain('loseContext:previo');
    expect(fake.log).not.toContain('loseContext:links');
  });

  it('se o carregamento falha antes de criar canvas, descarta o addon e não solta contexto nenhum', () => {
    const { term, raw } = setup({ onLoad: 'throw-before-canvas' });

    const release = attachWebglRenderer(term);

    expect(fake.log).toEqual(['dispose']);
    expect(raw.options.letterSpacing).toBe(0);
    release();
    expect(fake.log).toEqual(['dispose']);
  });

  it('se o carregamento falha depois de criar o canvas, solta o contexto dele', () => {
    const { term } = setup({ onLoad: 'throw-after-canvas' });

    attachWebglRenderer(term);

    expect(fake.log).toEqual(['dispose', 'loseContext:webgl']);
  });

  it('tolera o terminal sem elemento: descarta o addon e não solta nada', () => {
    const { term } = setup({ withElement: false });

    const release = attachWebglRenderer(term);
    expect(() => release()).not.toThrow();

    expect(fake.log).toEqual(['dispose']);
  });

  it('um contexto que não deixa ser solto (já perdido, sem extensão) não faz o soltar lançar', () => {
    const { term } = setup({
      loseContext: () => {
        throw new Error('contexto já perdido');
      },
    });
    const release = attachWebglRenderer(term);

    expect(() => release()).not.toThrow();
    expect(fake.log).toEqual(['dispose']);
  });

  it('ao perder o contexto, volta ao DOM: descarta, solta, devolve o espaço e chama onFallback uma vez', () => {
    const { term, raw } = setup();
    const onFallback = vi.fn(() => {
      // Na hora do aviso o terminal já está de volta ao DOM, com o espaço do DOM.
      expect(fake.log).toEqual(['dispose', 'loseContext:webgl']);
      expect(raw.options.letterSpacing).toBe(0);
    });
    const release = attachWebglRenderer(term, onFallback);

    fake.contextLoss?.();

    expect(onFallback).toHaveBeenCalledTimes(1);
    release();
    fake.contextLoss?.();
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(fake.log).toEqual(['dispose', 'loseContext:webgl']);
  });

  it('soltar por conta própria não chama onFallback, e um aviso de perda atrasado depois disso não faz nada', () => {
    const { term } = setup();
    const onFallback = vi.fn();
    const release = attachWebglRenderer(term, onFallback);

    release();
    fake.contextLoss?.();

    expect(onFallback).not.toHaveBeenCalled();
    expect(fake.log).toEqual(['dispose', 'loseContext:webgl']);
  });
});
