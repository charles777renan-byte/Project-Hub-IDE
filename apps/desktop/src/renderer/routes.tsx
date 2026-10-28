import { Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { HomePage } from './pages/HomePage';
import { WorkspacePage } from './pages/WorkspacePage';
import { VIEW_PARAM, type ProjectView } from './project-views';

/**
 * Caminhos das rotas. No aplicativo (HashRouter) eles aparecem no endereço depois do `#`. Os
 * parâmetros são `:projectId` e `:missionId`; `projectPath`, `missionPath` e `workspacePath` montam os endereços.
 * `projects` é a rota antiga da lista de projetos, que não existe mais como página: ela só redireciona ao Início,
 * para endereços guardados não caírem em tela vazia. `projectDetail` (`/projects/:projectId`) também só
 * redireciona, para a aba do projeto: a tela de projeto é uma só, em `workspace`, com as visões em `?visao=`.
 * Nenhum link do app aponta para essas duas rotas. `legacyMissionDetail` (`/projects/:projectId/missions/:missionId`)
 * redireciona para a missão dentro da aba do projeto.
 */
export const ROUTE_PATHS = {
  home: '/',
  projects: '/projects',
  projectDetail: '/projects/:projectId',
  /** Rota antiga da missão: só redireciona para `missionDetail`. */
  legacyMissionDetail: '/projects/:projectId/missions/:missionId',
  /** A missão aberta dentro da aba do projeto. */
  missionDetail: '/workspaces/:projectId/missoes/:missionId',
  /** A aba do projeto. O `/*` faz a missão (`missionDetail`) cair na mesma rota: a página não é remontada. */
  workspace: '/workspaces/:projectId/*',
} as const;

/** Parâmetro do Início (`/?editar-nome=1`) que abre o campo do nome na saudação; a paleta o pede. */
export const EDIT_NAME_PARAM = 'editar-nome';

/** Endereço do workspace de um projeto (as abas da barra superior), na visão padrão: os terminais. */
export function workspacePath(projectId: string): string {
  return `/workspaces/${encodeURIComponent(projectId)}`;
}

/** Endereço de uma visão da aba do projeto. */
export function projectViewPath(projectId: string, view: ProjectView): string {
  return `${workspacePath(projectId)}?${VIEW_PARAM}=${view}`;
}

/** Endereço do projeto: a aba dele, na visão das missões (seção 10.5). */
export function projectPath(projectId: string): string {
  return projectViewPath(projectId, 'missoes');
}

/** Endereço de uma missão: o centro da aba do projeto, no lugar das visões (seção 10.7). */
export function missionPath(projectId: string, missionId: string): string {
  return `${workspacePath(projectId)}/missoes/${encodeURIComponent(missionId)}`;
}

/**
 * Rota antiga do detalhe do projeto: manda para a aba do projeto, na visão das missões. O estado da rota vai
 * junto, porque a paleta ("Nova missão em ...") pede o formulário aberto por `state.newMission`.
 */
function ProjectRedirect() {
  const { projectId = '' } = useParams();
  const location = useLocation();
  return <Navigate to={projectPath(projectId)} replace state={location.state} />;
}

/** Rota antiga da missão: manda para a missão dentro da aba do projeto. */
function MissionRedirect() {
  const { projectId = '', missionId = '' } = useParams();
  return <Navigate to={missionPath(projectId, missionId)} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path={ROUTE_PATHS.home} element={<HomePage />} />
      <Route path={ROUTE_PATHS.projects} element={<Navigate to={ROUTE_PATHS.home} replace />} />
      <Route path={ROUTE_PATHS.projectDetail} element={<ProjectRedirect />} />
      <Route path={ROUTE_PATHS.legacyMissionDetail} element={<MissionRedirect />} />
      <Route path={ROUTE_PATHS.workspace} element={<WorkspacePage />} />
    </Routes>
  );
}
