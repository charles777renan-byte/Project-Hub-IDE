import { useId, useState } from 'react';
import { Link, useMatch, useNavigate } from 'react-router';
import type { MissionDto, ProjectSummary, TerminalSummary } from '@project-hub/contracts';
import { formatTime, statusLabel, type MissionStatus } from '../mission-text';
import { missionPath, projectPath, ROUTE_PATHS, workspacePath } from '../routes';
import { markOfMission, markOfTerminal, type MarkKind } from '../state-mark';
import { useTerminals } from '../terminals-data';
import { useSidebarData, type SidebarData } from '../use-sidebar-data';
import { EmptyState } from './EmptyState';
import { ChevronRight, ICON_PROPS, Inbox, Search } from './Icon';
import { MainNav } from './MainNav';
import { ProviderIcon } from './ProviderIcon';
import { StateMark } from './StateMark';
import { StatusChip } from './StatusChip';

/** Estados de missão que entram na seção Em andamento: as que rodam e as que esperam. */
const IN_PROGRESS: readonly MissionStatus[] = [
  'running',
  'waiting_approval',
  'waiting_input',
  'review',
  'planned',
  'queued',
];

/** Quantos agentes de um projeto aparecem como ícones ao lado do nome, antes do "+N". */
const AVATAR_LIMIT = 3;

/** O que a pessoa pediu para mostrar no workspace; o workspace lê isto em `location.state`. */
type ShowTerminal = (projectId: string, terminalId: string) => void;

/**
 * Barra lateral: a busca e a navegação principal no topo, o aviso das sessões que esperam a pessoa, a
 * seção Workspaces (cada projeto com os agentes abertos, em cartões) e a seção Em andamento (as missões
 * que rodam ou esperam, de todos os projetos). Ocupa toda a coluna que a recebe, e cada seção rola sozinha.
 * O projeto atual, que dá destino ao botão Nova missão, vem de `currentProjectId` ou, sem ele, da rota. O
 * App monta a barra fora de `<Routes>`, onde `useParams` devolve vazio; `useMatch` lê a rota de qualquer lugar.
 * `onSearch` abre a paleta de comandos; sem ele, a busca não aparece.
 */
