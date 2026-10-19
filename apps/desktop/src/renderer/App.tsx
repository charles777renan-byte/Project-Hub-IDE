import { NavLink } from 'react-router';
import { AppRoutes, NAV_ITEMS } from './routes';

/**
 * Estrutura da janela: navegação principal e área da página. O roteador fica fora (HashRouter em
 * main.tsx, MemoryRouter nos testes), então o App funciona com qualquer um dos dois.
 */
export function App() {
  return (
    <div className="app-shell">
      <div className="app-sidebar">
        <p className="app-brand">Project Hub</p>
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
      </div>
      <main className="app-main">
        <AppRoutes />
      </main>
    </div>
  );
}
