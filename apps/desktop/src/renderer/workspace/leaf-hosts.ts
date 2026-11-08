import { useCallback, useMemo, useRef, type FocusEvent } from 'react';

/**
 * Os nós do DOM do conteúdo de cada folha. O conteúdo (o painel, com o xterm e o WebGL) é renderizado num nó próprio
 * da folha, por portal, e o nó é movido para onde a folha aparece: um lugar da grade, a área do modo Abas ou o
 * estacionamento escondido. Mover o nó não recria o conteúdo, então trocar a grade pelo modo Abas, maximizar ou
 * trocar de aba não refaz o terminal nem repete a saída guardada.
 */
export type LeafHosts = {
  /** O nó da folha, criado na primeira vez. */
  hostOf(leafId: string): HTMLDivElement;
  /** Põe o nó da folha dentro do lugar `slot` (callback de `ref`; `null` não faz nada). */
  attach(leafId: string, slot: HTMLElement | null): void;
  /** Esquece os nós das folhas fora de `keep` e os tira da página. */
  prune(keep: ReadonlySet<string>): void;
  /** Para o `onFocus` de quem contém os lugares: lembra o último elemento focado dentro deles. */
  rememberFocus(event: FocusEvent<HTMLElement>): void;
};

export function useLeafHosts(): LeafHosts {
  const hosts = useRef(new Map<string, HTMLDivElement>());
  const lastFocus = useRef<HTMLElement | null>(null);

  const hostOf = useCallback((leafId: string) => {
    let host = hosts.current.get(leafId);
    if (host === undefined) {
      host = document.createElement('div');
      host.className = 'pane-tree__content';
      hosts.current.set(leafId, host);
    }
    return host;
  }, []);

  const attach = useCallback(
    (leafId: string, slot: HTMLElement | null) => {
      if (slot === null) return;
      const host = hostOf(leafId);
      if (host.parentElement === slot) return;
      slot.append(host);
      // Mover o nó tira o foco de quem estava dentro dele: volta para o mesmo elemento.
      const focused = lastFocus.current;
      const lost = document.activeElement === null || document.activeElement === document.body;
      if (lost && focused !== null && host.contains(focused))
        focused.focus({ preventScroll: true });
    },
    [hostOf],
  );

  const prune = useCallback((keep: ReadonlySet<string>) => {
    for (const [id, host] of hosts.current) {
      if (keep.has(id)) continue;
      hosts.current.delete(id);
      host.remove();
    }
  }, []);

  const rememberFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    if (event.target instanceof HTMLElement) lastFocus.current = event.target;
  }, []);

  return useMemo(
    () => ({ hostOf, attach, prune, rememberFocus }),
    [hostOf, attach, prune, rememberFocus],
  );
}