export function Sidebar({
  currentProjectId,
  onSearch,
}: {
  currentProjectId?: string;
  onSearch?: () => void;
}) {
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
      {onSearch === undefined ? null : <SearchButton onSearch={onSearch} />}
      <AttentionStrip terminals={terminals} onShowTerminal={showTerminal} />

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

/** Busca no topo da barra: abre a paleta de comandos (Ctrl+K). O atalho aparece como texto, não só como ícone. */
function SearchButton({ onSearch }: { onSearch: () => void }) {
  return (
    <button
      type="button"
      className="sidebar__search"
      onClick={onSearch}
      aria-keyshortcuts="Control+K"
    >
      <Search {...ICON_PROPS} />
      <span>Buscar projeto ou agente</span>
      <kbd aria-hidden="true">Ctrl K</kbd>
    </button>
  );
}

/**
 * Aviso das sessões que esperam a pessoa: a primeira aparece com o botão Ir, e o total ao lado do rótulo.
 * Sem nenhuma esperando, a seção nem existe. Pede ação, por isso fica acima dos projetos.
 */
function AttentionStrip({
  terminals,
  onShowTerminal,
}: {
  terminals: readonly TerminalSummary[];
  onShowTerminal: ShowTerminal;
}) {
  const waiting = terminals.filter((terminal) => terminal.state === 'waiting');
  const first = waiting[0];
  if (first === undefined) return null;
  const total = waiting.length > 1 ? ` · ${waiting.length}` : '';
  return (
    <section aria-label="Precisa de você" className="sidebar__attention state-attention">
      <p className="sidebar__attention-tag state-attention-tag">Precisa de você{total}</p>
      <div className="sidebar__attention-row">
        <span className="sidebar__attention-ico" aria-hidden="true">
          <ProviderIcon provider={first.provider} size={14} />
        </span>
        <span className="sidebar__attention-text">
          <b title={first.title}>{first.title}</b>
          <small>{first.projectName}</small>
        </span>
        <button
          type="button"
          className="sidebar__attention-go state-attention-go"
          aria-label={`Ir para ${first.title}`}
          onClick={() => onShowTerminal(first.projectId, first.id)}
        >
          Ir
        </button>
      </div>
    </section>
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
 * Ícones dos agentes de um projeto, fechado: um por sessão, até `AVATAR_LIMIT`, cada um com o anel do estado
 * dele, e "+N" com o resto. Sem sessão, "vazio". Decorativo: o nome do projeto e a lista aberta dizem tudo
 * para quem lê tela.
 */
function Avatars({ sessions }: { sessions: readonly TerminalSummary[] }) {
  if (sessions.length === 0) return <span className="sidebar__vazio">vazio</span>;
  const shown = sessions.slice(0, AVATAR_LIMIT);
  const extra = sessions.length - shown.length;
  return (
    <span className="sidebar__avatars" aria-hidden="true">
      {shown.map((session) => (
        <span
          key={session.id}
          data-state={session.state}
          className={`sidebar__avatar state-ring state-ring--${session.state}`}
        >
          <ProviderIcon provider={session.provider} size={12} />
        </span>
      ))}
      {extra > 0 ? <span className="sidebar__avatar-more">+{extra}</span> : null}
    </span>
  );
}

/**
 * Lista de projetos, cada um um link para o workspace dele, com os ícones dos agentes, a marca agregada, o
 * botão que expande os cartões das sessões e, no projeto sem Git, o chip "sem Git". Só o projeto da rota do
 * workspace leva `aria-current`: o link aponta para a página atual apenas ali. Nomes entram como texto.
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
  const details = sessionDetails(sessions);
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
        <Avatars sessions={sessions} />
        <StateMark kind={projectMark(sessions, missions)} />
        {project.repositoryKind === 'git' ? null : <StatusChip label="sem Git" tone="muted" />}
      </div>
      {isOpen ? (
        <ul id={listId} className="sidebar__sessions">
          {sessions.length === 0 ? (
            <li className="sidebar__empty">Nenhuma sessão aberta.</li>
          ) : (
            sessions.map((session, index) => (
              <SessionCard
                key={session.id}
                session={session}
                detail={details[index] ?? ''}
                onShowTerminal={() => onShowTerminal(project.id, session.id)}
              />
            ))
          )}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * O detalhe de cada sessão do projeto, na ordem da lista, calculado numa passada só. Quando o mesmo título se
 * repete no projeto, o número da posição entra junto, para os cartões não serem iguais.
 */
function sessionDetails(sessions: readonly TerminalSummary[]): string[] {
  const titles = new Map<string, number>();
  for (const session of sessions) titles.set(session.title, (titles.get(session.title) ?? 0) + 1);
  const seen = new Map<string, number>();
  return sessions.map((session) => {
    const base = baseDetail(session);
    if ((titles.get(session.title) ?? 0) < 2) return base;
    const position = (seen.get(session.title) ?? 0) + 1;
    seen.set(session.title, position);
    return `${base} ${position}`;
  });
}

/** O detalhe de uma sessão sem contar repetição: a pasta do worktree, "missão", "recuperada" ou "avulsa". */
function baseDetail(session: TerminalSummary): string {
  if (session.worktreeName !== undefined) return session.worktreeName;
  if (session.kind === 'agent') return 'missão';
  return session.origin === 'recovered' ? 'recuperada' : 'avulsa';
}

/**
 * Cartão de uma sessão aberta: trilho colorido pelo estado, o ícone do programa, o título e o detalhe, e à
 * direita o estado em texto e, quando a sessão tem hora de início, a hora: "há N min" na primeira hora e o
 * horário depois, como nas linhas do tempo. Clicar leva ao workspace do projeto, pedindo para mostrar esse
 * terminal.
 */
function SessionCard({
  session,
  detail,
  onShowTerminal,
}: {
  session: TerminalSummary;
  detail: string;
  onShowTerminal: () => void;
}) {
  const time = session.startedAt === undefined ? null : formatTime(session.startedAt);
  return (
    <li className="sidebar__session">
      <button
        type="button"
        className={`sidebar__card sidebar__card--${session.state} state-rail state-rail--${session.state}`}
        onClick={onShowTerminal}
      >
        <span className="sidebar__card-ico" aria-hidden="true">
          <ProviderIcon provider={session.provider} size={14} />
        </span>
        <span className="sidebar__card-text">
          <span className="sidebar__name" title={session.title}>
            {session.title}
          </span>
          <small>{detail}</small>
        </span>
        <span className="sidebar__card-side">
          <StateMark kind={markOfTerminal(session.state)} withLabel />
          {time === null ? null : <time dateTime={session.startedAt}>{time}</time>}
        </span>
      </button>
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
 * agente abre esse terminal no workspace do projeto dela; a que não tem leva à página da missão. O estado
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
  if (items.length === 0) return <EmptyState icon={Inbox} title="Nada em andamento." />;

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
