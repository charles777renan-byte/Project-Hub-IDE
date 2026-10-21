import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopographicBackground } from '../../src/renderer/components/TopographicBackground';

// jsdom não tem canvas nem matchMedia. O contexto 2D é um registro de chamadas, e os quadros do
// requestAnimationFrame ficam numa fila, para cada teste avançar o tempo do jeito que quiser.

function fakeContext() {
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  };
}

let ctx: ReturnType<typeof fakeContext>;
let frames: FrameRequestCallback[];

function runFrame(at: number): void {
  const callback = frames.shift();
  if (!callback) throw new Error('nenhum quadro agendado');
  act(() => {
    callback(at);
  });
}

function stubMatchMedia(matches: boolean) {
  const listeners = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({ matches, ...listeners })),
  });
  return listeners;
}

beforeEach(() => {
  ctx = fakeContext();
  frames = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  vi.spyOn(performance, 'now').mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('TopographicBackground', () => {
  it('é um canvas decorativo, escondido de leitores de tela', () => {
    const { container } = render(<TopographicBackground />);
    expect(container.querySelector('.topo-background')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('pinta o fundo ao montar e agenda a animação', () => {
    render(<TopographicBackground />);
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(1);
  });

  it('limita a 30 quadros por segundo: um quadro a 10ms não pinta, um a 40ms pinta', () => {
    render(<TopographicBackground />);
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);

    runFrame(10);
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);

    runFrame(40);
    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
  });

  it('com "reduzir movimento", desenha um quadro só e não agenda animação', () => {
    stubMatchMedia(true);
    render(<TopographicBackground />);
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);
  });

  it('cancela o quadro pendente ao desmontar', () => {
    const { unmount } = render(<TopographicBackground />);
    unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it('sem contexto de canvas, não desenha e não quebra', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    expect(() => render(<TopographicBackground />)).not.toThrow();
    expect(frames).toHaveLength(0);
  });
});
