import { useEffect, useState } from 'react';

/** Papéis que fazem de um portal uma sobreposição de verdade. Dica (`tooltip`) não conta: é pequena e passageira. */
const OVERLAY_ROLES = '[role="menu"], [role="dialog"], [role="listbox"]';

/** De quanto em quanto tempo a sobreposição aberta é conferida de novo (ver `useOverlayOpen`). */
const RECHECK_MS = 300;

/**
 * Diz se o app tem uma sobreposição aberta: um `<dialog>` aberto em qualquer lugar (a paleta de comandos, as
 * confirmações), ou um portal (filho direto de `body`, fora de `#root`) que contém um menu, um diálogo ou uma lista
 * de opções.
 *
 * Serve ao navegador interno. A página dele é uma view do processo principal, desenhada por cima da janela: nada do
 * DOM consegue ficar na frente dela. Enquanto há uma sobreposição aberta, a página dá lugar a uma imagem parada.
 */
export function hasOpenOverlay(doc: Document): boolean {
  if (doc.querySelector('dialog[open]') !== null) return true;
  for (const child of doc.body.children) {
    if (child.id === 'root') continue;
    if (child.matches(OVERLAY_ROLES) || child.querySelector(OVERLAY_ROLES) !== null) return true;
  }
  return false;
}

/**
 * `hasOpenOverlay` em dia. Observa os filhos diretos de `body` (é onde os portais entram e saem) e o atributo
 * `open` dos diálogos; não observa a árvore inteira do app, que muda o tempo todo (os terminais). Um diálogo
 * desmontado ainda aberto não gera mutação observada, então, enquanto há sobreposição, o estado é conferido de novo
 * de tempos em tempos.
 */
export function useOverlayOpen(): boolean {
  const [open, setOpen] = useState(() => hasOpenOverlay(document));

  useEffect(() => {
    const check = () => setOpen(hasOpenOverlay(document));
    // Dois observadores: observar o mesmo alvo duas vezes com um só trocaria as opções da primeira pela segunda.
    const portals = new MutationObserver(check);
    portals.observe(document.body, { childList: true });
    const dialogs = new MutationObserver(check);
    dialogs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    check();
    return () => {
      portals.disconnect();
      dialogs.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setInterval(() => setOpen(hasOpenOverlay(document)), RECHECK_MS);
    return () => window.clearInterval(timer);
  }, [open]);

  return open;
}
