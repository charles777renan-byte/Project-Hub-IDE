import { useCallback, useEffect, useMemo, useState } from 'react';
import { Group, Panel, Separator, usePanelRef, type Layout } from 'react-resizable-panels';
import { useNavigate } from 'react-router';
import { PaletaComandos } from './components/PaletaComandos';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { RestoreWorkspace, TopBar } from './components/TopBar';
import { buildPaletteItems } from './palette-items';
import { AppRoutes } from './routes';
import { TOGGLE_SIDEBAR_EVENT } from './sidebar-events';
import { useSidebarData } from './use-sidebar-data';

const SIDE_STORAGE_KEY = 'project-hub:sidebar-layout';
const SIDE_ID = 'side';
const MAIN_ID = 'main';
const DEFAULT_LAYOUT: Layout = { [SIDE_ID]: 22, [MAIN_ID]: 78 };

/** A largura guardada da barra lateral (0 = recolhida); sem `localStorage` ou com valor estranho, a padrão. */
function readSideLayout(): Layout {
  try {
    const raw = window.localStorage.getItem(SIDE_STORAGE_KEY);
    if (raw === null) return DEFAULT_LAYOUT;
    const parsed: unknown = JSON.parse(raw);
    const side = (parsed as Record<string, unknown> | null)?.[SIDE_ID];
    if (typeof side !== 'number' || !Number.isFinite(side) || side < 0 || side > 40) {
      return DEFAULT_LAYOUT;
    }
    return { [SIDE_ID]: side, [MAIN_ID]: 100 - side };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function saveSideLayout(layout: Layout) {
  try {
    window.localStorage.setItem(SIDE_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Sem armazenamento, a largura só vale até fechar a janela.
  }
}

/**
 * Estrutura da janela: barra superior de 36px com a marca, a aba fixa Início e as abas dos
 * workspaces; abaixo, a coluna lateral (a barra lateral, o explorador: busca, adicionar projeto, os projetos
 * com as sessões e os arquivados; redimensionável e recolhível, com a largura lembrada) e a área da página, que
 * ocupa o resto da altura e rola sozinha; e, no rodapé, a barra de status (projeto e branch da aba ativa,
 * contadores da visão geral, uso do computador e "Parar todos"). A janela não tem fundo decorativo: o fundo topográfico
 * vive só na faixa do topo do Início e nos estados vazios, nunca atrás de listas, tabelas, formulários ou terminais.
 * O roteador fica fora (HashRouter em main.tsx, MemoryRouter nos testes), então o App
 * funciona com qualquer um dos dois.
 */
export function App() {
  const [paletaAberta, setPaletaAberta] = useState(false);
  const sidebar = useSidebarData();
  const navigate = useNavigate();
  const itensPaleta = useMemo(() => buildPaletteItems(sidebar, navigate), [sidebar, navigate]);
  // A lateral recolhida (arrastada até o fim, ou guardada assim): fica escondida, e o botão da barra superior, o
  // Ctrl+B e a paleta a trazem de volta. O estado nasce da largura guardada e segue o painel (`onResize`).
  const sidePanel = usePanelRef();
  const [sideCollapsed, setSideCollapsed] = useState(() => readSideLayout()[SIDE_ID] === 0);
  const toggleSidebar = useCallback(() => {
    const panel = sidePanel.current;
    if (panel === null) return;
    if (panel.isCollapsed()) {
      panel.expand();
      return;
    }
    // Recolhendo com o foco dentro da lateral, o `inert` que vem a seguir o jogaria no body. Por isso ele vai antes
    // para o botão da barra superior (ou para o conteúdo principal, se o botão não existir).
    const ativo = document.activeElement;
    if (ativo instanceof Element && ativo.closest('.app-side') !== null) {
      const destino =
        document.querySelector<HTMLElement>('.topbar__sidebar-toggle') ??
        document.querySelector<HTMLElement>('.app-main');
      destino?.focus();
    }
    panel.collapse();
  }, [sidePanel]);

  useEffect(() => {
    window.addEventListener(TOGGLE_SIDEBAR_EVENT, toggleSidebar);
    return () => window.removeEventListener(TOGGLE_SIDEBAR_EVENT, toggleSidebar);
  }, [toggleSidebar]);

  // Ctrl+K abre a paleta em qualquer tela; quem fecha é o Escape. Com a paleta aberta, o Ctrl+K já é do cmdk
  // (sobe na lista), que o marca como tratado. Dentro do terminal ele segue para o programa: no Claude Code,
  // Ctrl+K apaga até o fim da linha, e a paleta não pode roubar essa tecla.
  useEffect(() => {
    function atalhoPaleta(event: KeyboardEvent) {
      const ctrlK =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k';
      if (!ctrlK || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('.terminal-view') !== null)
        return;
      event.preventDefault();
      setPaletaAberta(true);
    }
    window.addEventListener('keydown', atalhoPaleta);
    return () => window.removeEventListener('keydown', atalhoPaleta);
  }, []);

  // Ctrl+B esconde ou mostra a lateral. Como o Ctrl+K, dentro do terminal ele segue para o programa (no tmux e no
  // Claude Code, Ctrl+B tem função própria).
  useEffect(() => {
    function atalhoLateral(event: KeyboardEvent) {
      const ctrlB =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'b';
      if (!ctrlB || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('.terminal-view') !== null)
        return;
      event.preventDefault();
      toggleSidebar();
    }
    window.addEventListener('keydown', atalhoLateral);
    return () => window.removeEventListener('keydown', atalhoLateral);
  }, [toggleSidebar]);

  return (
    <div className="app-shell">
      <RestoreWorkspace />
      <TopBar sidebarCollapsed={sideCollapsed} onToggleSidebar={toggleSidebar} />
      <Group
        className={sideCollapsed ? 'app-body app-body--side-collapsed' : 'app-body'}
        orientation="horizontal"
        defaultLayout={readSideLayout()}
        onLayoutChanged={saveSideLayout}
      >
        <Panel
          id={SIDE_ID}
          className="app-body__panel"
          defaultSize="22"
          minSize={200}
          maxSize="40"
          collapsible
          collapsedSize={0}
          panelRef={sidePanel}
          onResize={(size) => setSideCollapsed(size.inPixels === 0)}
        >
          {/* Recolhida, a lateral sai do Tab também: `inert` tira os controles dela da ordem de foco. */}
          <div className="app-side" inert={sideCollapsed}>
            <Sidebar onSearch={() => setPaletaAberta(true)} />
          </div>
        </Panel>
        <Separator className="pane-tree__separator" aria-label="Redimensionar barra lateral" />
        <Panel id={MAIN_ID} className="app-body__panel" minSize="30">
          <main className="app-main" tabIndex={-1}>
            <div className="app-main__content">
              <AppRoutes />
            </div>
          </main>
        </Panel>
      </Group>
      <StatusBar />
      <PaletaComandos
        aberta={paletaAberta}
        aoFechar={() => setPaletaAberta(false)}
        itens={itensPaleta}
      />
    </div>
  );
}
