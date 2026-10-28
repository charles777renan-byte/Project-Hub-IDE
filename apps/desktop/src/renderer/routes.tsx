import { Navigate, Route, Routes } from 'react-router';
import { HomePage } from './pages/HomePage';
import { MissionPage } from './pages/MissionPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { WorkspacePage } from './pages/WorkspacePage';

/**
 * Caminhos das rotas. No aplicativo (HashRouter) eles aparecem no endereço depois do `#`. Os
 * parâmetros são `:projectId` e `:missionId`; `projectPath`, `missionPath` e `workspacePath` montam os endereços.
 * `projects` é a rota antiga da lista de projetos, que não existe mais como página: ela só redireciona ao Início,
 * para endereços guardados não caírem em tela vazia. Nenhum link do app aponta para ela.
 */
export const ROUTE_PATHS = {
  home: '/',
  projects: '/projects',
  projectDetail: '/projects/:projectId',
  missionDetail: '/projects/:projectId/missions/:missionId',
  workspace: '/workspaces/:projectId',
} as const;

/** Parâmetro do Início (`/?editar-nome=1`) que abre o campo do nome na saudação; a paleta o pede. */
export const EDIT_NAME_PARAM = 'editar-nome';

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

export function AppRoutes() {
  return (
    <Routes>
      <Route path={ROUTE_PATHS.home} element={<HomePage />} />
      <Route path={ROUTE_PATHS.projects} element={<Navigate to={ROUTE_PATHS.home} replace />} />
      <Route path={ROUTE_PATHS.projectDetail} element={<ProjectDetailPage />} />
      <Route path={ROUTE_PATHS.missionDetail} element={<MissionPage />} />
      <Route path={ROUTE_PATHS.workspace} element={<WorkspacePage />} />
    </Routes>
  );
}
