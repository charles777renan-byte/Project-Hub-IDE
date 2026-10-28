import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { LayoutNode } from '@project-hub/contracts';
import { leavesOf } from './layout-model';

/**
 * Entrada e saída dos painéis de terminal (a animação mora em styles/motion.css). A folha nova ganha
 * `data-motion="entering"` e cresce enquanto aparece; a que fecha ganha `data-motion="leaving"` e encolhe enquanto
 * some, e só depois sai do layout. As duas só mexem em opacidade e transform: o xterm mede a área do painel, e um
 * transform não muda essa medida.
 */
export type PaneMotion = {
  entering: ReadonlySet<string>;
  leaving: ReadonlySet<string>;
  /** A entrada da folha terminou: a marca sai, senão a entrada tocaria de novo a cada volta à visão Terminais. */
  onEntered(leafId: string): void;
  /** A animação de saída da folha terminou: agora ela pode sair do layout. */
  onLeft(leafId: string): void;
};

/** Nomes dos keyframes de entrada e de saída, que o fim da animação confere. */
export const PANE_IN = 'pane-in';
export const PANE_OUT = 'pane-out';

/**
 * Prazo para a saída terminar, folgado sobre `--dur` (180 ms em tokens.css): com a janela em segundo plano o
 * `animationend` pode não chegar, e o painel fecha mesmo assim.
 */
export const LEAVE_FALLBACK_MS = 400;

const EMPTY: ReadonlySet<string> = new Set();

/** Sem `matchMedia` (jsdom) não há como animar: o painel fecha na hora, como com "reduzir movimento". */
export function paneMotionOff(): boolean {
  return (
    typeof window.matchMedia !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * As folhas que acabaram de aparecer no layout, até a entrada delas terminar (`settle`). `undefined` é o workspace
 * ainda abrindo: as folhas que ele traz ao abrir não animam (a página já aparece inteira). Roda antes da pintura,
 * então a folha nova já nasce marcada. A marca precisa sair no fim: a visão Terminais esconde o painel com
 * `display: none`, e o navegador recomeça a animação de quem continua marcado quando ele volta.
 */
export function useEnteringLeaves(layout: LayoutNode | null | undefined): {
  entering: ReadonlySet<string>;
  settle(leafId: string): void;
} {
  const known = useRef<ReadonlySet<string> | null>(null);
  const [entering, setEntering] = useState(EMPTY);
  // As ids, e não o objeto: mover uma divisória troca o layout sem mudar as folhas.
  const ids =
    layout === undefined
      ? null
      : leavesOf(layout)
          .map((leaf) => leaf.id)
          .join(' ');

  useLayoutEffect(() => {
    if (ids === null) {
      known.current = null;
      setEntering(EMPTY);
      return;
    }
    const current = new Set(ids === '' ? [] : ids.split(' '));
    const previous = known.current;
    known.current = current;
    if (previous === null) return;
    const fresh = [...current].filter((id) => !previous.has(id));
    setEntering(fresh.length === 0 ? EMPTY : new Set(fresh));
  }, [ids]);

  const settle = useCallback((leafId: string) => {
    setEntering((previous) => {
      if (!previous.has(leafId)) return previous;
      const next = new Set(previous);
      next.delete(leafId);
      return next.size === 0 ? EMPTY : next;
    });
  }, []);

  return { entering, settle };
}
