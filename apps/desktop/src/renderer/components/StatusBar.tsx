import { useMatch } from 'react-router';
import { ROUTE_PATHS } from '../routes';
import { useSidebarData } from '../use-sidebar-data';
import { OverviewCounters } from './OverviewCounters';
import { StopAll } from './StopAll';
import { SystemUsage } from './SystemUsage';

/**
 * Barra de status, o rodapé da janela (24px). Da esquerda para a direita: o projeto e a branch da aba
 * ativa (só na rota do workspace; fora dela, nada), os contadores da visão geral, o uso do computador e
 * "Parar todos". Tudo numa linha, que trunca com reticências em janela estreita: o projeto cede primeiro,
 * e o uso do computador some em janela estreita (app.css). O nome do projeto entra sempre como texto.
 */
export function StatusBar() {
  const workspaceMatch = useMatch(ROUTE_PATHS.workspace);
  const { projects } = useSidebarData();
  const project = projects.find((item) => item.id === workspaceMatch?.params.projectId);
  const where =
    project === undefined
      ? null
      : project.defaultBranch === undefined
        ? project.name
        : `${project.name} · ${project.defaultBranch}`;

  return (
    <footer className="statusbar" aria-label="Barra de status">
      {where === null ? null : (
        <p className="statusbar__project" title={where}>
          {where}
        </p>
      )}
      <OverviewCounters />
      <div className="statusbar__end">
        <SystemUsage />
        <StopAll />
      </div>
    </footer>
  );
}
