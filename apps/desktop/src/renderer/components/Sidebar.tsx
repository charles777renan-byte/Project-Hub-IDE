import { useId, useState } from 'react';
import { Link, useMatch, useNavigate } from 'react-router';
import type { MissionDto, ProjectSummary, TerminalSummary } from '@project-hub/contracts';
import { statusLabel, type MissionStatus } from '../mission-text';
import { missionPath, projectPath, ROUTE_PATHS, workspacePath } from '../routes';
import { markOfMission, markOfTerminal, type MarkKind } from '../state-mark';
import { useTerminals } from '../terminals-data';
import { useSidebarData, type SidebarData } from '../use-sidebar-data';
import { ChevronRight, ICON_PROPS } from './Icon';
import { MainNav } from './MainNav';
import { StateMark } from './StateMark';
import { StatusChip } from './StatusChip';

/** Estados de missão que entram na seção Em andamento: as que rodam e as que esperam. */
const IN_PROGRESS: readonly MissionStatus[] = [
  'running',
  'waiting_approval',
  'waiting_input',
  'planned',
  'queued',
];

/** O que a pessoa pediu para mostrar no workspace; o workspace lê isto em `location.state`. */
type ShowTerminal = (projectId: string, terminalId: string) => void;

/**
 * Barra lateral: a navegação principal no topo, a seção Workspaces (cada projeto com as sessões
 * abertas dele) e a seção Em andamento (as missões que rodam ou esperam, de todos os projetos). Ocupa
 * toda a coluna que a recebe, e cada seção rola sozinha. O projeto atual, que dá destino ao botão
 * Nova missão, vem de `currentProjectId` ou, sem ele, da rota. O App monta a barra fora de `<Routes>`,
 * onde `useParams` devolve vazio; `useMatch` lê a rota de qualquer lugar do roteador.
 */
export function Sidebar({ currentProjectId }: { currentProjectId?: string }) {
  const navigate = useNavigate();
  const workspaceMatch = useMatch(ROUTE_PATHS.workspace);
  const projectMatch = useMatch(ROUTE_PATHS.projectDetail);
  const missionMatch = useMatch(ROUTE_PATHS.missionDetail);
  const projectId =
    currentProjectId ??
    missionMatch?.params.projectId ??
    workspaceMatch?.params.projectId ??
    projectMatch?.params.projectId;
  const data = useSidebarData();
  const { terminals, error: terminalsError } = useTerminals();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const ids = useId();

  const showTerminal: ShowTerminal = (targetProjectId, terminalId) => {
    navigate(workspacePath(targetProjectId), { state: { showTerminal: terminalId } });
  };
  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  return (
    <aside aria-label="Projetos e missões" className="sidebar">
      <MainNav />

      <section aria-labelledby={`${ids}-workspaces`} className="sidebar__section">
        <p id={`${ids}-workspaces`} className="sidebar__title">
          Workspaces
        </p>
        <div className="sidebar__scroll">
          {terminalsError === null ? null : (
            <p role="status" className="muted">
              Não foi possível ler as sessões.
            </p>
          )}
          <WorkspaceItems
            data={data}
            terminals={terminals}
            currentId={workspaceMatch?.params.projectId}
            expanded={expanded}
            onToggle={toggle}
            onShowTerminal={showTerminal}
            idPrefix={ids}
          />
        </div>
        <button
          type="button"
          className="sidebar__action"
          onClick={() => navigate(ROUTE_PATHS.projects)}
        >
          + Novo projeto
        </button>
      </section>

      {data.status === 'ready' ? (
        <section aria-labelledby={`${ids}-andamento`} className="sidebar__section">
          <p id={`${ids}-andamento`} className="sidebar__title">
            Em andamento
          </p>
          <div className="sidebar__scroll">
            <RunningItems
              data={data}
              terminals={terminals}
              currentMissionId={missionMatch?.params.missionId}
              onShowTerminal={showTerminal}
            />
          </div>
          {projectId === undefined ? null : (
            <button
              type="button"
              className="sidebar__action"
              onClick={() => navigate(projectPath(projectId))}
            >
              + Nova missão
            </button>
          )}
        </section>
      ) : null}
    </aside>
  );
}

/**
 * Marca do projeto na lista: `waiting` se alguma sessão ou missão dele espera a pessoa, `active` se algo
 * roda, senão `disconnected`. O que espera pesa mais que o que roda, porque pede uma ação.
 */
function projectMark(
  sessions: readonly TerminalSummary[],
  missions: readonly MissionDto[],
): MarkKind {
  const kinds = [
    ...sessions.map((session) => markOfTerminal(session.state)),
    ...missions.map((mission) => markOfMission(mission.status)),
  ];
  if (kinds.includes('waiting')) return 'waiting';
  if (kinds.includes('active')) return 'active';
  return 'disconnected';
}

function groupByProject(terminals: readonly TerminalSummary[]): Map<string, TerminalSummary[]> {
  const groups = new Map<string, TerminalSummary[]>();
  for (const terminal of terminals) {
    groups.set(terminal.projectId, [...(groups.get(terminal.projectId) ?? []), terminal]);
  }
  return groups;
}

/**
 * Lista de projetos, cada um um link para o workspace dele, com a marca agregada, o botão que expande
 * as sessões abertas e, no projeto sem Git, o chip "sem Git". Só o projeto da rota do workspace leva
 * `aria-current`: o link aponta para a página atual apenas ali. Nomes entram como texto.
 */
