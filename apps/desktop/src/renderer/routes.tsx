import { Route, Routes } from 'react-router';
import { HomePage } from './pages/HomePage';
import { ProjectsPage } from './pages/ProjectsPage';

/** Caminhos das rotas. No aplicativo (HashRouter) eles aparecem no endereço depois do `#`. */
export const ROUTE_PATHS = {
  home: '/',
  projects: '/projects',
} as const;

/** Links da navegação principal, na ordem em que aparecem na tela. */
export const NAV_ITEMS = [
  { to: ROUTE_PATHS.home, label: 'Início' },
  { to: ROUTE_PATHS.projects, label: 'Projetos' },
] as const;

export function AppRoutes() {
  return (
    <Routes>
      <Route path={ROUTE_PATHS.home} element={<HomePage />} />
      <Route path={ROUTE_PATHS.projects} element={<ProjectsPage />} />
    </Routes>
  );
}
