import { BrowserWindow, type WebContentsView } from 'electron';
import { AGENT_PAGE_SIZE, SUPPORT_WINDOW_OPTIONS } from './agent-window-options';

export { AGENT_PAGE_SIZE } from './agent-window-options';

export type SupportWindow = {
  /** Põe a view na janela de apoio, com `AGENT_PAGE_SIZE`. Cria a janela na primeira vez. */
  host(view: WebContentsView): void;
  /** Tira a view. Sem nenhuma view, a janela é destruída. */
  release(view: WebContentsView): void;
  dispose(): void;
};

/**
 * A janela onde as páginas dos agentes vivem enquanto ninguém as olha. A captura de tela só funciona numa página
 * que está sendo desenhada, e uma view solta, invisível ou em janela escondida não é (medido no Electron 44.9, no
 * Windows 11). Esta janela é mostrada sem ativar, fora de qualquer monitor: a página é desenhada e ninguém a vê.
 * Ela nunca recebe o foco e não segura o app aberto: quem a destrói é o fim da última página ou o fim do app.
 */
export function createSupportWindow(): SupportWindow {
  let win: BrowserWindow | null = null;
  const hosted = new Set<WebContentsView>();

  const live = (): BrowserWindow | null => (win !== null && !win.isDestroyed() ? win : null);

  const close = (): void => {
    const current = live();
    win = null;
    hosted.clear();
    current?.destroy();
  };

  return {
    host(view) {
      let target = live();
      if (target === null) {
        target = new BrowserWindow({ ...SUPPORT_WINDOW_OPTIONS });
        target.setMenu(null);
        target.showInactive();
        win = target;
      }
      if (!hosted.has(view)) {
        target.contentView.addChildView(view);
        hosted.add(view);
      }
      view.setBounds({ x: 0, y: 0, ...AGENT_PAGE_SIZE });
    },
    release(view) {
      if (!hosted.delete(view)) return;
      const target = live();
      if (target === null) return;
      target.contentView.removeChildView(view);
      if (hosted.size === 0) close();
    },
    dispose: close,
  };
}
