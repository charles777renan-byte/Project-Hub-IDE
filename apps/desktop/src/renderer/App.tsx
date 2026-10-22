import type { ReactNode } from 'react';
import { useMatch } from 'react-router';
import { MainNav } from './components/MainNav';
import { Sidebar } from './components/Sidebar';
import { RestoreWorkspace, TopBar } from './components/TopBar';
import { TopographicBackground } from './components/TopographicBackground';
import { AppRoutes, ROUTE_PATHS } from './routes';

/**
 * Estrutura da janela: barra superior de 36px com a marca, as abas dos workspaces e, à direita, o que
 * vier em `headerStatus` (os contadores da visão geral); abaixo, a coluna lateral (navegação principal
 * e barra de projetos e missões) e a área da página, que ocupa o resto da altura e rola sozinha. O
 * fundo topográfico fica de fora da rota do workspace, onde há terminais. O roteador fica fora
 * (HashRouter em main.tsx, MemoryRouter nos testes), então o App funciona com qualquer um dos dois.
 */
export function App({ headerStatus }: { headerStatus?: ReactNode } = {}) {
  const inWorkspace = useMatch(ROUTE_PATHS.workspace) !== null;
  return (
    <div className="app-shell">
      {inWorkspace ? null : <TopographicBackground />}
      <RestoreWorkspace />
      <TopBar status={headerStatus} />
      <div className="app-body">
        <div className="app-side">
          <MainNav />
          <Sidebar />
        </div>
        <main className="app-main">
          <div className="app-main__content">
            <AppRoutes />
          </div>
        </main>
      </div>
    </div>
  );
}
