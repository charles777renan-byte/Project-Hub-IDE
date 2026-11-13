import { useEffect, useRef, useState } from 'react';
import { useOverlayOpen } from '../../overlay-guard';
import { TOGGLE_RIGHT_EXPANDED_EVENT, TOGGLE_RIGHT_PANEL_EVENT } from '../../right-panel-events';
import { useBrowser } from '../../use-browser';
import { BrowserPageTabs } from './BrowserPageTabs';
import { BrowserToolbar } from './BrowserToolbar';
import { BrowserViewport } from './BrowserViewport';

function toggleExpanded() {
  window.dispatchEvent(new Event(TOGGLE_RIGHT_EXPANDED_EVENT));
}

/**
 * A aba Navegador do painel direito: o navegador interno do projeto. Cada projeto tem as suas abas e a sua sessão
 * (cookies e logins não passam de um projeto para outro). Este componente só mostra o que o processo principal
 * publica e manda pedidos: quem carrega as páginas e decide o que pode abrir é o processo principal.
 *
 * Com o foco dentro de uma página, as teclas não chegam ao app. Os atalhos que importam voltam por
 * `browser.onShortcut`: Ctrl+L foca o endereço, F6 foca a barra e Ctrl+Alt+B recolhe o painel.
 *
 * A página é desenhada por cima da janela, e nada do app fica na frente dela. Enquanto há um menu ou diálogo do app
 * aberto (o menu Mais ações daqui, a paleta de comandos, uma confirmação), a página vira imagem parada.
 */
export function NavigatorTab({
  projectId,
  expanded = false,
}: {
  projectId: string;
  /** O painel direito ocupa toda a largura do corpo da janela. Quem guarda esse estado é o `App`. */
  expanded?: boolean;
}) {
  const browser = useBrowser(projectId);
  const overlayOpen = useOverlayOpen();
  const [menuOpen, setMenuOpen] = useState(false);
  const addressRef = useRef<HTMLInputElement>(null);
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(
    () =>
      window.projectHub.browser.onShortcut((event) => {
        if (event.projectId !== projectId) return;
        if (event.action === 'focus-address') addressRef.current?.focus();
        else if (event.action === 'focus-toolbar') firstButtonRef.current?.focus();
        else window.dispatchEvent(new Event(TOGGLE_RIGHT_PANEL_EVENT));
      }),
    [projectId],
  );

  // Sair da aba (outra aba do painel, outro projeto) com o painel expandido devolve o tamanho: o botão de restaurar
  // mora aqui, e sem ele a pessoa ficaria com as outras abas do painel na largura toda.
  const expandedRef = useRef(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);
  useEffect(
    () => () => {
      if (expandedRef.current) toggleExpanded();
    },
    [],
  );

  if (browser.failure !== null) {
    return (
      <div className="browser">
        <p className="browser__failure" role="alert">
          {browser.failure}
        </p>
      </div>
    );
  }
  const { state, activeTab } = browser;
  if (state === null || activeTab === null) {
    return (
      <div className="browser">
        <p className="browser__loading">Carregando…</p>
      </div>
    );
  }

  return (
    <div className="browser">
      <BrowserPageTabs
        tabs={state.tabs}
        activeTabId={state.activeTabId}
        onSelect={browser.selectTab}
        onClose={browser.closeTab}
        onNew={browser.openTab}
      />
      <BrowserToolbar
        tab={activeTab}
        notice={browser.notice}
        expanded={expanded}
        onNavigate={browser.navigate}
        onBack={browser.back}
        onForward={browser.forward}
        onReload={browser.reload}
        onStop={browser.stop}
        onToggleExpand={toggleExpanded}
        onOpenExternal={browser.openExternal}
        onOpenDevtools={browser.openDevtools}
        onClearData={browser.clearData}
        onMenuOpenChange={setMenuOpen}
        addressRef={addressRef}
        firstButtonRef={firstButtonRef}
      />
      <BrowserViewport
        projectId={projectId}
        tab={activeTab}
        hidden={false}
        frozen={overlayOpen || menuOpen}
        onRetry={browser.reload}
      />
    </div>
  );
}
