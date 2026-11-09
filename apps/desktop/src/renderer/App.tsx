import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Group,
  Panel,
  Separator,
  usePanelRef,
  type Layout,
  type PanelImperativeHandle,
} from 'react-resizable-panels';
import { useMatch, useNavigate } from 'react-router';
import { PaletaComandos } from './components/PaletaComandos';
import { RightPanel } from './components/right-panel/RightPanel';
import { Sidebar } from './components/Sidebar';
import { SidebarRail } from './components/SidebarRail';
import { StatusBar } from './components/StatusBar';
import { RestoreWorkspace, TopBar } from './components/TopBar';
import { listenForSaveAllRequests } from './open-files';
import { buildPaletteItems } from './palette-items';
import { TOGGLE_RIGHT_PANEL_EVENT } from './right-panel-events';
import { AppRoutes, ROUTE_PATHS } from './routes';
import { TOGGLE_SIDEBAR_EVENT } from './sidebar-events';
import { useSidebarData } from './use-sidebar-data';

const LAYOUT_STORAGE_KEY = 'project-hub:app-layout';
/** A chave de antes do painel direito: só guardava a largura da lateral. Ainda é lida, se a nova não existir. */
const OLD_SIDE_STORAGE_KEY = 'project-hub:sidebar-layout';
const SIDE_ID = 'side';
const MAIN_ID = 'main';
const RIGHT_ID = 'right';
/** A lateral em pixels: 264 de partida, de 220 a 360 ao arrastar, e o trilho de 48 quando recolhida. */
const DEFAULT_SIDE_PX = 264;
const MIN_SIDE_PX = 220;
const MAX_SIDE_PX = 360;
const RAIL_PX = 48;
const DEFAULT_RIGHT = 24;
/** Larguras máximas das colunas, em %, e o mínimo que sobra para a página (o `minSize` do painel central). */
const MAX_SIDE = 60;
const MAX_RIGHT = 45;
const MIN_MAIN = 30;
/** Folga para o ruído de ponto flutuante das larguras que a biblioteca devolve. */
const TOLERANCE = 0.01;

/** O layout dos três painéis, em %; a página fica com o que as colunas deixam. */
function layoutOf(side: number, right: number): Layout {
  return { [SIDE_ID]: side, [MAIN_ID]: 100 - side - right, [RIGHT_ID]: right };
}

/** Uma largura em % de 0 (recolhida) até `max`; qualquer outra coisa não é largura. */
function percentOf(value: unknown, max: number): number | null {
  const ok = typeof value === 'number' && Number.isFinite(value) && value >= 0;
  return ok && value <= max + TOLERANCE ? value : null;
}