function WorkspaceItems({
  data,
  terminals,
  currentId,
  expanded,
  onToggle,
  onShowTerminal,
  idPrefix,
}: {
  data: SidebarData;
  terminals: readonly TerminalSummary[];
  currentId?: string | undefined;
  expanded: ReadonlySet<string>;
  onToggle: (projectId: string) => void;
  onShowTerminal: ShowTerminal;
  idPrefix: string;
}) {
  if (data.status === 'loading') return <p className="muted">Carregando…</p>;
  if (data.status === 'error') {
    return (
      <p role="alert" className="page-alert">
        {data.message}
      </p>
    );
  }
  if (data.projects.length === 0) return <p className="muted">Nenhum projeto ainda.</p>;

  const sessionsByProject = groupByProject(terminals);
  return (
    <ul className="sidebar__list">
      {data.projects.map((project) => (
        <WorkspaceItem
          key={project.id}
          project={project}
          sessions={sessionsByProject.get(project.id) ?? []}
          missions={data.missionsByProject[project.id] ?? []}
          isCurrent={project.id === currentId}
          isOpen={expanded.has(project.id)}
          onToggle={() => onToggle(project.id)}
          onShowTerminal={onShowTerminal}
          listId={`${idPrefix}-sessoes-${project.id}`}
        />
      ))}
    </ul>
  );
}

function WorkspaceItem({
  project,
  sessions,
  missions,
  isCurrent,
  isOpen,
  onToggle,
  onShowTerminal,
  listId,
}: {
  project: ProjectSummary;
  sessions: readonly TerminalSummary[];
  missions: readonly MissionDto[];
  isCurrent: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onShowTerminal: ShowTerminal;
  listId: string;
}) {
  return (
    <li className="sidebar__item">
      <div className="sidebar__row">
        <button
          type="button"
          className="sidebar__toggle"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-label={`Sessões de ${project.name}`}
          onClick={onToggle}
        >
          <span aria-hidden="true" className="sidebar__chevron">
            <ChevronRight {...ICON_PROPS} />
          </span>
          {sessions.length === 0 ? null : (
            <span aria-hidden="true" className="sidebar__count">
              {sessions.length}
            </span>
          )}
        </button>
        <Link
          to={workspacePath(project.id)}
          className="sidebar__link"
          aria-current={isCurrent ? 'page' : undefined}
        >
          <span className="sidebar__name" title={project.name}>
            {project.name}
          </span>
        </Link>
        <StateMark kind={projectMark(sessions, missions)} />
        {project.repositoryKind === 'git' ? null : <StatusChip label="sem Git" tone="muted" />}
      </div>
      {isOpen ? (
        <ul id={listId} className="sidebar__sessions">
          {sessions.length === 0 ? (
            <li className="sidebar__empty">Nenhuma sessão aberta.</li>
          ) : (
            sessions.map((session) => (
              <li key={session.id} className="sidebar__session">
                <button
                  type="button"
                  className="sidebar__link"
                  onClick={() => onShowTerminal(project.id, session.id)}
                >
                  <span className="sidebar__name" title={session.title}>
                    {session.title}
                  </span>
                </button>
                <StateMark kind={markOfTerminal(session.state)} withLabel />
              </li>
            ))
          )}
        </ul>
      ) : null}
    </li>
  );
}

/** O terminal de uma missão: o que ainda roda ou espera vale mais que o já encerrado. */
function terminalByMission(terminals: readonly TerminalSummary[]): Map<string, TerminalSummary> {
  const byMission = new Map<string, TerminalSummary>();
  for (const terminal of terminals) {
    if (terminal.missionId === undefined) continue;
    const known = byMission.get(terminal.missionId);
    if (known === undefined || (known.state === 'exited' && terminal.state !== 'exited')) {
      byMission.set(terminal.missionId, terminal);
    }
  }
  return byMission;
}

/**
 * Missões que rodam ou esperam, de todos os projetos, na ordem dos projetos. A que tem terminal de
 * agente abre esse terminal no workspace do projeto; a que não tem leva à página da missão. O estado
 * aparece como marca com texto, e a situação por extenso fica no `title` da linha de estado.
 */
function RunningItems({
  data,
  terminals,
  currentMissionId,
  onShowTerminal,
}: {
  data: SidebarData;
  terminals: readonly TerminalSummary[];
  currentMissionId?: string | undefined;
  onShowTerminal: ShowTerminal;
}) {
  const terminalOf = terminalByMission(terminals);
  const items = data.projects.flatMap((project) =>
    (data.missionsByProject[project.id] ?? [])
      .filter((mission) => IN_PROGRESS.includes(mission.status))
      .map((mission) => ({ project, mission })),
  );
  if (items.length === 0) return <p className="muted">Nada em andamento.</p>;

  return (
    <ul className="sidebar__list">
      {items.map(({ project, mission }) => {
        const terminal = terminalOf.get(mission.id);
        const name = (
          <span className="sidebar__name" title={mission.title}>
            {mission.title}
          </span>
        );
        return (
          <li key={mission.id} className="sidebar__item">
            {terminal === undefined ? (
              <Link
                to={missionPath(project.id, mission.id)}
                className="sidebar__link"
                aria-current={mission.id === currentMissionId ? 'page' : undefined}
              >
                {name}
              </Link>
            ) : (
              <button
                type="button"
                className="sidebar__link"
                onClick={() => onShowTerminal(project.id, terminal.id)}
              >
                {name}
              </button>
            )}
            <span className="sidebar__meta" title={statusLabel(mission.status)}>
              <StateMark kind={markOfMission(mission.status)} withLabel />
              <span className="sidebar__project" title={project.name}>
                {project.name}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
