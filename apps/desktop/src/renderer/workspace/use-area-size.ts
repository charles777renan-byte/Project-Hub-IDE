import { type RefObject, useEffect, useRef, useState } from 'react';

type AreaSize = { width: number; height: number };

/**
 * Mede o elemento da área da grade. Devolve `null` até a primeira medida do `ResizeObserver` (a página não decide nada
 * antes disso) e depois a largura e a altura em px inteiros. Só atualiza o estado quando o par muda, para um arraste
 * lento da janela não renderizar à toa.
 */
export function useAreaSize(ref: RefObject<HTMLElement | null>): AreaSize | null {
  const [size, setSize] = useState<AreaSize | null>(null);
  const lastSize = useRef<AreaSize | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (entry === undefined) return;
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      // Pelo ref, e não só pelo atualizador do estado: a mesma medida nem chega a pedir outra renderização.
      const last = lastSize.current;
      if (last !== null && last.width === width && last.height === height) return;
      lastSize.current = { width, height };
      setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
