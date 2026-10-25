import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ActivityHeatmap } from '../components/home/ActivityHeatmap';
import { AgentUsage } from '../components/home/AgentUsage';
import { CallToAction } from '../components/home/CallToAction';
import { Greeting } from '../components/home/Greeting';
import { RecentProjects } from '../components/home/RecentProjects';
import { StatTiles } from '../components/home/StatTiles';
import { MissionCard } from '../components/MissionCard';
import { PanelEmpty } from '../components/Panel';
import { missionPath } from '../routes';
import { useTerminals } from '../terminals-data';
import { useOverview, type OverviewItem } from '../use-overview';
import { useSidebarData } from '../use-sidebar-data';
import { useOpenWorkspaces } from '../workspaces-data';

/** Coluna de missões do Início: título, contagem em `--muted` à direita e o corpo. Altura mínima uniforme. */
function MissionsColumn({
  title,
  count,
  children,
}: {
  title: string;
  count?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="home-column">
      <header className="home-column__head">
        <h2 id={titleId} className="home-column__title">
          {title}
        </h2>
        {count === undefined ? null : <span className="home-column__count">{count}</span>}
      </header>
      <div className="home-column__body">{children}</div>
    </section>
  );
}

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
 * Início (seção 10.3), em faixas que não se sobrepõem: cabeçalho (saudação e pílulas de contadores),
 * chamada "Nova missão", projetos recentes, atividade, uso dos agentes e, por último, as listas
 * "Aguardando você", "Missões em execução" e "Falharam". Os números vêm da carga compartilhada da visão geral; as sessões abertas, da lista de
 * terminais (a mesma da barra lateral); o "há X", do workspace do projeto. Nenhum número é simulado.
 */
export function HomePage() {
  const overview = useOverview();
  const sidebar = useSidebarData();
  const { workspaces } = useOpenWorkspaces();
  const terminals = useTerminals();
  const { loaded, approvalsLoaded, approvals, unreadApprovals } = overview;

  const running = overview.items.filter(({ mission }) => mission.status === 'running');
  const hasWaiting = approvals.length > 0 || unreadApprovals.length > 0;
  const waitingCount = approvalsLoaded ? String(approvals.length) : undefined;

  return (
    <div className="home">
      <div className="home-head">
        <Greeting />
        <StatTiles
          running={overview.running}
          waiting={overview.waiting}
          failed={overview.failed.length}
          loaded={loaded}
        />
      </div>
      <CallToAction />
      <RecentProjects
        status={sidebar.status}
        {...(sidebar.message === undefined ? {} : { message: sidebar.message })}
        projects={sidebar.projects}
        workspaces={workspaces}
        terminals={
          terminals.error !== null ? 'unknown' : terminals.loaded ? terminals.terminals : null
        }
      />
      <ActivityHeatmap />
      <AgentUsage />
      <div className="home-lists">
        <MissionsColumn
          title="Aguardando você"
          {...(waitingCount === undefined ? {} : { count: waitingCount })}
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
        </MissionsColumn>
        <MissionsColumn
          title="Missões em execução"
          {...(loaded ? { count: String(running.length) } : {})}
        >
          {loaded ? <MissionList items={running} empty="Nenhuma missão em execução." /> : LOADING}
        </MissionsColumn>
        <MissionsColumn
          title="Falharam"
          {...(loaded ? { count: String(overview.failed.length) } : {})}
        >
          {loaded ? (
            <MissionList items={overview.failed} empty="Nenhuma missão falhou." />
          ) : (
            LOADING
          )}
        </MissionsColumn>
      </div>
    </div>
  );
}
