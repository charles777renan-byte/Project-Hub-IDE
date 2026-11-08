import { render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { useAreaSize } from '../../src/renderer/workspace/use-area-size';
import {
  FakeResizeObserver,
  liveResize,
  measure,
  useFakeResizeObserver,
} from './fake-resize-observer';

useFakeResizeObserver();

type Size = { width: number; height: number } | null;

function Probe({ onRender }: { onRender: (size: Size) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useAreaSize(ref);
  onRender(size);
  return <div ref={ref} data-testid="area" />;
}

describe('useAreaSize', () => {
  it('devolve null até a primeira notificação do observador', () => {
    const seen: Size[] = [];
    render(<Probe onRender={(size) => seen.push(size)} />);
    expect(seen.at(-1)).toBeNull();
    expect(liveResize().observed.size).toBe(1);
  });

  it('depois da medida devolve a largura e a altura arredondadas', () => {
    const seen: Size[] = [];
    render(<Probe onRender={(size) => seen.push(size)} />);
    measure(800.4, 499.6);
    expect(seen.at(-1)).toEqual({ width: 800, height: 500 });
  });

  it('a mesma medida de novo não renderiza de novo', () => {
    const seen: Size[] = [];
    render(<Probe onRender={(size) => seen.push(size)} />);
    measure(800, 500);
    const rendersAfterFirst = seen.length;
    measure(800.2, 499.8);
    expect(seen.length).toBe(rendersAfterFirst);
    measure(801, 500);
    expect(seen.length).toBe(rendersAfterFirst + 1);
    expect(seen.at(-1)).toEqual({ width: 801, height: 500 });
  });

  it('desconecta o observador ao desmontar', () => {
    const { unmount } = render(<Probe onRender={() => undefined} />);
    const observer = liveResize();
    unmount();
    expect(observer.disconnected).toBe(true);
    expect(FakeResizeObserver.instances.every((item) => item.disconnected)).toBe(true);
  });
});
