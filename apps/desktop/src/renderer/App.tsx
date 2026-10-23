import type { ReactNode } from 'react';
import { Group, Panel, Separator, type Layout } from 'react-resizable-panels';
import { useMatch } from 'react-router';
import { Sidebar } from './components/Sidebar';
import { RestoreWorkspace, TopBar } from './components/TopBar';
import { TopographicBackground } from './components/TopographicBackground';
import { AppRoutes, ROUTE_PATHS } from './routes';

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
 * Estrutura da janela: barra superior de 36px com a marca, as abas dos workspaces e, à direita, o que
 * vier em `headerStatus` (os contadores da visão geral); abaixo, a coluna lateral (a barra lateral,
 * que leva a navegação principal, os workspaces e as missões em andamento; redimensionável e
 * recolhível, com a largura lembrada) e a área da página, que
 * ocupa o resto da altura e rola sozinha. O fundo topográfico fica de fora da rota do workspace, onde
 * há terminais. O roteador fica fora (HashRouter em main.tsx, MemoryRouter nos testes), então o App
 * funciona com qualquer um dos dois.
 */
export function App({ headerStatus }: { headerStatus?: ReactNode } = {}) {
  const inWorkspace = useMatch(ROUTE_PATHS.workspace) !== null;
  return (
    <div className="app-shell">
      {inWorkspace ? null : <TopographicBackground />}
      <RestoreWorkspace />
      <TopBar status={headerStatus} />
      <Group
        className="app-body"
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
        >
          <div className="app-side">
            <Sidebar />
          </div>
        </Panel>
        <Separator className="pane-tree__separator" aria-label="Redimensionar barra lateral" />
        <Panel id={MAIN_ID} className="app-body__panel" minSize="30">
          <main className="app-main">
            <div className="app-main__content">
              <AppRoutes />
            </div>
          </main>
        </Panel>
      </Group>
    </div>
  );
}
