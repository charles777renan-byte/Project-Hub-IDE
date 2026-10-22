import { Route, Routes } from 'react-router';
import { HomePage } from './pages/HomePage';
import { MissionPage } from './pages/MissionPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { TerminalsPage } from './pages/TerminalsPage';

/**
 * Caminhos das rotas. No aplicativo (HashRouter) eles aparecem no endereço depois do `#`. Os
 * parâmetros são `:projectId` e `:missionId`; `projectPath`, `missionPath` e `workspacePath` montam os endereços.
 */
export const ROUTE_PATHS = {
  home: '/',
  projects: '/projects',
  terminals: '/terminals',
  projectDetail: '/projects/:projectId',
  missionDetail: '/projects/:projectId/missions/:missionId',
  // Sem página até a Tarefa 9: só o caminho, que a barra superior e o App já usam.
  workspace: '/workspaces/:projectId',
} as const;

/** Endereço do detalhe de um projeto (seção 10.5). */
export function projectPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

/** Endereço do workspace de um projeto (as abas da barra superior). */
export function workspacePath(projectId: string): string {
  return `/workspaces/${encodeURIComponent(projectId)}`;
}

/** Endereço do workspace de uma missão (seção 10.7). */
export function missionPath(projectId: string, missionId: string): string {
  return `${projectPath(projectId)}/missions/${encodeURIComponent(missionId)}`;
}

/** Links da navegação principal, na ordem em que aparecem na tela. */
export const NAV_ITEMS = [
  { to: ROUTE_PATHS.home, label: 'Início' },
  { to: ROUTE_PATHS.projects, label: 'Projetos' },
  { to: ROUTE_PATHS.terminals, label: 'Terminais' },
] as const;

export function AppRoutes() {
  return (
    <Routes>
      <Route path={ROUTE_PATHS.home} element={<HomePage />} />
      <Route path={ROUTE_PATHS.projects} element={<ProjectsPage />} />
      <Route path={ROUTE_PATHS.terminals} element={<TerminalsPage />} />
      <Route path={ROUTE_PATHS.projectDetail} element={<ProjectDetailPage />} />
      <Route path={ROUTE_PATHS.missionDetail} element={<MissionPage />} />
    </Routes>
  );
}