function readStored(key: string): Record<string, unknown> | null {
  const raw = window.localStorage.getItem(key);
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

/**
 * As larguras guardadas das colunas, em % (0 = recolhida); sem nada guardado, ou com valor estranho, `undefined`: aí
 * cada painel abre na própria largura padrão (a lateral com 264px). A chave nova (`side` e `right`) vale mais; sem
 * ela, a antiga dá a largura da lateral e o painel direito abre na padrão. A lateral guardada como 0 abre no trilho:
 * a biblioteca encaixa no `collapsedSize` a largura abaixo do mínimo.
 */
function readAppLayout(): Layout | undefined {
  try {
    const stored = readStored(LAYOUT_STORAGE_KEY);
    if (stored !== null) {
      const side = percentOf(stored[SIDE_ID], MAX_SIDE);
      const right = percentOf(stored[RIGHT_ID], MAX_RIGHT);
      const fits = side !== null && right !== null && side + right <= 100 - MIN_MAIN + TOLERANCE;
      return fits ? layoutOf(side, right) : undefined;
    }
    const old = readStored(OLD_SIDE_STORAGE_KEY);
    const side = percentOf(old?.[SIDE_ID], MAX_SIDE);
    return side === null ? undefined : layoutOf(side, DEFAULT_RIGHT);
  } catch {
    return undefined;
  }
}

/** Guarda as larguras; a lateral recolhida (no trilho) vai como 0, para abrir recolhida na próxima vez. */
function saveAppLayout(layout: Layout, sideCollapsed: boolean) {
  try {
    const stored = { [SIDE_ID]: sideCollapsed ? 0 : layout[SIDE_ID], [RIGHT_ID]: layout[RIGHT_ID] };
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Sem armazenamento, as larguras só valem até fechar a janela.
  }
}

/**
 * Recolhe ou expande uma coluna. Recolhendo com o foco dentro dela, o `inert` que vem a seguir o jogaria no body.
 * Por isso ele vai antes para o botão da barra superior (ou para o conteúdo principal, se o botão não existir).
 */
function toggleColumn(panel: PanelImperativeHandle | null, region: string, toggleButton: string) {
  if (panel === null) return;
  if (panel.isCollapsed()) {
    panel.expand();
    return;
  }
  const ativo = document.activeElement;
  if (ativo instanceof Element && ativo.closest(region) !== null) {
    const destino =
      document.querySelector<HTMLElement>(toggleButton) ??
      document.querySelector<HTMLElement>('.app-main');
    destino?.focus();
  }
  panel.collapse();
}

/**
 * Estrutura da janela: barra superior de 36px com a marca, a aba fixa Início e as abas dos
 * workspaces; abaixo, a coluna lateral (a barra lateral, o explorador: busca, adicionar projeto, os projetos
 * com as sessões e os arquivados; redimensionável e recolhível, com a largura lembrada), a área da página, que
 * ocupa o resto da altura e rola sozinha, e a coluna do painel direito (as abas de arquivos e afins do projeto da
 * aba ativa; também redimensionável e recolhível, com a largura lembrada); e, no rodapé, a barra de status (projeto e branch da aba ativa,
 * contadores da visão geral, uso do computador e "Parar todos"). A janela não tem fundo decorativo: o fundo topográfico
 * vive só na faixa do topo do Início e nos estados vazios, nunca atrás de listas, tabelas, formulários ou terminais.
 * O roteador fica fora (HashRouter em main.tsx, MemoryRouter nos testes), então o App
 * funciona com qualquer um dos dois.
 */
export function App() {
  const [paletaAberta, setPaletaAberta] = useState(false);
  const sidebar = useSidebarData();
  const navigate = useNavigate();
  // O painel direito acompanha o projeto da aba ativa; fora de uma aba de projeto (o Início), não há projeto.
  const projectId = useMatch(ROUTE_PATHS.workspace)?.params.projectId ?? null;
  const itensPaleta = useMemo(() => buildPaletteItems(sidebar, navigate), [sidebar, navigate]);
  // As colunas recolhidas (arrastadas até o fim, ou guardadas assim): ficam escondidas, e o botão da barra superior, o
  // atalho e a paleta as trazem de volta. O estado nasce da largura guardada e segue o painel (`onResize`). O layout
  // guardado é lido uma vez só, na montagem.
  const [initialLayout] = useState(readAppLayout);
  const sidePanel = usePanelRef();
  const rightPanel = usePanelRef();
  const [sideCollapsed, setSideCollapsed] = useState(() => initialLayout?.[SIDE_ID] === 0);
  const [rightCollapsed, setRightCollapsed] = useState(() => initialLayout?.[RIGHT_ID] === 0);
  const toggleSidebar = useCallback(
    () => toggleColumn(sidePanel.current, '.app-side', '.topbar__sidebar-toggle'),
    [sidePanel],
  );
  const toggleRight = useCallback(
    () => toggleColumn(rightPanel.current, '.app-right', '.topbar__right-toggle'),
    [rightPanel],
  );

  // Fechar a janela e escolher "Salvar": o processo principal pede a gravação dos arquivos abertos, de qualquer visão.
  useEffect(() => listenForSaveAllRequests(), []);

  useEffect(() => {
    window.addEventListener(TOGGLE_SIDEBAR_EVENT, toggleSidebar);
    return () => window.removeEventListener(TOGGLE_SIDEBAR_EVENT, toggleSidebar);
  }, [toggleSidebar]);

  useEffect(() => {
    window.addEventListener(TOGGLE_RIGHT_PANEL_EVENT, toggleRight);
    return () => window.removeEventListener(TOGGLE_RIGHT_PANEL_EVENT, toggleRight);
  }, [toggleRight]);

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

  // Ctrl+Alt+B esconde ou mostra o painel direito. Como os outros dois atalhos, dentro do terminal ele segue para o
  // programa.
  useEffect(() => {
    function atalhoPainelDireito(event: KeyboardEvent) {
      const ctrlAltB =
        (event.ctrlKey || event.metaKey) &&
        event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'b';
      if (!ctrlAltB || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('.terminal-view') !== null)
        return;
      event.preventDefault();
      toggleRight();
    }
    window.addEventListener('keydown', atalhoPainelDireito);
    return () => window.removeEventListener('keydown', atalhoPainelDireito);
  }, [toggleRight]);

  return (
    <div className="app-shell">
      <RestoreWorkspace />
      <TopBar
        sidebarCollapsed={sideCollapsed}
        onToggleSidebar={toggleSidebar}
        rightCollapsed={rightCollapsed}
        onToggleRight={toggleRight}
      />
      <Group
        className={[
          'app-body',
          sideCollapsed ? 'app-body--side-collapsed' : '',
          rightCollapsed ? 'app-body--right-collapsed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        orientation="horizontal"
        defaultLayout={initialLayout}
        onLayoutChanged={(layout) =>
          saveAppLayout(layout, sidePanel.current?.isCollapsed() ?? false)
        }
      >
        <Panel
          id={SIDE_ID}
          className="app-body__panel"
          defaultSize={DEFAULT_SIDE_PX}
          // A lateral guarda a largura em pixels quando a janela muda: encolher a janela tira da página, não da lateral.
          groupResizeBehavior="preserve-pixel-size"
          minSize={MIN_SIDE_PX}
          maxSize={MAX_SIDE_PX}
          collapsible
          collapsedSize={RAIL_PX}
          panelRef={sidePanel}
          onResize={(size) => setSideCollapsed(size.inPixels <= RAIL_PX + 1)}
        >
          {/*
           * Recolhida, a lateral vira o trilho de 48px: um botão por agente vivo e o que a expande. A lateral cheia
           * continua montada (guarda os projetos abertos), mas escondida e `inert`, fora do Tab.
           */}
          <div className="app-side">
            {sideCollapsed ? <SidebarRail onExpand={toggleSidebar} /> : null}
            <div className="app-side__full" hidden={sideCollapsed} inert={sideCollapsed}>
              <Sidebar onSearch={() => setPaletaAberta(true)} />
            </div>
          </div>
        </Panel>
        <Separator className="pane-tree__separator" aria-label="Redimensionar barra lateral" />
        <Panel id={MAIN_ID} className="app-body__panel" minSize={`${MIN_MAIN}`}>
          <main className="app-main" tabIndex={-1}>
            <div className="app-main__content">
              <AppRoutes />
            </div>
          </main>
        </Panel>
        <Separator className="pane-tree__separator" aria-label="Redimensionar painel direito" />
        <Panel
          id={RIGHT_ID}
          className="app-body__panel"
          defaultSize={`${DEFAULT_RIGHT}`}
          minSize={260}
          maxSize={`${MAX_RIGHT}`}
          collapsible
          collapsedSize={0}
          panelRef={rightPanel}
          onResize={(size) => setRightCollapsed(size.inPixels === 0)}
        >
          {/* Recolhido, o painel sai do Tab também, como a lateral. */}
          <div className="app-right" inert={rightCollapsed}>
            <RightPanel projectId={projectId} />
          </div>
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
