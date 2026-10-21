import { useId } from 'react';
import { Link, useMatch, useNavigate } from 'react-router';
import type { MissionDto } from '@project-hub/contracts';
import { statusLabel, statusTone } from '../mission-text';
import { missionPath, projectPath, ROUTE_PATHS } from '../routes';
import { useSidebarData, type SidebarData } from '../use-sidebar-data';
import { StatusChip } from './StatusChip';

/**
 * Barra lateral de 230px, à esquerda da página: os projetos e, na rota de um projeto ou de uma
 * missão, as missões desse projeto. O projeto atual vem de `currentProjectId` ou, sem ele, da rota.
 * O App monta a barra fora de `<Routes>`, onde `useParams` devolve vazio; `useMatch` lê a rota de
 * qualquer lugar do roteador, então a barra não depende de quem a monta.
 */
export function Sidebar({ currentProjectId }: { currentProjectId?: string }) {
  const navigate = useNavigate();
  const projectMatch = useMatch(ROUTE_PATHS.projectDetail);
  const missionMatch = useMatch(ROUTE_PATHS.missionDetail);
  const projectId =
    currentProjectId ?? missionMatch?.params.projectId ?? projectMatch?.params.projectId;
  const currentMissionId = missionMatch?.params.missionId;
  const data = useSidebarData();
  const ids = useId();

  return (
    <aside aria-label="Projetos e missões" className="sidebar">
      <section aria-labelledby={`${ids}-projetos`} className="sidebar__section">
        <p id={`${ids}-projetos`} className="sidebar__title">
          Projetos
        </p>
        <ProjectItems data={data} currentId={projectId} />
        <button
          type="button"
          className="sidebar__action"
          onClick={() => navigate(ROUTE_PATHS.projects)}
        >
          + Novo projeto
        </button>
      </section>

      {projectId === undefined ? null : (
        <section aria-labelledby={`${ids}-missoes`} className="sidebar__section">
          <p id={`${ids}-missoes`} className="sidebar__title">
            Missões
          </p>
          <MissionItems data={data} projectId={projectId} currentMissionId={currentMissionId} />
          <button
            type="button"
            className="sidebar__action"
            onClick={() => navigate(projectPath(projectId))}
          >
            + Nova missão
          </button>
        </section>
      )}
    </aside>
  );
}

function ProjectItems({ data, currentId }: { data: SidebarData; currentId?: string | undefined }) {
  if (data.status === 'loading') return <p className="muted">Carregando…</p>;
  if (data.status === 'error') {
    return (
      <p role="alert" className="page-alert">
        {data.message}
      </p>
    );
  }
  if (data.projects.length === 0) return <p className="muted">Nenhum projeto ainda.</p>;

  return (
    <ul className="sidebar__list">
      {data.projects.map((project) => {
        const isCurrent = project.id === currentId;
        return (
          <li key={project.id} className="sidebar__item">
            <Link
              to={projectPath(project.id)}
              className="sidebar__link"
              aria-current={isCurrent ? 'page' : undefined}
            >
              <span
                aria-hidden="true"
                className={isCurrent ? 'sidebar__dot sidebar__dot--cyan' : 'sidebar__dot'}
              />
              <span className="sidebar__name">{project.name}</span>
            </Link>
            {project.repositoryKind === 'git' ? null : <StatusChip label="sem Git" tone="muted" />}
          </li>
        );
      })}
    </ul>
  );
}

function MissionItems({
  data,
  projectId,
  currentMissionId,
}: {
  data: SidebarData;
  projectId: string;
  currentMissionId?: string | undefined;
}) {
  // Carregando ou com erro, a seção Projetos já diz o que se passa: aqui não há lista para mostrar.
  if (data.status !== 'ready') return null;
  const missions: MissionDto[] = data.missionsByProject[projectId] ?? [];
  if (missions.length === 0) return <p className="muted">Nenhuma missão ainda.</p>;

  return (
    <ul className="sidebar__list">
      {missions.map((mission) => {
        const tone = statusTone(mission.status);
        return (
          <li key={mission.id} className="sidebar__item">
            <Link
              to={missionPath(projectId, mission.id)}
              className="sidebar__link"
              aria-current={mission.id === currentMissionId ? 'page' : undefined}
            >
              <span aria-hidden="true" className={`sidebar__dot sidebar__dot--${tone}`} />
              <span className="sidebar__name">{mission.title}</span>
            </Link>
            <StatusChip label={statusLabel(mission.status)} tone={tone} />
          </li>
        );
      })}
    </ul>
  );
}
