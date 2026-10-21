import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { Sidebar } from './components/Sidebar';
import { TopographicBackground } from './components/TopographicBackground';
import { AppRoutes, NAV_ITEMS } from './routes';

/**
 * Estrutura da janela: cabeçalho de 50px com a marca, a navegação e, à direita, o que vier em
 * `headerStatus` (os contadores da visão geral); abaixo, a barra lateral de projetos e missões e a
 * área da página, que ocupa o resto da altura e rola sozinha. O roteador fica fora (HashRouter em
 * main.tsx, MemoryRouter nos testes), então o App funciona com qualquer um dos dois.
 */
export function App({ headerStatus }: { headerStatus?: ReactNode } = {}) {
  return (
    <div className="app-shell">
      <TopographicBackground />
      <header className="app-header">
        <p className="app-brand">
          <span aria-hidden="true" className="app-brand__mark" />
          Project Hub
        </p>
        <nav aria-label="Principal">
          <ul className="app-nav">
            {NAV_ITEMS.map(({ to, label }) => (
              <li key={to}>
                {/* O NavLink marca a página atual com aria-current="page". */}
                <NavLink to={to}>{label}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
        {headerStatus === undefined || headerStatus === null ? null : (
          <div className="app-header__status">{headerStatus}</div>
        )}
      </header>
      <div className="app-body">
        <Sidebar />
        <main className="app-main">
          <div className="app-main__content">
            <AppRoutes />
          </div>
        </main>
      </div>
    </div>
  );
}
