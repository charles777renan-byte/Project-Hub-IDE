import { Link, useNavigate } from 'react-router';
import { MissionCard } from '../components/MissionCard';
import { Panel, PanelEmpty } from '../components/Panel';
import { ProjectCard } from '../components/ProjectCard';
import { missionPath, ROUTE_PATHS } from '../routes';
import { useOverview, type OverviewItem } from '../use-overview';
import { useSidebarData } from '../use-sidebar-data';

/** Quantos projetos o painel "Projetos recentes" mostra. */
const RECENT_PROJECTS = 5;

const LOADING = <PanelEmpty>Carregando…</PanelEmpty>;

function MissionList({ items, empty }: { items: OverviewItem[]; empty: string }) {
  if (items.length === 0) return <PanelEmpty>{empty}</PanelEmpty>;
  return (
    <div className="home-list">
      {items.map(({ projectId, mission }) => (
        <MissionCard key={mission.id} mission={mission} projectId={projectId} />
      ))}
    </div>
  );
}

/**
 * Início (seção 10.3): o que espera a pessoa, o que está em execução, o que falhou e os projetos.
 * Tudo vem da carga compartilhada da visão geral; "Projetos recentes" mantém a ordem recebida, porque
 * `ProjectSummary` não tem data de atualização.
 */
export function HomePage() {
  const navigate = useNavigate();
  const overview = useOverview();
  const sidebar = useSidebarData();
  const { loaded, approvalsLoaded, approvals, unreadApprovals } = overview;

  const running = overview.items.filter(({ mission }) => mission.status === 'running');
  const hasWaiting = approvals.length > 0 || unreadApprovals.length > 0;
  const waitingMeta = approvalsLoaded ? String(approvals.length) : undefined;

  return (
    <div className="home">
      <div className="home__head">
        <h1>Início</h1>
        <button
          type="button"
          className="btn-primary"
          onClick={() => navigate(ROUTE_PATHS.projects)}
        >
          + Nova missão
        </button>
      </div>
      <div className="home__grid">
        <Panel
          title="Aguardando você"
          accent="violet"
          {...(waitingMeta ? { meta: waitingMeta } : {})}
        >
          {hasWaiting ? (
            <ul className="home-approvals">
              {approvals.map(({ projectId, missionId, missionTitle, approval }) => (
                <li key={approval.id}>
                  <Link to={missionPath(projectId, missionId)}>{approval.title}</Link>
                  <span className="home-approvals__mission">{missionTitle}</span>
                </li>
              ))}
              {unreadApprovals.map(({ missionId, missionTitle }) => (
                <li key={`unread-${missionId}`}>
                  Não foi possível carregar a aprovação de {missionTitle}.
                </li>
              ))}
            </ul>
          ) : null}
          {!loaded || !approvalsLoaded ? LOADING : null}
          {loaded && approvalsLoaded && !hasWaiting ? (
            <PanelEmpty>Nada espera por você</PanelEmpty>
          ) : null}
        </Panel>
        <Panel
          title="Missões em execução"
          accent="lime"
          {...(loaded ? { meta: String(running.length) } : {})}
        >
          {loaded ? <MissionList items={running} empty="Nenhuma missão em execução." /> : LOADING}
        </Panel>
        <Panel
          title="Falharam"
          accent="red"
          {...(loaded ? { meta: String(overview.failed.length) } : {})}
        >
          {loaded ? (
            <MissionList items={overview.failed} empty="Nenhuma missão falhou." />
          ) : (
            LOADING
          )}
        </Panel>
        <Panel title="Projetos recentes" accent="cyan">
          {sidebar.status === 'error' ? (
            <PanelEmpty>{sidebar.message}</PanelEmpty>
          ) : sidebar.status === 'loading' ? (
            LOADING
          ) : sidebar.projects.length === 0 ? (
            <PanelEmpty>
              Nenhum projeto ainda. Adicione um projeto para começar.{' '}
              <Link to={ROUTE_PATHS.projects}>Ir para Projetos</Link>
            </PanelEmpty>
          ) : (
            <div className="home-list">
              {sidebar.projects.slice(0, RECENT_PROJECTS).map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
